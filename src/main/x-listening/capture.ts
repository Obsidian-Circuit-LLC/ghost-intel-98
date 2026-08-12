/**
 * X Listening Station — timeline capture orchestration (Enterprise port, Task 4).
 *
 * Ties the pure normalizer (`extract.ts`) to the live capture window (opened Tor-default
 * by `session.ts`, Task 3), the challenge/lock gate (`classifyXPageState`, adapted from
 * Enterprise `assertSignedInPage`), and the encrypted `XStore` (Task 1). Every collaborator
 * is an INJECTABLE dep with a production default — the seam class the v3.24.2 collect-path
 * bug taught us to test directly:
 *
 *  - a challenge/blocked or signed-out page → NOTHING scraped, NOTHING persisted;
 *  - `X_POST_SCRIPT` is the ONLY payload ever run in the capture page — static, no
 *    scraped-data interpolation;
 *  - each normalized item is folded into a richer `XPostArtifact` (`toPostArtifact`):
 *    `metrics` (parsed) AND `metricsRaw` (the verbatim platform string) are BOTH kept and
 *    folded into `evidenceHash` via `evidence.ts`'s Task-2 honesty fix — a post's displayed
 *    engagement counts cannot be edited post-collection without invalidating the hash;
 *  - persistence is DUAL: the plain `HarvestedItem` sidecar (`store.saveItems`, the
 *    cross-module dashboard's source of truth) AND the richer `XPostArtifact` sidecar
 *    (`store.posts.save`) — both dedup by `id`, so a re-capture of the same visible post is
 *    a no-op, not a duplicate row.
 *
 * Quarantine-clean at module load: no static `electron` import — `win` is typed
 * structurally via the ambient `Electron.BrowserWindow`, and the production store wiring is
 * a LAZY dynamic `import('./store')` inside the default deps, mirroring
 * `telegram-hunter/collector.ts`'s `defaultDeps()` convention. `capture.ts` never imports
 * Tor/bgconn/socks — the caller (the Task 6 IPC handler, via `session.ts`) is the one
 * responsible for opening the win Tor-default; this module runs static JS in whatever
 * window it is handed.
 */
import {
  X_POST_SCRIPT,
  X_PAGE_STATE_SCRIPT,
  X_VERIFY_POST_SCRIPT,
  USER_CELL_SCRIPT,
  classifyXPageState,
  isPostUnavailableText,
  normalizePost,
  normalizeReply,
  normalizeRepost,
  normalizeNetwork,
  selectTimelineCaptures,
  type RawPost,
  type RawUserCell,
  type NormalizeContext,
  type XHarvestedItem,
  type XCollectSettings,
  type XPageState,
  type XVerifyPage,
} from './extract';
import { postEvidenceHash } from './evidence';
import { ingestPostsWithHistory, markPostUnavailable } from './changes';
import { buildRunRecord, recordCollectionRun, type RunRecordInput } from './run-log';
import type {
  XNetworkAccount,
  XNetworkArtifact,
  XPostArtifact,
  XPostMetrics,
  XPostMetricsRaw,
  XRunLogRecord,
  XRunOperation,
  XStore,
} from './store';
import type { XTorGate } from './session';
import type { HarvestedItem } from '@shared/socmint/types';
import type { XCollectionSettings } from '@shared/x-listening-collection-settings';

/** This collector's version, stamped into every item's provenance. */
export const X_COLLECTOR_VERSION = 'x-listening/1.0.0';

/** All-off collect gate — a target's own top-level posts only. The trusted default; the
 *  renderer never widens capture — the caller (Task 6 IPC handler) reads the real setting
 *  MAIN-side from `AppSettings.xListening.collect` and passes it in. */
export const DEFAULT_COLLECT: XCollectSettings = {
  replies: false,
  reposts: false,
  comments: false,
};

/** The renderer-supplied context for a timeline capture: which case/job, which profile
 *  timeline is being observed, and which surrounding-thread kinds to admit. `harvestedAt`
 *  + `collectorVersion` are stamped MAIN-side (the trusted clock + version), never accepted
 *  from the renderer. */
export interface XTimelineCaptureRequest {
  caseId: string;
  jobId: string;
  /** The profile/timeline being observed (the HarvestedItem "channel"). */
  channelId: string;
  channelLabel: string;
  /** The target's own handle — the collect gate uses this to tell the target's own posts
   *  from a repost of someone else's. */
  targetUsername: string;
  /** Which surrounding-thread kinds to capture. Defaults to `DEFAULT_COLLECT` (all off). */
  collect?: XCollectSettings;
  /** Which collection operation this capture is (Task A3 run-log stamping). Defaults to `'posts'`
   *  (a manual/live timeline capture); the archive path passes `'archive_posts'` so its run record
   *  is logged as an incremental-archive cycle, not a manual capture. */
  operation?: XRunOperation;
}

export interface XTimelineCaptureResult {
  blocked: boolean;
  reason?: string;
  added: number;
  skipped: number;
  posts: XPostArtifact[];
}

/** Injectable seams so the orchestration is testable without electron/network. */
export interface XCaptureDeps {
  /** Run a static payload in the capture page → its result. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** The challenge/lock gate: runs `capture` ONLY on an unblocked, signed-in page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>,
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Persist the richer post artifacts to the `x-posts.json` sidecar (Task 1). */
  savePosts: (caseId: string, posts: XPostArtifact[]) => Promise<{ added: number; skipped: number }>;
  /** Persist the plain `HarvestedItem`s to the cross-module dashboard sidecar. */
  saveItems: (caseId: string, items: HarvestedItem[]) => Promise<{ added: number; skipped: number }>;
  /** Resolve + cache one remote post-media URL (host-anchored) into a LOCAL secure-fs ref, or
   *  null on any failure (off-allowlist host, non-image, fetch error). Production default is
   *  media.ts's `cacheRemoteMedia`, scoped to `req.caseId` (Task 15 — closes the gap where
   *  `X_POST_SCRIPT`'s scraped `pbs.twimg.com` image URLs were resolved by NOTHING: they are
   *  remote, so `normalizePost`'s `data:`-only filter dropped every one, silently losing the
   *  post's media entirely rather than leaking a remote URL). */
  resolveMedia: (win: Electron.BrowserWindow, url: string, caseId: string) => Promise<string | null>;
  /** Append one collection-run record for this capture (Task A3). Production default routes to the
   *  encrypted `runLog` sidecar via run-log.ts. A run-log write is OPERATIONAL telemetry, NOT
   *  evidence — a failure here MUST NOT break the capture or drop captured posts, so
   *  `captureTimeline` calls this best-effort (see `emitRun`). */
  recordRun: (caseId: string, record: XRunLogRecord) => Promise<void>;
  /** Injected clock — the ISO capture time stamped onto every item. */
  now: () => string;
}

/** Default in-page runner — the same static-payload executor the capture stack uses,
 *  inlined so this module does not statically import electron. `userGesture=true`. */
function defaultRunCapture(win: Electron.BrowserWindow, js: string): Promise<unknown> {
  return win.webContents.executeJavaScript(js, true);
}

/**
 * The production challenge/lock gate: probe the visible page and refuse on a challenge OR
 * a signed-out page (the two `assertSignedInPage` branches); otherwise run the capture.
 * Uses `defaultRunCapture` for the probe.
 */
async function defaultGuard<T>(
  win: Electron.BrowserWindow,
  capture: () => Promise<T>,
): Promise<{ blocked: boolean; reason?: string; result?: T }> {
  const probe = (await defaultRunCapture(win, X_PAGE_STATE_SCRIPT)) as XPageState;
  const state = classifyXPageState({
    url: String(probe?.url ?? ''),
    text: String(probe?.text ?? ''),
    articles: Number(probe?.articles ?? 0),
  });
  if (state.blocked) return { blocked: true, reason: state.reason };
  if (!state.signedIn) {
    return { blocked: true, reason: state.reason ?? 'The saved X session is no longer signed in.' };
  }
  return { blocked: false, result: await capture() };
}

function defaultDeps(): XCaptureDeps {
  return {
    runCapture: defaultRunCapture,
    guard: defaultGuard,
    savePosts: async (caseId, posts) => {
      // Route production capture persistence through the version-aware ingest (Task A2): a
      // re-capture of a post whose text/media changed archives the prior version onto
      // `versionHistory` and emits a `post_changed` event, rather than the plain id-dedup of
      // `posts.save`. `added`/`skipped` keep the same meaning the caller reads. Tests inject
      // their own `savePosts`, so this production default is exercised only end-to-end.
      const { ingestPostsWithHistory } = await import('./changes');
      const res = await ingestPostsWithHistory(caseId, posts, { now: new Date().toISOString() });
      return { added: res.added, skipped: res.skipped };
    },
    saveItems: async (caseId, items) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.saveItems(caseId, items);
    },
    resolveMedia: async (win, url, caseId) => {
      const { cacheRemoteMedia } = await import('./media');
      const cached = await cacheRemoteMedia(win, url, caseId);
      return cached ? cached.ref : null;
    },
    recordRun: async (caseId, record) => {
      await recordCollectionRun(caseId, record);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Append one run record best-effort (Task A3). Telemetry, NOT evidence: a run-log write failure
 * must never break a capture or drop captured posts, so any error is swallowed with a warn.
 */
async function emitRun(
  deps: XCaptureDeps,
  caseId: string,
  input: RunRecordInput,
): Promise<void> {
  try {
    await deps.recordRun(caseId, buildRunRecord(input));
  } catch (err) {
    console.warn('[XListening] recordRun:', err);
  }
}

/**
 * Resolve every remote media URL on one raw post to a LOCAL secure-fs ref (Task 15), dropping
 * any that fail. An already-local `data:` entry (none exist in practice today — `X_POST_SCRIPT`
 * only ever scrapes remote `pbs.twimg.com` `<img src>`s — but tolerated defensively) is passed
 * through as-is rather than re-cached. A remote URL is never carried forward past this step.
 */
async function resolvePostMediaRefs(
  win: Electron.BrowserWindow,
  raw: RawPost,
  caseId: string,
  resolveMedia: XCaptureDeps['resolveMedia'],
): Promise<string[]> {
  const refs: string[] = [];
  for (const url of raw.media ?? []) {
    const src = String(url ?? '');
    if (!src) continue;
    if (src.startsWith('data:')) {
      refs.push(src);
      continue;
    }
    const ref = await resolveMedia(win, src, caseId);
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * Map one normalized `XHarvestedItem` (extract.ts's nested `{raw,value,approx}` metric
 * shape) → the richer, flat `XPostArtifact` (store.ts) that persists to the `x-posts.json`
 * sidecar. Folds BOTH the parsed `metrics` and the RAW platform strings `metricsRaw` into
 * `evidenceHash` via `postEvidenceHash` — the Task 2 honesty fix over Enterprise, which
 * omits metrics from its evidence hash entirely.
 */
export function toPostArtifact(item: XHarvestedItem, mediaRefs?: readonly string[]): XPostArtifact {
  const metrics: XPostMetrics = {
    replies: item.metrics.replies.value,
    reposts: item.metrics.reposts.value,
    likes: item.metrics.likes.value,
    views: item.metrics.views.value,
  };
  const metricsRaw: XPostMetricsRaw = {
    replies: item.metrics.replies.raw,
    reposts: item.metrics.reposts.raw,
    likes: item.metrics.likes.raw,
    views: item.metrics.views.raw,
  };
  // Only a `comment` carries lineage — never fabricate a parent for any other kind.
  const parentPostId = item.kind === 'comment' && item.parentId ? item.parentId : null;
  const post: XPostArtifact = {
    id: item.id,
    platform: item.platform,
    authorHandle: item.authorHandle,
    authorId: item.authorId,
    text: item.text,
    mediaType: item.mediaType,
    mediaRef: item.mediaRef,
    channelId: item.channelId,
    channelLabel: item.channelLabel,
    messageId: item.messageId,
    publishedAt: item.publishedAt,
    harvestedAt: item.harvestedAt,
    url: item.url,
    provenance: item.provenance,
    kind: item.kind,
    parentPostId,
    metrics,
    metricsRaw,
    mediaRefs: mediaRefs && mediaRefs.length ? [...mediaRefs] : undefined,
    evidenceHash: '',
  };
  post.evidenceHash = postEvidenceHash(post);
  return post;
}

/**
 * Capture the visible X profile timeline in the live capture window and persist it.
 *
 * Routes through the challenge/lock gate FIRST (nothing is captured or persisted on a
 * blocked/signed-out page), runs the STATIC `X_POST_SCRIPT`, applies the collect-toggle
 * gate (`selectTimelineCaptures` — a target's own top-level posts always, replies/reposts
 * only when opted in), normalizes each survivor, folds it into an evidence-hashed
 * `XPostArtifact`, and upserts into BOTH the plain-`HarvestedItem` and richer-artifact
 * sidecars (each dedups by `id`).
 */
export async function captureTimeline(
  win: Electron.BrowserWindow,
  req: XTimelineCaptureRequest,
  overrides: Partial<XCaptureDeps> = {},
): Promise<XTimelineCaptureResult> {
  const deps: XCaptureDeps = { ...defaultDeps(), ...overrides };
  const collect = req.collect ?? DEFAULT_COLLECT;
  const operation: XRunOperation = req.operation ?? 'posts';
  const startedAt = deps.now();
  const ctx: NormalizeContext = {
    caseId: req.caseId,
    jobId: req.jobId,
    collectorVersion: X_COLLECTOR_VERSION,
    harvestedAt: startedAt,
    channelId: req.channelId,
    channelLabel: req.channelLabel,
  };

  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, X_POST_SCRIPT);
    const raws: RawPost[] = Array.isArray(rawCollected) ? (rawCollected as RawPost[]) : [];
    const selections = selectTimelineCaptures(raws, req.targetUsername, collect);
    const results: { item: XHarvestedItem; mediaRefs: string[] }[] = [];
    for (const { raw, kind } of selections) {
      const item =
        kind === 'reply' ? normalizeReply(raw, ctx) : kind === 'repost' ? normalizeRepost(raw, ctx) : normalizePost(raw, ctx);
      // Resolve THIS post's media while still inside the guarded/signed-in page — same page
      // the timeline scrape itself ran against, so the media fetch below shares its cookies/
      // session state, mirroring how the scrape and the media fetch always ran against the
      // same live window in the legacy (pre-Task-15) capture path.
      const mediaRefs = await resolvePostMediaRefs(win, raw, req.caseId, deps.resolveMedia);
      results.push({ item, mediaRefs });
    }
    return results;
  });

  if (gated.blocked) {
    // A blocked/signed-out page captured nothing — record an ERROR run (Task A3) so the Change
    // Intel COLLECTION RUN LOG reflects the failed attempt honestly, then return unchanged.
    await emitRun(deps, req.caseId, {
      profileId: req.channelId,
      username: req.targetUsername,
      operation,
      observed: 0,
      added: 0,
      requestedPasses: 1,
      completedPasses: 0,
      reachedEnd: false,
      stopReason: gated.reason ?? 'blocked',
      status: 'error',
      startedAt,
      endedAt: deps.now(),
    });
    return { blocked: true, reason: gated.reason, added: 0, skipped: 0, posts: [] };
  }

  const results = gated.result ?? [];
  const items: XHarvestedItem[] = results.map((r) => r.item);
  const posts: XPostArtifact[] = results.map((r) => toPostArtifact(r.item, r.mediaRefs));

  const [postsResult] = await Promise.all([
    deps.savePosts(req.caseId, posts),
    deps.saveItems(req.caseId, items),
  ]);

  // Record the completed run (Task A3). `observed` = posts this capture saw; `added` = newly
  // persisted; `duplicates` (= observed - added) is derived in `buildRunRecord`. This port's
  // capture is a single visible-DOM scrape, so requested/completed passes are 1 and the visible
  // page is treated as reachedEnd.
  await emitRun(deps, req.caseId, {
    profileId: req.channelId,
    username: req.targetUsername,
    operation,
    observed: posts.length,
    added: postsResult.added,
    requestedPasses: 1,
    completedPasses: 1,
    reachedEnd: true,
    stopReason: 'complete',
    status: 'complete',
    startedAt,
    endedAt: deps.now(),
  });

  return { blocked: false, added: postsResult.added, skipped: postsResult.skipped, posts };
}

// ---- live post verification ("VERIFY LIVE", Task A1) ----------------------
//
// Rebuild of Enterprise `verifyPostLive` (`main.cjs:2620-2668`) onto OUR hardened seams. Opens
// the stored post's REAL URL in a Tor-gated capture window (`resolveXTorGate` — FAIL CLOSED, no
// clearnet fallback unless the operator's acked clearnet toggle is on), reuses the openPostThread
// scheme/host/path guards + the `^[A-Za-z0-9_]{1,15}$` username validator, then:
//   - an unavailable body (no matching live tweet) → A2's `markPostUnavailable` (post_unavailable)
//     + availability='unavailable';
//   - an observed text edit → A2's `ingestPostsWithHistory` (prior version archived + post_changed)
//     + availability='available';
//   - an unchanged live post → availability='available' stamped, no version, no event.
//
// Quarantine discipline (see the module header): capture.ts still statically imports NOTHING from
// electron/Tor/bgconn — `resolveGate`/`openWindow` production defaults are LAZY dynamic imports of
// `./session` (the ONE sanctioned Tor seam) and `../capture/capture-window`, mirroring `defaultDeps`.

/** The resolved capture result of one live verification. */
export interface XVerifyPostResult {
  availability: 'available' | 'unavailable';
  /** The injected-clock ISO time this verification ran. */
  verifiedAt: string;
  /** True iff a live text edit was observed and archived onto `versionHistory`. */
  changed: boolean;
}

/** Injectable seams so verification is testable without electron/network. Production defaults are
 *  lazy dynamic imports of the sanctioned Tor seam (`./session`) + the hardened window factory. */
export interface XVerifyPostDeps {
  /** Read the acked clearnet opt-out MAIN-side, fail-closed (any error → false = Tor mode). */
  loadClearnetEnabled: () => Promise<boolean>;
  /** Resolve the Tor posture from the acked clearnet flag (`session.ts` `resolveXTorGate`). */
  resolveGate: (clearnetEnabled: boolean) => XTorGate | Promise<XTorGate>;
  /** Open a hardened capture window at `url` over the resolved posture (proxy iff Tor mode). */
  openWindow: (url: string, proxy?: { socks: string }) => Promise<Electron.BrowserWindow>;
  /** Run a static payload in the capture page → its result. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** The challenge/lock gate: runs `capture` ONLY on an unblocked, signed-in page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>,
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Injected clock — the ISO verification time (determinism; never feeds a hash). */
  now: () => string;
}

function defaultVerifyDeps(): XVerifyPostDeps {
  return {
    loadClearnetEnabled: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const settings = await settingsStore.read();
        return settings.xListening?.clearnet === true;
      } catch {
        return false;
      }
    },
    resolveGate: async (clearnetEnabled) => {
      const { resolveXTorGate } = await import('./session');
      return resolveXTorGate(clearnetEnabled);
    },
    openWindow: async (url, proxy) => {
      const [{ createCaptureWindow }, sess] = await Promise.all([
        import('../capture/capture-window'),
        import('./session'),
      ]);
      const win = await createCaptureWindow({
        partition: sess.X_LISTENING_PARTITION,
        url,
        allowHosts: sess.X_ALLOW_HOSTS,
        ...(proxy ? { proxy } : {}),
        webRTCIPHandlingPolicy: 'disable_non_proxied_udp',
      });
      // Belt-and-braces re-assert on the returned webContents (idempotent) — same discipline as
      // session.ts's connectXSession.
      win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      return win;
    },
    runCapture: defaultRunCapture,
    guard: defaultGuard,
    now: () => new Date().toISOString(),
  };
}

async function resolveVerifyStore(store?: XStore): Promise<XStore> {
  if (store) return store;
  const { prodXStore } = await import('./store');
  return prodXStore();
}

/** The X hosts a verify window may resolve to — mirrors Enterprise `openPostThread`'s host set
 *  (`main.cjs:1186`), NOT the broader capture-window subdomain allowlist: a status URL always lives
 *  on the bare apex (or `www.`), so a subdomain here would be off-pattern. */
const X_POST_URL_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
/** X username shape — reused from Enterprise `openRelationshipProfile`/`openPostThread` guards. */
const X_USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Validate a stored post's live URL and return the canonical https target, or throw. Ports
 * Enterprise `openPostThread`'s guards (`main.cjs:1177-1193`): build a fallback from the (validated)
 * username + status id, prefer the stored `url`, reject any non-X host or any path lacking a
 * `/status/<digits>` segment, and force https. The username is additionally validated against
 * `^[A-Za-z0-9_]{1,15}$` (Enterprise's relationship-open guard) so a malformed handle can never
 * reach the fallback URL construction.
 */
function assertValidPostUrl(post: XPostArtifact): URL {
  const username = String(post.authorHandle ?? '').replace(/^@/, '').trim();
  if (username && !X_USERNAME_RE.test(username)) {
    throw new Error('The selected post does not carry a valid X username.');
  }
  const statusId = String(post.messageId || post.id || '').replace(/^.*:/, '');
  const fallback = `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(statusId)}`;
  let target: URL;
  try {
    target = new URL(String(post.url || fallback));
  } catch {
    target = new URL(fallback);
  }
  if (!X_POST_URL_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error('Blocked a non-X post URL.');
  }
  if (!/\/status\/\d+/i.test(target.pathname)) {
    throw new Error('The selected post does not contain a valid X status URL.');
  }
  target.protocol = 'https:';
  return target;
}

/**
 * Re-verify one captured post against its live URL (Task A1). Reads the stored post, validates its
 * URL, opens a Tor-gated capture window (FAIL CLOSED — throws, opening NO window, when Tor is down
 * and clearnet is not acked), runs the STATIC `X_VERIFY_POST_SCRIPT` under the signed-in gate, and
 * routes the outcome through A2's history/event seams. The verify window is always destroyed in a
 * `finally` (mirrors Enterprise's `finally { win.destroy() }`).
 */
export async function verifyPost(
  caseId: string,
  postId: string,
  overrides: Partial<XVerifyPostDeps> = {},
  store?: XStore,
): Promise<XVerifyPostResult> {
  const deps: XVerifyPostDeps = { ...defaultVerifyDeps(), ...overrides };
  const s = await resolveVerifyStore(store);

  const posts = await s.posts.read(caseId);
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new Error('Post not found in this campaign.');

  // Validate BEFORE touching the network — a malformed/off-host URL never opens a window.
  const target = assertValidPostUrl(post);

  // FAIL CLOSED: resolve the Tor posture and refuse (opening no window) when it is blocked.
  const clearnetEnabled = await deps.loadClearnetEnabled();
  const gate = await deps.resolveGate(clearnetEnabled);
  if (gate.blocked) throw new Error(gate.reason);

  const win = await deps.openWindow(target.toString(), gate.proxy);
  try {
    const gated = await deps.guard(win, () => deps.runCapture(win, X_VERIFY_POST_SCRIPT));
    if (gated.blocked) {
      throw new Error(gated.reason ?? 'The saved X session is no longer signed in.');
    }
    const page = (gated.result ?? {}) as Partial<XVerifyPage>;
    const body = String(page.body ?? '');
    const items = Array.isArray(page.items) ? page.items : [];
    const statusMatch = target.pathname.match(/\/status\/(\d+)/);
    const statusId = statusMatch ? statusMatch[1] : '';
    const live = statusId ? items.find((it) => String(it?.id ?? '') === statusId) ?? null : null;

    const at = deps.now();
    const sourceUsername =
      String(post.channelLabel || post.authorHandle || '') || undefined;

    if (isPostUnavailableText(body) && !live) {
      // ATOMIC: re-read fresh + update the one post inside the posts lock (the `posts` snapshot
      // above predates the multi-second network call — writing it back would clobber any posts a
      // concurrent capture added meanwhile). Report the prior availability for the transition gate;
      // if the post was concurrently removed, report 'unavailable' so no spurious event is emitted.
      const previousAvailability = await s.posts.transform(caseId, (existing) => {
        const prev = existing.find((p) => p.id === post.id);
        if (!prev) return { next: existing, write: false, result: 'unavailable' as const };
        const prevAvail = prev.availability ?? 'unknown';
        const next = existing.map((p) =>
          p.id === post.id ? { ...p, availability: 'unavailable' as const, verifiedAt: at } : p,
        );
        return { next, write: true, result: prevAvail };
      });
      // Enterprise's `previousAvailability !== 'unavailable'` gate: emit only on a transition.
      if (previousAvailability !== 'unavailable') {
        await markPostUnavailable(caseId, { postId: post.id, sourceUsername }, { now: at }, s);
      }
      return { availability: 'unavailable', verifiedAt: at, changed: false };
    }

    const liveText = live?.text ? String(live.text) : '';
    if (liveText && liveText !== String(post.text ?? '')) {
      // A text edit: route through A2's version-history path — it archives the prior version onto
      // `versionHistory` and emits ONE `post_changed`. Recompute the evidence hash on the new text
      // BEFORE the ingest so the stored artifact's hash matches its (edited) content.
      const updated: XPostArtifact = {
        ...post,
        text: liveText,
        availability: 'available',
        verifiedAt: at,
        evidenceHash: '',
      };
      updated.evidenceHash = postEvidenceHash(updated);
      await ingestPostsWithHistory(caseId, [updated], { now: at }, s);
      return { availability: 'available', verifiedAt: at, changed: true };
    }

    // Available + unchanged: stamp availability/verifiedAt only (no version, no event). ATOMIC
    // re-read inside the posts lock — the `posts` snapshot above predates the network call.
    await s.posts.transform(caseId, (existing) => {
      const next = existing.map((p) =>
        p.id === post.id ? { ...p, availability: 'available' as const, verifiedAt: at } : p,
      );
      return { next, write: existing.some((p) => p.id === post.id), result: undefined };
    });
    return { availability: 'available', verifiedAt: at, changed: false };
  } finally {
    const w = win as unknown as { isDestroyed?: () => boolean; destroy?: () => void };
    if (typeof w.destroy === 'function' && !(w.isDestroyed && w.isDestroyed())) {
      w.destroy();
    }
  }
}

// ---- Tor-gated "open in X" affordances ("View X" / Open Real Thread / Open X Profile, Task E1) --
//
// Foundational rebuild of Enterprise `openPostThread`/`openProfileFeed`/`openRelationshipProfile`
// (`feed:open-thread`/`feed:open-profile`/`identity:open-profile`/`relationships:open-profile`,
// `main.cjs:1160-1225`) as ONE hardened helper onto OUR seams. Consumed by C2b (the network graph
// inspector) and D1 (the per-source "View X" action).
//
// Unlike `verifyPost` (a HIDDEN window, run one static probe, destroyed in `finally`), this opens a
// VISIBLE window the analyst browses (Enterprise's `createRemoteWindow({ show:true })`), on the same
// authenticated X partition + the same Tor-gated posture (FAIL CLOSED — no clearnet fallback unless
// the acked clearnet toggle is on). Quarantine discipline is preserved: no static electron/Tor import
// — the production defaults lazy-import `./session` (the ONE sanctioned Tor seam) + the window factory.

/** Which X surface an `openInX` affordance targets. */
export type XOpenKind = 'thread' | 'profile' | 'identity';

/** The result of opening an in-app X window — the canonical https URL the window was pointed at. */
export interface XOpenInXResult {
  opened: true;
  url: string;
}

/** Injectable seams so `openInX` is testable without electron/network. Production defaults are lazy
 *  dynamic imports of the sanctioned Tor seam (`./session`) + the hardened window factory. */
export interface XOpenInXDeps {
  /** Read the acked clearnet opt-out MAIN-side, fail-closed (any error → false = Tor mode). */
  loadClearnetEnabled: () => Promise<boolean>;
  /** Resolve the Tor posture from the acked clearnet flag (`session.ts` `resolveXTorGate`). */
  resolveGate: (clearnetEnabled: boolean) => XTorGate | Promise<XTorGate>;
  /** Open a hardened, VISIBLE capture window at `url` over the resolved posture (proxy iff Tor). */
  openWindow: (url: string, proxy?: { socks: string }) => Promise<Electron.BrowserWindow>;
}

/**
 * Validate `ref` and construct the exact canonical X URL for `kind`, or throw — the ONLY URL any
 * `openInX` window is ever pointed at, and always built BEFORE a window opens. Pure (no network):
 *  - `'thread'`: reuse the Phase-1 `assertValidPostUrl` guards by wrapping the ref as a minimal post
 *    — a non-X host, a path lacking `/status/<digits>`, or a non-URL ref throws; https is forced.
 *  - `'profile'` / `'identity'`: strip a leading `@`, enforce `^[A-Za-z0-9_]{1,15}$`, and build
 *    `https://x.com/<user>` EXACTLY (bare profile, no `/with_replies` or any other path injection).
 */
export function buildXOpenUrl(kind: XOpenKind, ref: string): URL {
  if (kind === 'thread') {
    // The ref is a post/thread URL — reuse the exact openPostThread scheme/host/path validation.
    return assertValidPostUrl({ url: String(ref ?? '') } as XPostArtifact);
  }
  const username = String(ref ?? '').replace(/^@/, '').trim();
  if (!X_USERNAME_RE.test(username)) {
    throw new Error('The selected record does not contain a valid X username.');
  }
  return new URL(`https://x.com/${encodeURIComponent(username)}`);
}

function defaultOpenInXDeps(): XOpenInXDeps {
  return {
    loadClearnetEnabled: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const settings = await settingsStore.read();
        return settings.xListening?.clearnet === true;
      } catch {
        return false;
      }
    },
    resolveGate: async (clearnetEnabled) => {
      const { resolveXTorGate } = await import('./session');
      return resolveXTorGate(clearnetEnabled);
    },
    openWindow: async (url, proxy) => {
      const [{ createCaptureWindow }, sess] = await Promise.all([
        import('../capture/capture-window'),
        import('./session'),
      ]);
      const win = await createCaptureWindow({
        partition: sess.X_LISTENING_PARTITION,
        url,
        allowHosts: sess.X_ALLOW_HOSTS,
        ...(proxy ? { proxy } : {}),
        webRTCIPHandlingPolicy: 'disable_non_proxied_udp',
      });
      // Belt-and-braces re-assert on the returned webContents (idempotent) — same discipline as
      // session.ts's connectXSession / verifyPost's openWindow.
      win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      return win;
    },
  };
}

/**
 * Open one in-app X window for `kind`/`ref` (Task E1). Validates + constructs the URL FIRST
 * (`buildXOpenUrl` — a malformed ref throws, opening NO window and never touching the gate/network),
 * then resolves the Tor posture and refuses (opening no window) when it is blocked — FAIL CLOSED, no
 * clearnet fallback unless the acked clearnet toggle is on. The window is shown/focused (a visible
 * affordance, unlike the hidden verify window). Returns the canonical https URL it was pointed at.
 */
export async function openInX(
  kind: XOpenKind,
  ref: string,
  overrides: Partial<XOpenInXDeps> = {},
): Promise<XOpenInXResult> {
  // Validate BEFORE touching the gate or network — a malformed/off-host ref opens nothing.
  const target = buildXOpenUrl(kind, ref);

  const deps: XOpenInXDeps = { ...defaultOpenInXDeps(), ...overrides };

  // FAIL CLOSED: resolve the Tor posture and refuse (opening no window) when it is blocked.
  const clearnetEnabled = await deps.loadClearnetEnabled();
  const gate = await deps.resolveGate(clearnetEnabled);
  if (gate.blocked) throw new Error(gate.reason);

  const win = await deps.openWindow(target.toString(), gate.proxy);
  const w = win as unknown as { show?: () => void; focus?: () => void };
  w.show?.();
  w.focus?.();
  return { opened: true, url: target.toString() };
}

// ---- live follower/following network extraction (EXTRACT FOLLOWERS/FOLLOWING, Task C1) ----------
//
// Rebuild of Enterprise `extractRelationships`/`scrapeRelationshipRows` (`relationships:extract`,
// `main.cjs:2347-2455`) onto OUR hardened seams. The old clearnet-only `captureFollowers`/
// `captureFollowing` were retired at Task 16, leaving only the PURE normalizer (`normalizeNetwork`,
// extract.ts Task 7) + the persistence accumulator (`store.networks.save`) with NOTHING driving a
// live scroll-capture — this closes that gap.
//
// Structured like `verifyPost`/`openInX` (self-contained + FAIL CLOSED), not `captureTimeline`
// (which captures whatever an analyst already navigated to): it OPENS its own Tor-gated window on
// the shared authenticated X partition, navigates it to `https://x.com/<user>/{followers|following}`
// (URL validated + built BEFORE the gate/network are ever touched), gates the page (signed-in),
// scroll-scrapes the visible `UserCell` rows with the STATIC `USER_CELL_SCRIPT` (no interpolation),
// accumulates unique handles across bounded passes (stagnation-stop), normalizes + persists via the
// same accumulator a re-scan uses, emits a run-log record, and ALWAYS destroys the window in a
// `finally`. Remote avatars are dropped by `normalizeUserCell` (no remote-media inlining) — avatar
// enrichment is out of scope here (per-profile image policy is F1).

/** The renderer-supplied context for one network extraction. `channelId` is the source profile id
 *  the run-log record is keyed on (defaults to `targetUsername` at the caller); `targetUsername` is
 *  whose followers/following to extract; `passes` bounds the scroll loop. */
export interface XNetworkCaptureRequest {
  caseId: string;
  channelId: string;
  targetUsername: string;
  kind: 'followers' | 'following';
  /** Scroll passes — clamped to [1, 60]. Defaults to `DEFAULT_NETWORK_PASSES`. */
  passes?: number;
}

export interface XNetworkCaptureResult {
  blocked: boolean;
  reason?: string;
  kind: 'followers' | 'following';
  /** The canonical `@handle` the extraction targeted. */
  target: string;
  /** Accounts observed on this scan (`= accounts.length`). */
  observed: number;
  /** Accounts newly persisted vs the prior accumulator for this (target, kind). */
  added: number;
  /** How many scroll passes actually ran. */
  completedPasses: number;
  /** True iff the loop stopped on stagnation (a stable end) rather than the pass ceiling. */
  reachedEnd: boolean;
}

/** Injectable seams so extraction is testable without electron/network/secure-fs. Production
 *  defaults are lazy dynamic imports of the sanctioned Tor seam (`./session`) + the hardened window
 *  factory + the encrypted store / run-log — this module statically imports NONE of them. */
export interface XNetworkCaptureDeps {
  /** Read the acked clearnet opt-out MAIN-side, fail-closed (any error → false = Tor mode). */
  loadClearnetEnabled: () => Promise<boolean>;
  /** Resolve the Tor posture from the acked clearnet flag (`session.ts` `resolveXTorGate`). */
  resolveGate: (clearnetEnabled: boolean) => XTorGate | Promise<XTorGate>;
  /** Open a hardened capture window at `url` over the resolved posture (proxy iff Tor mode). */
  openWindow: (url: string, proxy?: { socks: string }) => Promise<Electron.BrowserWindow>;
  /** Run a static payload in the capture page → its result. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** The challenge/lock gate: runs `capture` ONLY on an unblocked, signed-in page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>,
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Scroll the capture page one step (a static in-page payload, no interpolation). */
  scroll: (win: Electron.BrowserWindow) => Promise<void>;
  /** Read the ALREADY-persisted accounts for one (target, kind) — used only to report an honest
   *  `added` delta against the accumulator, never to gate the scan. */
  readNetwork: (
    caseId: string,
    target: string,
    kind: 'followers' | 'following',
  ) => Promise<XNetworkAccount[]>;
  /** Persist the freshly captured artifact (store.ts `networks.save`, the Task 7 accumulator). */
  saveNetwork: (caseId: string, artifact: XNetworkArtifact) => Promise<number>;
  /** Append one collection-run record best-effort (telemetry, not evidence — see `emitRun`). */
  recordRun: (caseId: string, record: XRunLogRecord) => Promise<void>;
  /** Read this campaign's per-campaign collection settings (F2) — the source of the default
   *  scroll-pass budget when `req.passes` is unset. Production default is the encrypted
   *  `getCollectionSettings` (fail-safe to `DEFAULT_COLLECTION_SETTINGS`); a unit harness injects
   *  its own so the network loop can be bound deterministically. */
  loadCollectionSettings: (caseId: string) => Promise<XCollectionSettings> | XCollectionSettings;
  /** Injected clock — the ISO capture time (determinism; feeds `capturedAt`/`firstObservedAt`). */
  now: () => string;
}

/** Default scroll passes when the caller doesn't specify — matches Enterprise's
 *  `relationshipScrollPasses` default (`main.cjs:2354`). */
export const DEFAULT_NETWORK_PASSES = 8;
/** Consecutive no-growth passes that end the loop early (a stable end). */
const NETWORK_STAGNATION_LIMIT = 3;

/** STATIC scroll payload — the ONLY inputs are literal numbers; no scraped data is interpolated.
 *  Jumps ~90% of the viewport (min 650px), matching Enterprise's `scrapeRelationshipRows` scroll. */
const X_NETWORK_SCROLL_SCRIPT = `
  (() => {
    const s = document.scrollingElement || document.documentElement;
    const jump = Math.max(innerHeight * 0.9, 650);
    s.scrollTo({ top: Math.min(s.scrollHeight, (s.scrollTop || 0) + jump), behavior: 'auto' });
    return true;
  })()
`;

/**
 * Validate `target` and construct the exact canonical `/followers` or `/following` URL, or throw —
 * the ONLY URL a `captureNetwork` window is ever pointed at, and always built BEFORE a window opens.
 * Pure (no network): strip a leading `@`, enforce `^[A-Za-z0-9_]{1,15}$` (the same guard
 * `openPostThread`/`openRelationshipProfile` used), and build `https://x.com/<user>/<kind>` EXACTLY
 * (no path injection). `kind` is the fixed literal `'followers'`/`'following'`, never interpolated
 * from untrusted input.
 */
export function buildNetworkUrl(target: string, kind: 'followers' | 'following'): URL {
  const username = String(target ?? '').replace(/^@/, '').trim();
  if (!X_USERNAME_RE.test(username)) {
    throw new Error('The selected target does not contain a valid X username.');
  }
  const path = kind === 'following' ? 'following' : 'followers';
  return new URL(`https://x.com/${encodeURIComponent(username)}/${path}`);
}

function defaultNetworkCaptureDeps(): XNetworkCaptureDeps {
  return {
    loadClearnetEnabled: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const settings = await settingsStore.read();
        return settings.xListening?.clearnet === true;
      } catch {
        return false;
      }
    },
    resolveGate: async (clearnetEnabled) => {
      const { resolveXTorGate } = await import('./session');
      return resolveXTorGate(clearnetEnabled);
    },
    openWindow: async (url, proxy) => {
      const [{ createCaptureWindow }, sess] = await Promise.all([
        import('../capture/capture-window'),
        import('./session'),
      ]);
      const win = await createCaptureWindow({
        partition: sess.X_LISTENING_PARTITION,
        url,
        allowHosts: sess.X_ALLOW_HOSTS,
        ...(proxy ? { proxy } : {}),
        webRTCIPHandlingPolicy: 'disable_non_proxied_udp',
      });
      // Belt-and-braces re-assert on the returned webContents (idempotent) — same discipline as
      // verifyPost's openWindow.
      win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      return win;
    },
    runCapture: defaultRunCapture,
    guard: defaultGuard,
    scroll: async (win) => {
      await defaultRunCapture(win, X_NETWORK_SCROLL_SCRIPT);
    },
    readNetwork: async (caseId, target, kind) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      const artifacts = await store.networks.read(caseId);
      const t = target.toLowerCase();
      const hit = artifacts.find(
        (a) => String(a.target ?? '').toLowerCase() === t && a.kind === kind,
      );
      return hit?.accounts ?? [];
    },
    saveNetwork: async (caseId, artifact) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.networks.save(caseId, artifact);
    },
    recordRun: async (caseId, record) => {
      await recordCollectionRun(caseId, record);
    },
    loadCollectionSettings: async (caseId) => {
      const { getCollectionSettings } = await import('./collection-settings');
      return getCollectionSettings(caseId);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Scroll-scrape the visible follower/following `UserCell` rows, accumulating unique handles across
 * bounded passes. Runs the STATIC `USER_CELL_SCRIPT` each pass, dedups case-insensitively by handle
 * (the same key `normalizeNetwork`/`store.networks.save` use), and stops early once
 * `NETWORK_STAGNATION_LIMIT` consecutive passes add nothing new (a stable end). Never runs the
 * scroll after the final pass (gentle on X). Returns the accumulated raw cells + the loop telemetry.
 */
async function scrapeNetworkRows(
  win: Electron.BrowserWindow,
  passes: number,
  deps: XNetworkCaptureDeps,
): Promise<{ rows: RawUserCell[]; completedPasses: number; reachedEnd: boolean }> {
  const seen = new Map<string, RawUserCell>();
  let completedPasses = 0;
  let stagnant = 0;
  let reachedEnd = false;
  for (let i = 0; i < passes; i += 1) {
    completedPasses = i + 1;
    const raw = await deps.runCapture(win, USER_CELL_SCRIPT);
    const rows: RawUserCell[] = Array.isArray(raw) ? (raw as RawUserCell[]) : [];
    const before = seen.size;
    for (const row of rows) {
      const handle = String(row?.username ?? '').replace(/^@+/, '');
      const key = handle.toLowerCase();
      if (handle && !seen.has(key)) seen.set(key, row);
    }
    if (seen.size === before) stagnant += 1;
    else stagnant = 0;
    if (i >= passes - 1) break;
    if (stagnant >= NETWORK_STAGNATION_LIMIT) {
      reachedEnd = true;
      break;
    }
    await deps.scroll(win);
  }
  return { rows: [...seen.values()], completedPasses, reachedEnd };
}

/**
 * Extract one target's followers or following (Task C1). Validates the target + builds the URL FIRST
 * (a malformed handle throws, opening NO window and never touching the gate/network), then resolves
 * the Tor posture and refuses (opening no window, persisting nothing) when it is blocked — FAIL
 * CLOSED, no clearnet fallback unless the acked clearnet toggle is on. Opens a hidden Tor-gated
 * window on the shared authenticated X partition, gates the page (signed-in), scroll-scrapes the
 * visible `UserCell` rows, normalizes them (`normalizeNetwork` — evidence-hashed, remote avatars
 * dropped), persists via the accumulator, and emits a run-log record. The window is ALWAYS destroyed
 * in a `finally` (mirrors Enterprise's `finally { win.destroy() }`).
 */
export async function captureNetwork(
  req: XNetworkCaptureRequest,
  overrides: Partial<XNetworkCaptureDeps> = {},
): Promise<XNetworkCaptureResult> {
  const kind: 'followers' | 'following' = req.kind === 'following' ? 'following' : 'followers';
  // Validate BEFORE touching the gate or network — a malformed target opens nothing.
  const url = buildNetworkUrl(req.targetUsername, kind);

  const deps: XNetworkCaptureDeps = { ...defaultNetworkCaptureDeps(), ...overrides };
  // F2: the scroll-pass budget defaults to the per-campaign follower/following base passes (Enterprise
  // `relationshipScrollPasses`, split per direction). An explicit `req.passes` still overrides. The
  // settings read is fail-safe (`getCollectionSettings` heals to defaults), so this never blocks a
  // capture; the value is re-clamped to [1,60] here regardless of source (defence-in-depth over the
  // already-clamped stored value).
  const settings = await deps.loadCollectionSettings(req.caseId);
  const basePasses = kind === 'following' ? settings.followingBasePasses : settings.followerBasePasses;
  const passes = Math.max(1, Math.min(60, Math.floor(Number(req.passes ?? basePasses)) || basePasses));
  const startedAt = deps.now();
  const username = String(req.targetUsername ?? '').replace(/^@+/, '').trim();
  const fullTarget = `@${username}`;
  const profileId = String(req.channelId ?? '') || username;

  // FAIL CLOSED: resolve the Tor posture and refuse (opening no window) when it is blocked.
  const clearnetEnabled = await deps.loadClearnetEnabled();
  const gate = await deps.resolveGate(clearnetEnabled);
  if (gate.blocked) {
    await emitNetworkRun(deps, req.caseId, {
      profileId,
      username,
      operation: kind,
      observed: 0,
      added: 0,
      requestedPasses: passes,
      completedPasses: 0,
      reachedEnd: false,
      stopReason: gate.reason ?? 'blocked',
      status: 'error',
      startedAt,
      endedAt: deps.now(),
    });
    return { blocked: true, reason: gate.reason, kind, target: fullTarget, observed: 0, added: 0, completedPasses: 0, reachedEnd: false };
  }

  const win = await deps.openWindow(url.toString(), gate.proxy);
  try {
    const gated = await deps.guard(win, () => scrapeNetworkRows(win, passes, deps));
    if (gated.blocked) {
      await emitNetworkRun(deps, req.caseId, {
        profileId,
        username,
        operation: kind,
        observed: 0,
        added: 0,
        requestedPasses: passes,
        completedPasses: 0,
        reachedEnd: false,
        stopReason: gated.reason ?? 'blocked',
        status: 'error',
        startedAt,
        endedAt: deps.now(),
      });
      return { blocked: true, reason: gated.reason, kind, target: fullTarget, observed: 0, added: 0, completedPasses: 0, reachedEnd: false };
    }

    const { rows, completedPasses, reachedEnd } = gated.result ?? {
      rows: [],
      completedPasses: 0,
      reachedEnd: false,
    };
    const capturedAt = deps.now();
    const artifact = normalizeNetwork(rows, username, kind, capturedAt);

    // Honest `added` delta: how many of this scan's accounts weren't already in the accumulator.
    const prior = await deps.readNetwork(req.caseId, fullTarget, kind);
    const priorHandles = new Set(prior.map((a) => a.handle.toLowerCase()));
    const added = artifact.accounts.filter((a) => !priorHandles.has(a.handle.toLowerCase())).length;

    await deps.saveNetwork(req.caseId, artifact);

    await emitNetworkRun(deps, req.caseId, {
      profileId,
      username,
      operation: kind,
      observed: artifact.accounts.length,
      added,
      requestedPasses: passes,
      completedPasses,
      reachedEnd,
      stopReason: reachedEnd ? 'stable_end' : 'pass_limit',
      status: 'complete',
      startedAt,
      endedAt: deps.now(),
    });

    return {
      blocked: false,
      kind,
      target: fullTarget,
      observed: artifact.accounts.length,
      added,
      completedPasses,
      reachedEnd,
    };
  } finally {
    const w = win as unknown as { isDestroyed?: () => boolean; destroy?: () => void };
    if (typeof w.destroy === 'function' && !(w.isDestroyed && w.isDestroyed())) {
      w.destroy();
    }
  }
}

/** Append one network run record best-effort (Task A3). Telemetry, NOT evidence — a run-log write
 *  failure must never break an extraction or drop captured accounts, so any error is swallowed with
 *  a warn (mirrors `emitRun`). */
async function emitNetworkRun(
  deps: XNetworkCaptureDeps,
  caseId: string,
  input: RunRecordInput,
): Promise<void> {
  try {
    await deps.recordRun(caseId, buildRunRecord(input));
  } catch (err) {
    console.warn('[XListening] recordRun (network):', err);
  }
}
