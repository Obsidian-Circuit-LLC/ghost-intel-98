/**
 * X/Twitter IPC handler implementations (X-5).
 *
 * Handler functions are exported individually so they can be imported into
 * register.ts (wired to safeHandle) and directly tested (gate + delegation tests).
 *
 * Account management:
 *   Credentials stored in secretStore under x.accounts.<accountId>.{auth_token,ct0,username}.
 *   An index of known account IDs is kept at x.accounts.index (JSON array).
 *   NEVER echoes credential values — hasAccount / listAccounts expose IDs / booleans only.
 *
 * Egress gate (collect handler):
 *   BOTH settings.x.networkEnabled AND settings.x.clearnetAcknowledged must be true.
 *   Throws XCollectorGatedError when either is false — no silent skip.
 *   Distinct from the Telegram SOCMINT gate (which returns { disabled: true }); the X gate
 *   throws to make the two-flag requirement loudly visible at the IPC boundary (spec §3.1).
 *
 * Clearnet quarantine (spec §3.2) — this module MUST NOT import from:
 *   src/main/bgconn/*
 *   src/main/chat/transport-tor
 *   src/main/chat/socks5
 *   src/main/searchlight/tor-socks
 *   src/main/socmint/collector
 * All egress is the sidecar's own clearnet HTTPS; the Node side makes no network call.
 *
 * FAIL-LOUD (spec §4): all non-done statuses from collectX propagate unchanged.
 */

import { randomUUID } from 'node:crypto';
import type { HarvestedItem, SocmintJob } from '@shared/socmint/types';
import type { XCollectRequest, XCollectResult, XCollectDeps } from './collector';
import type { XSidecarRequest } from './sidecar-client';

// ---------------------------------------------------------------------------
// Egress gate error
// ---------------------------------------------------------------------------

/**
 * Thrown by handleXCollect when the X clearnet egress gate is closed.
 * The gate requires BOTH settings.x.networkEnabled AND settings.x.clearnetAcknowledged.
 * Distinct from the SOCMINT gate ({ disabled: true }) — X throws to force explicit
 * handling at the UI layer (spec §3.1).
 */
export class XCollectorGatedError extends Error {
  constructor() {
    super(
      'X collector is gated — both settings.x.networkEnabled and ' +
      'settings.x.clearnetAcknowledged must be true. Acknowledge the clearnet ' +
      'warning in Settings → X before enabling.',
    );
    this.name = 'XCollectorGatedError';
  }
}

// ---------------------------------------------------------------------------
// Account management — secretStore deps (injectable for gate/delegation tests)
// ---------------------------------------------------------------------------

const ACCOUNT_KEY_PREFIX = 'x.accounts.';
const ACCOUNT_INDEX_KEY = `${ACCOUNT_KEY_PREFIX}index`;

/**
 * Sanitise an account ID: strip path separators and dots to prevent key injection.
 * Mirrors the pattern in socmint/ipc.ts (handleSetBurner).
 */
function safeAccountId(raw: string): string {
  return raw.replace(/[/\\.:]/g, '_');
}

/** Deps for handlers that only read from secretStore. */
export interface XReadDeps {
  getSecret: (key: string) => Promise<string | null>;
}

/** Deps for handlers that read and write secretStore. */
export interface XWriteDeps extends XReadDeps {
  setSecret: (key: string, value: string) => Promise<void>;
  deleteSecret: (key: string) => Promise<void>;
}

/** Read the account index from secretStore. Returns [] on absent/corrupt index. */
async function readAccountIndex(deps: XReadDeps): Promise<string[]> {
  try {
    const raw = await deps.getSecret(ACCOUNT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as unknown[]).filter((x): x is string => typeof x === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Store X account credentials in secretStore.
 * Accepts { auth_token?, ct0?, username? }. At least one field is required.
 * Updates the account index. NEVER echoes credentials — hasAccount returns boolean only.
 */
export async function handleXAddAccount(
  rawAccountId: string,
  rawCreds: unknown,
  deps: XWriteDeps,
): Promise<void> {
  if (!rawAccountId) throw new Error('x:addAccount requires accountId');
  const accountId = safeAccountId(rawAccountId);
  const creds = (rawCreds ?? {}) as Record<string, unknown>;
  const prefix = `${ACCOUNT_KEY_PREFIX}${accountId}`;

  let stored = false;
  if (typeof creds.auth_token === 'string' && creds.auth_token) {
    await deps.setSecret(`${prefix}.auth_token`, creds.auth_token);
    stored = true;
  }
  if (typeof creds.ct0 === 'string' && creds.ct0) {
    await deps.setSecret(`${prefix}.ct0`, creds.ct0);
    stored = true;
  }
  if (typeof creds.username === 'string' && creds.username) {
    await deps.setSecret(`${prefix}.username`, creds.username);
    stored = true;
  }
  if (!stored) {
    throw new Error(
      'x:addAccount requires at least one credential field (auth_token, ct0, or username)',
    );
  }

  // Append to index if not already present.
  const index = await readAccountIndex(deps);
  if (!index.includes(accountId)) {
    await deps.setSecret(ACCOUNT_INDEX_KEY, JSON.stringify([...index, accountId]));
  }
}

/**
 * Remove all credentials for a given X account from secretStore.
 * Removes the account from the index. No-op when rawAccountId is empty.
 */
export async function handleXRemoveAccount(
  rawAccountId: string,
  deps: XWriteDeps,
): Promise<void> {
  if (!rawAccountId) return;
  const accountId = safeAccountId(rawAccountId);
  const prefix = `${ACCOUNT_KEY_PREFIX}${accountId}`;

  await deps.deleteSecret(`${prefix}.auth_token`);
  await deps.deleteSecret(`${prefix}.ct0`);
  await deps.deleteSecret(`${prefix}.username`);

  // Remove from index.
  const index = await readAccountIndex(deps);
  const updated = index.filter((id) => id !== accountId);
  await deps.setSecret(ACCOUNT_INDEX_KEY, JSON.stringify(updated));
}

/**
 * Returns the list of stored X account IDs.
 * Never returns credential values — IDs only.
 * Returns [] when the index is absent or corrupt.
 */
export async function handleXListAccounts(deps: XReadDeps): Promise<string[]> {
  return readAccountIndex(deps);
}

/**
 * Returns true when secretStore holds a non-empty auth_token for the given accountId.
 * Boolean only — never exposes credential values.
 * Returns false on keyring errors (the error surfaces when collect actually runs).
 */
export async function handleXHasAccount(
  rawAccountId: string,
  deps: XReadDeps,
): Promise<boolean> {
  if (!rawAccountId) return false;
  const accountId = safeAccountId(rawAccountId);
  try {
    const v = await deps.getSecret(`${ACCOUNT_KEY_PREFIX}${accountId}.auth_token`);
    return typeof v === 'string' && v.length > 0;
  } catch {
    // Keyring locked / unavailable — treat as "no usable account" at the check stage;
    // the real error will surface when collect actually tries to read creds.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Collect (egress-gated)
// ---------------------------------------------------------------------------

/**
 * Injectable deps for handleXCollect.
 * All I/O is injected so the handler is independently testable without Electron
 * or a real sidecar (mirrors the handleStartMonitor pattern in socmint/ipc.ts).
 */
export interface XCollectHandlerDeps {
  /** Gate check — must return true for collect to proceed. */
  networkEnabled: () => Promise<boolean>;
  /** Gate check — must return true (clearnet acknowledge dialog confirmed). */
  clearnetAcknowledged: () => Promise<boolean>;
  /**
   * Injectable for tests — overrides the lazy import of collectX from ./collector.
   * The production path (no override) calls the real collectX which invokes the sidecar.
   */
  collectXFn?: (req: XCollectRequest, innerDeps: XCollectDeps) => Promise<XCollectResult>;
  upsertItems: (caseId: string, items: HarvestedItem[]) => Promise<{ added: number; skipped: number }>;
  recordJob: (caseId: string, job: SocmintJob) => Promise<void>;
  getSecret: (key: string) => Promise<string | null>;
  harvestedAt?: () => string;
}

/**
 * Run one X collection job.
 *
 * EGRESS GATE: BOTH settings.x.networkEnabled AND settings.x.clearnetAcknowledged
 * must be true (spec §3.1). Throws XCollectorGatedError when either is false.
 *
 * Request fields:
 *   caseId       UUID — validated at the IPC boundary via ensureUuid.
 *   mode         'search' | 'userTweets'
 *   query        Required when mode='search'. Capped at 1024 chars.
 *   username     Required when mode='userTweets'. Leading @ stripped. Capped at 64 chars.
 *   channelLabel Optional human label for the query. Capped at 256 chars.
 *   accountId    Optional account UUID for credential lookup.
 *   limit        Max tweets per job. Capped at 5000, defaults to 500.
 *   since/until  Optional ISO 8601 date bounds. Capped at 32 chars.
 *
 * @param rawReq  Raw renderer-supplied request object.
 * @param deps    Injectable deps: gate state + store/sidecar delegation.
 */
export async function handleXCollect(
  rawReq: unknown,
  deps: XCollectHandlerDeps,
): Promise<XCollectResult> {
  // EGRESS GATE — both flags required before ANY sidecar path is entered (spec §3.1).
  if (!await deps.networkEnabled() || !await deps.clearnetAcknowledged()) {
    throw new XCollectorGatedError();
  }

  const req = (rawReq ?? {}) as Record<string, unknown>;

  // Validate caseId at the IPC trust boundary.
  const { ensureUuid } = await import('../security/validate');
  const caseId = ensureUuid(req.caseId, 'caseId');

  const mode = req.mode;
  if (mode !== 'search' && mode !== 'userTweets') {
    throw new Error("x:collect requires mode 'search' or 'userTweets'");
  }

  const channelLabel = typeof req.channelLabel === 'string' ? req.channelLabel.slice(0, 256) : '';
  const accountId = typeof req.accountId === 'string' ? safeAccountId(req.accountId) : undefined;
  const limit =
    typeof req.limit === 'number' && req.limit > 0
      ? Math.min(Math.floor(req.limit), 5000)
      : 500;
  const since = typeof req.since === 'string' ? req.since.slice(0, 32) : undefined;
  const until = typeof req.until === 'string' ? req.until.slice(0, 32) : undefined;

  let sidecarReq: XSidecarRequest;
  if (mode === 'search') {
    const query = typeof req.query === 'string' ? req.query.slice(0, 1024).trim() : '';
    if (!query) throw new Error('x:collect search mode requires a non-empty query');
    sidecarReq = {
      type: 'search',
      query,
      limit,
      ...(since !== undefined && { since }),
      ...(until !== undefined && { until }),
    };
  } else {
    const username = typeof req.username === 'string'
      ? req.username.replace(/^@/, '').slice(0, 64).trim()
      : '';
    if (!username) throw new Error('x:collect userTweets mode requires a non-empty username');
    sidecarReq = {
      type: 'userTweets',
      username,
      limit,
      ...(since !== undefined && { since }),
      ...(until !== undefined && { until }),
    };
  }

  const collectReq: XCollectRequest = {
    sidecarReq,
    caseId,
    channelLabel,
    ...(accountId !== undefined && { accountId }),
    jobId: randomUUID(),
  };

  // Use injected collectXFn for tests; production path lazy-imports ./collector.
  const doCollect = deps.collectXFn ?? (await import('./collector')).collectX;
  return doCollect(collectReq, {
    upsertItems: deps.upsertItems,
    recordJob: deps.recordJob,
    getSecret: deps.getSecret,
    harvestedAt: deps.harvestedAt,
  });
}

// ---------------------------------------------------------------------------
// Items (list / rank) — X-platform only
// ---------------------------------------------------------------------------

/**
 * List all X-platform harvested items for a case in stable (append) order.
 * Delegates to the shared SOCMINT store; filters by platform: 'x'.
 */
export async function handleXListItems(caseId: string): Promise<HarvestedItem[]> {
  const { listItems } = await import('../socmint/store');
  const all = await listItems(caseId);
  return all.filter((item) => item.platform === 'x');
}

/**
 * Rank X-platform items for a case by keyword relevance.
 * Delegates to rankByRelevance (loopback-only AI invariant enforced inside).
 * Returns [] when no X items are stored.
 */
export async function handleXRankItems(caseId: string, keyword: string): Promise<HarvestedItem[]> {
  const items = await handleXListItems(caseId);
  if (items.length === 0) return [];
  const { rankByRelevance } = await import('../socmint/rank');
  return rankByRelevance(keyword, items);
}
