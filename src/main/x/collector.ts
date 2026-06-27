/**
 * X-4: X/Twitter collector — store integration.
 *
 * Wraps the sidecar client (X-3) with:
 *   - credential retrieval from secretStore (x.accounts.<accountId>.{auth_token,ct0,username})
 *   - raw tweet → HarvestedItem mapping (spec §1)
 *   - batch upsert into the SOCMINT store (upsertItems, BATCH_SIZE = 50)
 *   - job recording (recordJob)
 *   - XCollectResult assembly (extends XSidecarResult with itemsAdded/itemsSkipped)
 *
 * QUARANTINE (spec §3.2): NO import from:
 *   - src/main/bgconn/*
 *   - src/main/chat/transport-tor
 *   - src/main/chat/socks5
 *   - src/main/searchlight/tor-socks
 *   - src/main/socmint/collector
 * All egress is the sidecar's own clearnet HTTPS; this module makes NO network calls.
 *
 * FAIL-LOUD (spec §4): all non-done statuses from the sidecar client are propagated
 * unchanged. The caller (X-5 IPC handler) is responsible for surfacing them to the
 * renderer. Partial ≠ complete — the renderer must NEVER present a partial result as
 * evidence of absence.
 *
 * Credentials: read from secretStore immediately before the job runs. Never logged,
 * never echoed to the renderer (boolean hasCreds only). Passed to runJob as the
 * XCreds payload (embedded in the wire stdin frame, not argv or env — §2.4).
 *
 * URL scheme-guard: tweet.url is attacker-controlled; isXUrl() is applied before
 * storing. A URL that fails the guard is stored as '' (spec §5.3).
 *
 * No media retrieval in v1: mediaType is recorded for provenance; mediaRef is absent
 * (no CDN fetch, which would reveal the host IP — spec §5.4).
 */

import { randomUUID } from 'node:crypto';
import type { HarvestedItem, SocmintJob } from '@shared/socmint/types';
import { isXUrl } from '@shared/socmint/types';
import { harvestedItemId } from '../socmint/utils';
import type { RawTweet, XSidecarRequest, XSidecarResult, XCreds } from './sidecar-client';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { XCollectorStatus } from './sidecar-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extends XSidecarResult (from the sidecar client) with store outcome counters.
 * Matches spec §4.2: { status, itemsAdded, itemsSkipped, totalFromSidecar,
 * truncationReason?, truncationMessage?, errorCode?, errorMessage?, jobId }.
 */
export interface XCollectResult extends XSidecarResult {
  /** Items actually written to the store (new, non-duplicate). */
  itemsAdded: number;
  /** Items from the sidecar that were already present in the store (deduped by id). */
  itemsSkipped: number;
}

/** Full collection request: sidecar parameters + store routing. */
export interface XCollectRequest {
  /** Sidecar wire-protocol request (search or userTweets). */
  sidecarReq: XSidecarRequest;
  /** Case to store harvested items in. */
  caseId: string;
  /** Analyst-supplied human label for this query/channel. */
  channelLabel: string;
  /**
   * Account UUID for credential lookup.
   * secretStore key prefix: x.accounts.<accountId>.{auth_token, ct0, username}
   * Omit for anonymous / unauthenticated collection (sidecar may still work for
   * public data depending on rate-limits — but authenticated is the supported path).
   */
  accountId?: string;
  /**
   * Caller-supplied jobId. A new UUID is generated when absent.
   * Matches the jobId used in XSidecarResult.jobId and provenance.jobId.
   */
  jobId?: string;
  /** Semver-style collector version recorded in provenance. Defaults to 'x-v1'. */
  collectorVersion?: string;
}

/**
 * Injectable deps — all I/O is injected so collectX is independently testable
 * with mock client+store (no electron, no real binary, no real secretStore needed).
 *
 * In production, X-5 (IPC registration) supplies the production store functions
 * and secretStore.get as the deps.
 */
export interface XCollectDeps {
  /**
   * Sidecar run function. Defaults (lazily) to runJob from ./sidecar-client.
   * Override in tests with a synchronous mock that delivers RawTweet frames via onItem.
   */
  runJob?: (
    req: XSidecarRequest,
    creds: XCreds | undefined,
    onItem: (tweet: RawTweet) => void,
    jobId: string,
  ) => Promise<XSidecarResult>;
  /** Upsert a batch of items into the case store. Injected from socmint/store.ts. */
  upsertItems: (caseId: string, items: HarvestedItem[]) => Promise<{ added: number; skipped: number }>;
  /** Append a job record to the case jobs sidecar. Injected from socmint/store.ts. */
  recordJob: (caseId: string, job: SocmintJob) => Promise<void>;
  /**
   * Read a single secret by key. Injected from secrets/index.ts secretStore.get.
   * Returns null when the key is absent or the keyring is unavailable.
   */
  getSecret: (key: string) => Promise<string | null>;
  /**
   * Injected clock for harvestedAt timestamps. Defaults to () => new Date().toISOString().
   * Override in tests for deterministic timestamps.
   */
  harvestedAt?: () => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COLLECTOR_VERSION = 'x-v1';

/**
 * Items per upsertItems call. Matches the sidecar client's internal TWEET_BATCH_SIZE
 * so the batch cadence is consistent with the spec §2.4 description.
 */
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the channelId from the sidecar request (spec §1.1):
 *   search      → the raw query string (used for dedup key + provenance.keyword)
 *   userTweets  → @username
 */
export function channelIdFromReq(req: XSidecarRequest): string {
  if (req.type === 'search') return req.query;
  return `@${req.username}`;
}

/**
 * Map a raw sidecar tweet frame to a HarvestedItem (spec §1).
 *
 * Exported for unit tests (X-4) and the X-5 IPC result formatter.
 *
 * Invariants:
 *   - url is scheme-guarded via isXUrl(); stored as '' when the guard fails (spec §5.3).
 *   - mediaType is present when media frames exist; mediaRef is ABSENT in v1 (spec §5.4).
 *   - text/authorHandle are attacker-controlled; renderer must use textContent only.
 *   - publishedAt comes from tweet.date (platform UTC ISO 8601, never Date.now()).
 *   - harvestedAt comes from the injected clock (never computed inside mapper).
 */
export function mapXTweet(
  tweet: RawTweet,
  ctx: {
    channelId: string;
    channelLabel: string;
    jobId: string;
    caseId: string;
    collectorVersion: string;
    harvestedAt: () => string;
  },
): HarvestedItem {
  // Scheme-guard: reject anything not https://x.com/* or https://twitter.com/* (spec §5.3).
  const url = isXUrl(tweet.url) ? tweet.url : '';

  // Record media type for provenance but never fetch (spec §5.4).
  const mediaType = tweet.media?.[0]?.mediaType;

  const item: HarvestedItem = {
    id: harvestedItemId('x', ctx.channelId, tweet.id_str),
    platform: 'x',
    channelId: ctx.channelId,
    channelLabel: ctx.channelLabel,
    authorHandle: tweet.user.username,
    authorId: tweet.user.id_str,
    messageId: tweet.id_str,
    text: tweet.rawContent,
    url,
    publishedAt: tweet.date,
    harvestedAt: ctx.harvestedAt(),
    provenance: {
      collectorVersion: ctx.collectorVersion,
      jobId: ctx.jobId,
      caseId: ctx.caseId,
      keyword: ctx.channelId,
    },
  };

  // mediaRef is absent in v1 (no auto-fetch/store — spec §5.4).
  if (mediaType !== undefined) {
    item.mediaType = mediaType;
  }

  return item;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run one X collection job: read creds, stream tweets through the sidecar client,
 * upsert into the store in batches of 50, record the job, and return XCollectResult.
 *
 * FAIL-LOUD contract: every non-done status from the sidecar (partial, error,
 * sidecar-missing, breakage-detected) is propagated unchanged. The job is always
 * recorded regardless of status so the job history captures every attempt.
 *
 * The onItem callback passed to runJob is synchronous (matching the sidecar client
 * contract). Tweets are accumulated synchronously and flushed to the store in BATCH_SIZE
 * slices after runJob resolves.
 */
export async function collectX(
  req: XCollectRequest,
  deps: XCollectDeps,
): Promise<XCollectResult> {
  const jobId = req.jobId ?? randomUUID();
  const collectorVersion = req.collectorVersion ?? COLLECTOR_VERSION;
  const harvestedAt = deps.harvestedAt ?? (() => new Date().toISOString());

  // Lazy-default: if deps.runJob is not injected, load from the sidecar client.
  // The dynamic import is never evaluated when deps.runJob is provided (test path).
  const runJobFn =
    deps.runJob ??
    (await import('./sidecar-client')).runJob;

  // 1. Read credentials from secretStore (spec §2.4, §5.2, §6.8).
  //    Key namespace: x.accounts.<accountId>.{auth_token, ct0, username}
  //    Never echoed — the IPC layer only exposes boolean hasCreds.
  let creds: XCreds | undefined;
  if (req.accountId) {
    const prefix = `x.accounts.${req.accountId}`;
    const [authToken, ct0, username] = await Promise.all([
      deps.getSecret(`${prefix}.auth_token`),
      deps.getSecret(`${prefix}.ct0`),
      deps.getSecret(`${prefix}.username`),
    ]);
    if (authToken || ct0 || username) {
      creds = {
        ...(authToken ? { authToken } : {}),
        ...(ct0 ? { ct0 } : {}),
        ...(username ? { username } : {}),
      };
    }
  }

  // 2. Mapping context (shared across all tweets in this job).
  const channelId = channelIdFromReq(req.sidecarReq);
  const mapCtx = {
    channelId,
    channelLabel: req.channelLabel,
    jobId,
    caseId: req.caseId,
    collectorVersion,
    harvestedAt,
  };

  // 3. Accumulate tweet frames synchronously.
  //    runJob calls onItem synchronously in the readline loop (§2.3); we must NOT
  //    perform async upserts inside onItem (would deadlock the promise resolution).
  const accumulated: RawTweet[] = [];
  const onItem = (tweet: RawTweet): void => {
    accumulated.push(tweet);
  };

  // 4. Run the sidecar job (ping/pong → request → tweet frames → terminal frame).
  const sidecarResult = await runJobFn(req.sidecarReq, creds, onItem, jobId);

  // 5. Flush accumulated tweets to the store in BATCH_SIZE slices.
  //    Mapping happens here (not in onItem) to keep the sync callback minimal.
  let itemsAdded = 0;
  let itemsSkipped = 0;
  for (let i = 0; i < accumulated.length; i += BATCH_SIZE) {
    const slice = accumulated.slice(i, i + BATCH_SIZE).map((t) => mapXTweet(t, mapCtx));
    const { added, skipped } = await deps.upsertItems(req.caseId, slice);
    itemsAdded += added;
    itemsSkipped += skipped;
  }

  // 6. Record the job in the case jobs sidecar.
  //    Always recorded — even for partial/error/sidecar-missing — so the history
  //    captures every collection attempt (including failures and breakage events).
  const job: SocmintJob = {
    jobId,
    caseId: req.caseId,
    startedAt: harvestedAt(),
    runtime: 'twscrape',
  };
  await deps.recordJob(req.caseId, job);

  // 7. Return the combined sidecar result + store outcome.
  return { ...sidecarResult, itemsAdded, itemsSkipped };
}
