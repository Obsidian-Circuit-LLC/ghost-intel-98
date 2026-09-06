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
  X_NETWORK_COLLECTOR_INSTALL_SCRIPT,
  X_NETWORK_COLLECTOR_READ_SCRIPT,
  type XNetworkCollectorState,
  classifyXPageState,
  isPostUnavailableText,
  normalizePost,
  normalizeReply,
  normalizeRepost,
  normalizeComment,
  normalizeNetwork,
  selectTimelineCaptures,
  selectThreadComments,
  X_PROFILE_META_SCRIPT,
  type RawPost,
  type RawProfileMeta,
  type RawUserCell,
  type NormalizeContext,
  type XHarvestedItem,
  type XCollectSettings,
  type XPageState,
  type XVerifyPage,
} from './extract';
import { postEvidenceHash } from './evidence';
import { withNavigationTimeout, NAVIGATION_TIMEOUT_MS } from '../capture/nav-timeout';
import {
  ingestPostsWithHistory,
  markPostUnavailable,
  snapshotProfile,
  type ProfileSnapshotInput,
  type ProfileSnapshotResult,
} from './changes';
import { MEDIA_HOST_ALLOWLIST } from '../capture/security';
import { buildRunRecord, recordCollectionRun, type RunRecordInput } from './run-log';
import { deriveNetworkDeltaEvents, dedupeHandlesCI, X_MAX_SCAN_OBSERVED } from './store';
import type {
  XNetworkAccount,
  XNetworkArtifact,
  XNetworkDeltaEvent,
  XNetworkScanState,
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
import { normalizeXSourceKey } from '@shared/x-listening-source';

/** This collector's version, stamped into every item's provenance. */
export const X_COLLECTOR_VERSION = 'x-listening/1.0.0';

/** The UNATTENDED clearnet gate: a background auto-sweep or startup avatar-repair pass leaves Tor
 *  ONLY when clearnet is BOTH enabled AND acknowledged — stricter than the interactive paths (which
 *  trust the one-time-acked toggle). A `clearnet:true` that somehow predates its ack fails closed to
 *  Tor. This is the single composition both unattended paths call, so a regression to `||` or the
 *  wrong field is caught by one unit test rather than shipping a clearnet-without-ack window. */
export function requireAckedClearnet(
  settings: { xListening?: { clearnet?: boolean; clearnetAck?: boolean } } | null | undefined,
): boolean {
  return settings?.xListening?.clearnet === true && settings?.xListening?.clearnetAck === true;
}

/** All-off collect gate — a target's own top-level posts only. The trusted default; the
 *  renderer never widens capture — the caller (Task 6 IPC handler) reads the real setting
 *  MAIN-side from `AppSettings.xListening.collect` and passes it in. */
export const DEFAULT_COLLECT: XCollectSettings = {
  replies: false,
  reposts: false,
  comments: false,
};

/** FA1 scroll-and-accumulate loop bounds — Enterprise `scrapeProfile`'s hard clamps (`main.cjs:1657-1658`).
 *  The persisted `profileScrollPasses` is already clamped to `[1,20]` by the shared reducer; this is a
 *  defence-in-depth re-clamp (and it also bounds any `req.passes` override the archive path supplies). */
export const MAX_PROFILE_SCROLL_PASSES = 120;
const MIN_PROFILE_SCROLL_PASSES = 1;
const MIN_PASS_DELAY_MS = 500;
const MAX_PASS_DELAY_MS = 5000;
/** Consecutive no-growth passes that end the scroll loop early (a stable end — the timeline gave
 *  nothing new). Enterprise `scrapeProfile` stops after 5 stagnant passes (`main.cjs:1681,1691`). */
const TIMELINE_STAGNATION_LIMIT = 5;

/** FA3 comment-thread clamps — Enterprise `scrapeCommentsForPosts`'s bounds (`main.cjs:1606-1608`),
 *  re-clamped MAIN-side (defence-in-depth) even though the shared reducer already bounds the persisted
 *  `commentThreadsPerSource` / `commentScrollPasses`. `MAX_COMMENT_SCROLL_PASSES` follows OUR shared
 *  clamp band (`[1,12]`), the ceiling the settings reducer already enforces. */
const MIN_COMMENT_THREADS = 1;
const MAX_COMMENT_THREADS = 20;
const MIN_COMMENT_SCROLL_PASSES = 1;
const MAX_COMMENT_SCROLL_PASSES = 12;
/** Fixed post-navigation SPA-render settle before a thread's comments are read — Enterprise
 *  `scrapeCommentsForPosts` sleeps 2500ms after `loadURL` and before `assertSignedInPage`
 *  (`main.cjs:1613-1614`). Wall-clock pacing only; feeds NO evidence/hash path. */
const COMMENT_THREAD_SETTLE_MS = 2500;

/** Fixed post-navigation SPA-render settle before a live post is READ during verification —
 *  Enterprise `verifyPostLive` does `loadURL` → `sleep(2600)` → `assertSignedInPage` → read
 *  (`main.cjs:2626-2640`). Without it the read can race X's client-side hydration and misread a
 *  not-yet-rendered page as "available, unchanged". Wall-clock pacing only; feeds NO evidence/hash
 *  path. Exported so the verify suite can assert the ceiling. */
export const VERIFY_POST_SETTLE_MS = 2600;

/** Fixed post-navigation SPA-render settle before a PROFILE PAGE is read during collection —
 *  Enterprise `scrapeProfile` does `loadURL` → `sleep(3500)` → `assertSignedInPage` →
 *  `readProfileMetadata` (`main.cjs`), and this port had no settle at all: it read the header in
 *  the same tick it was handed the window.
 *
 *  The header is where the DISPLAY PICTURE comes from, so reading it unpainted stores a source
 *  with no picture — intermittently, depending on how fast the page rendered. That is why the
 *  same feature could be confirmed working in one release and reported broken in the next with
 *  nothing in between touching picture collection. The manual path masked it: `navigateXToProfile`
 *  polls until `articles > 0` before handing the window over; the sweep and archive paths get no
 *  such pre-wait.
 *
 *  Wall-clock pacing only; feeds NO evidence/hash path. */
export const TIMELINE_SETTLE_MS = 3500;

/** Fixed post-navigation SPA-render settle before the follower/following list is read — Enterprise
 *  `scrapeRelationshipRows` does `loadURL` → `sleep(3500)` → `assertSignedInPage` → install the
 *  page-side collector (`main.cjs:2347+`).
 *
 *  `captureNetwork` was the one capture path in this module with no pacing of any kind, which does
 *  not merely make the scrape slow — it makes it EMPTY AND SUCCESSFUL: every read lands on an
 *  unhydrated page, the no-growth counter reaches `stagnationLimit` within milliseconds, and the
 *  run returns `{ blocked: false, observed: 0, reachedEnd: true }`. Nothing failed, so nothing was
 *  reported, which is precisely the silent dead button reported from the field.
 *
 *  Wall-clock pacing only; feeds NO evidence/hash path. */
export const NETWORK_SETTLE_MS = 3500;

/** Per-pass scroll pacing band for the follower/following loop — Enterprise
 *  `scrapeRelationshipRows` clamps `scrollDelayMs` to `[500, 5000]` with an 1100ms default
 *  (`main.cjs:2347+`). Wall-clock pacing only; feeds NO evidence/hash path. */
const MIN_NETWORK_PASS_DELAY_MS = 500;
const MAX_NETWORK_PASS_DELAY_MS = 5000;
const DEFAULT_NETWORK_PASS_DELAY_MS = 1100;

/** STATIC scroll payload — no interpolation, no scraped data. Scrolls the timeline to the bottom so
 *  the SPA lazy-loads the next batch of posts before the next `X_POST_SCRIPT` scrape, exactly as
 *  Enterprise `scrapeProfile` (`window.scrollTo(0, document.body.scrollHeight)`, `main.cjs:1682-1688`).
 *  Returns the post-scroll scroll position purely for logging/telemetry — never fed back into the page. */
export const X_TIMELINE_SCROLL_SCRIPT = `
  (() => {
    const scroller = document.scrollingElement || document.documentElement;
    window.scrollTo(0, document.body.scrollHeight);
    return { top: scroller ? scroller.scrollTop : 0, height: scroller ? scroller.scrollHeight : 0 };
  })()
`;

/** Resolve the effective scroll-pass budget for one capture: an explicit finite `req.passes > 0`
 *  (the archive-depth override, FA2) beats the campaign's persisted `profileScrollPasses`; either is
 *  re-clamped to `[1, MAX_PROFILE_SCROLL_PASSES]`. Pure. */
function resolveScrollPasses(reqPasses: number | undefined, settingsPasses: number): number {
  const override = Number(reqPasses);
  const base =
    Number.isFinite(override) && override > 0 ? Math.floor(override) : Math.floor(Number(settingsPasses));
  const safe = Number.isFinite(base) && base > 0 ? base : MIN_PROFILE_SCROLL_PASSES;
  return Math.max(MIN_PROFILE_SCROLL_PASSES, Math.min(MAX_PROFILE_SCROLL_PASSES, safe));
}

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
  /** FA1 scroll-depth OVERRIDE: how many scroll-and-accumulate passes to run. When set (finite,
   *  > 0) it beats this campaign's persisted `profileScrollPasses` — the seam the incremental-archive
   *  path (FA2) uses to deepen a profile's capture cycle by cycle (Enterprise `scrapeProfile`'s
   *  `options.passes`, `main.cjs:1654`). Absent ⇒ the campaign's `profileScrollPasses` drives the loop.
   *  Re-clamped to `[1, MAX_PROFILE_SCROLL_PASSES]` MAIN-side regardless of source. */
  passes?: number;
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
  /** F1: resolve THIS source's EFFECTIVE image-collection policy — the per-profile `imageMode`
   *  override ('on'/'off'/'inherit') resolved against F2's per-campaign `retrieveImages` toggle.
   *  When it returns false, the timeline capture skips media caching for EVERY post of this source:
   *  `resolveMedia` is never called, so no `pbs.twimg.com` fetch is issued at all — the source's
   *  post media is simply not retrieved. Production default is image-policy.ts's
   *  `resolveEffectiveImageCollection`, fail-safe to TRUE (the pre-F1 behaviour) on any read hiccup. */
  imagesEnabledForSource: (caseId: string, sourceKey: string) => Promise<boolean>;
  /** Append one collection-run record for this capture (Task A3). Production default routes to the
   *  encrypted `runLog` sidecar via run-log.ts. A run-log write is OPERATIONAL telemetry, NOT
   *  evidence — a failure here MUST NOT break the capture or drop captured posts, so
   *  `captureTimeline` calls this best-effort (see `emitRun`). */
  recordRun: (caseId: string, record: XRunLogRecord) => Promise<void>;
  /** FA1: read THIS campaign's per-campaign COLLECTION SETTINGS — the source of the scroll-pass
   *  budget (`profileScrollPasses`) and the inter-pass delay (`delayPerPassMs`) when `req.passes` is
   *  unset. Production default is the fail-safe `getCollectionSettings` (heals to
   *  `DEFAULT_COLLECTION_SETTINGS` on any read error), so a settings hiccup degrades to the
   *  minimal-capture default depth rather than breaking the capture; a unit harness injects its own
   *  so the scroll loop can be bound deterministically. */
  loadCollectionSettings: (caseId: string) => Promise<XCollectionSettings> | XCollectionSettings;
  /** FA1: scroll the capture page to the bottom for the next pass (a static in-page payload, no
   *  interpolation — `window.scrollTo(0, document.body.scrollHeight)`). Injected so the accumulate
   *  loop is exercisable without a live window; the production default runs
   *  `X_TIMELINE_SCROLL_SCRIPT`. Never called after the final pass (gentle on X). */
  scroll: (win: Electron.BrowserWindow) => Promise<void>;
  /** FA3 (audit HIGH #3): navigate the capture window to a NEW url — the comment-thread scraping path
   *  loads each captured root post's thread URL into the SAME hidden, Tor-gated window (Enterprise
   *  `scrapeCommentsForPosts` calls `win.loadURL(rootPost.url)`, `main.cjs:1612`). The URL passed here
   *  is ALWAYS the canonical `https://x.com/<user>/status/<id>` returned by `assertValidPostUrl` —
   *  host-anchored + username-validated + `/status/<digits>`-checked BEFORE this seam is ever called,
   *  so an off-host / malformed post URL is never loaded. Injected so the comment path is exercisable
   *  without a live window; the production default is `win.loadURL(url)`. */
  navigate: (win: Electron.BrowserWindow, url: string) => Promise<void>;
  /** FA1 (finding 1): re-probe the page's signed-in/challenge state MID-SCROLL — Enterprise
   *  `scrapeProfile` calls `assertSignedInPage(win)` after EVERY scroll (`main.cjs:1690`) so a session
   *  drop or a verification challenge that surfaces AFTER a scroll stops the capture immediately. The
   *  accumulate loop calls this after each scroll+delay and, on `{ blocked: true }`, BREAKS and records
   *  the run as an ERROR (stopReason `'challenge'`) rather than scrolling+scraping a flagged page for
   *  more passes and then dishonestly logging a clean stable end. Production default reuses the same
   *  static `X_PAGE_STATE_SCRIPT` probe `guard` uses; a unit harness injects its own. */
  assertSignedIn: (win: Electron.BrowserWindow) => Promise<{ blocked: boolean; reason?: string }>;
  /** FA1: await `ms` between scroll passes (Enterprise `scrollDelayMs`, ~1100ms) so the SPA has time
   *  to render the newly-scrolled-in posts before the next scrape. Injected (no-op) in unit harnesses
   *  so the loop runs instantly; the production default is a real `setTimeout`-backed sleep. Wall-clock
   *  pacing only — it feeds NO evidence/hash path. */
  delay: (ms: number) => Promise<void>;
  /** FB2 (audit HIGH #7): read the target profile HEADER's visible metadata (display name / bio /
   *  location / website / avatar) from the SIGNED-IN capture page via the STATIC `X_PROFILE_META_SCRIPT`,
   *  host-anchoring the avatar. Returns `null` when the header could not be read (Enterprise
   *  `readProfileMetadata` swallows its own errors to `null`). Used to feed `snapshotProfile` so a
   *  bio/avatar/location/website/DISPLAY-NAME change over time emits a `profile_change`. Injected so
   *  the profile-change path is exercisable without a live window. */
  readProfileMeta: (win: Electron.BrowserWindow) => Promise<RawProfileMeta | null>;
  /** FB2: snapshot the captured profile's metadata + emit a `profile_change` on a metadata-signature
   *  diff vs the last snapshot (the first snapshot is a baseline, no event). Production default routes
   *  to changes.ts `snapshotProfile` over the encrypted `profileSnapshots` / `changeEvents` sidecars;
   *  a unit harness injects one bound to an in-memory store. */
  snapshotProfile: (
    caseId: string,
    input: ProfileSnapshotInput,
    opts: { now: string },
  ) => Promise<ProfileSnapshotResult>;
  /** Injected clock — the ISO capture time stamped onto every item. */
  now: () => string;
}

/** Default in-page runner — the same static-payload executor the capture stack uses,
 *  inlined so this module does not statically import electron. `userGesture=true`. */
function defaultRunCapture(win: Electron.BrowserWindow, js: string): Promise<unknown> {
  return win.webContents.executeJavaScript(js, true);
}

/**
 * FA1 (finding 1): probe the capture page's signed-in/challenge state via the STATIC
 * `X_PAGE_STATE_SCRIPT` and classify it (the two `assertSignedInPage` branches: a challenge OR a
 * signed-out page → `{ blocked: true }`). Shared by the up-front `defaultGuard` AND the MID-SCROLL
 * re-assertion (`defaultDeps().assertSignedIn`) so both apply identical fail-closed semantics.
 */
async function probeSignedInState(
  win: Electron.BrowserWindow,
): Promise<{ blocked: boolean; reason?: string }> {
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
  return { blocked: false };
}

/**
 * The production challenge/lock gate: probe the visible page and refuse on a challenge OR
 * a signed-out page (the two `assertSignedInPage` branches); otherwise run the capture.
 * Uses `probeSignedInState` (which uses `defaultRunCapture`) for the up-front probe.
 */
async function defaultGuard<T>(
  win: Electron.BrowserWindow,
  capture: () => Promise<T>,
): Promise<{ blocked: boolean; reason?: string; result?: T }> {
  const state = await probeSignedInState(win);
  if (state.blocked) return { blocked: true, reason: state.reason };
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
    imagesEnabledForSource: async (caseId, sourceKey) => {
      // Fail-safe TRUE: a policy read hiccup must never silently STOP collecting media (a functional
      // regression); an explicit 'off' takes effect only when the sidecar reads cleanly. The media
      // fetch this gates is host-anchored + Tor-gated regardless, so 'off' is data-minimization, not
      // a security boundary — degrading to the campaign-inherit behaviour is the safe direction.
      try {
        const { resolveEffectiveImageCollection } = await import('./image-policy');
        return resolveEffectiveImageCollection(caseId, sourceKey);
      } catch {
        return true;
      }
    },
    recordRun: async (caseId, record) => {
      await recordCollectionRun(caseId, record);
    },
    loadCollectionSettings: async (caseId) => {
      const { getCollectionSettings } = await import('./collection-settings');
      return getCollectionSettings(caseId);
    },
    scroll: async (win) => {
      await defaultRunCapture(win, X_TIMELINE_SCROLL_SCRIPT);
    },
    navigate: async (win, url) => {
      // Bounded (v3.72.2): a stalled navigation must fail, not hold the collection mutex forever.
      await withNavigationTimeout(() => win.loadURL(url), NAVIGATION_TIMEOUT_MS, url);
    },
    assertSignedIn: (win) => probeSignedInState(win),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readProfileMeta: async (win) => {
      try {
        const raw = await defaultRunCapture(win, X_PROFILE_META_SCRIPT);
        return normalizeProfileMeta(raw);
      } catch {
        // Enterprise `readProfileMetadata` swallows any scrape error to `null` — a header that
        // could not be read simply skips the snapshot, never breaks the capture.
        return null;
      }
    },
    snapshotProfile: (caseId, input, opts) => snapshotProfile(caseId, input, opts),
    now: () => new Date().toISOString(),
  };
}

/** Host-anchor a scraped profile-header avatar `src` (FB2): return it VERBATIM only when its host is
 *  the X image CDN (exact host or a subdomain of a `MEDIA_HOST_ALLOWLIST` entry — the same named,
 *  auditable allowlist the media-fetch path enforces), else ''. Anchored on `new URL(...).hostname`,
 *  NOT a substring, so an off-allowlist decoy (`https://evil.example/?x=pbs.twimg.com`) is dropped.
 *  The URL is never fetched or inlined here — it is used ONLY as a change fingerprint in the snapshot
 *  signature, so an avatar swap flips the signature and emits a `profile_change`. */
export function hostAnchoredAvatar(rawUrl: string): string {
  const url = String(rawUrl ?? '').trim();
  if (!url) return '';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  const allowed = MEDIA_HOST_ALLOWLIST.some((a) => host === a || host.endsWith(`.${a}`));
  return allowed ? url : '';
}

/** Coerce a raw profile-header scrape into a `RawProfileMeta`, trimming every text field and
 *  host-anchoring the avatar. Pure (no fetch); `null`/malformed input → all-empty. */
export function normalizeProfileMeta(raw: unknown): RawProfileMeta {
  const r = (raw ?? {}) as Partial<RawProfileMeta>;
  return {
    displayName: String(r.displayName ?? '').trim(),
    bio: String(r.bio ?? '').trim(),
    location: String(r.location ?? '').trim(),
    website: String(r.website ?? '').trim(),
    avatar: hostAnchoredAvatar(String(r.avatar ?? '')),
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
    // Carry the per-post display name (M1) when one was observed. Set BEFORE the hash, but
    // `canonicalPostEvidence` excludes it, so it is preserved for display without perturbing
    // `evidenceHash` (a repost/comment author's name is not content evidence of the post).
    ...(item.displayName ? { displayName: item.displayName } : {}),
    // Same rule as displayName: set BEFORE the hash, excluded from `canonicalPostEvidence`, so the
    // picture is preserved for display without an avatar change perturbing the evidence hash.
    ...(item.avatar ? { avatar: item.avatar } : {}),
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
  // F1: resolve THIS source's effective image policy ONCE, before the capture, keyed by the SAME
  // canonical source key the Sources cards + `removeSource` use. When false, no post media is
  // fetched/cached for this source (see the media gate in the capture loop below).
  const imagesEnabled = await deps.imagesEnabledForSource(
    req.caseId,
    normalizeXSourceKey(req.targetUsername),
  );
  // FA1: resolve the scroll-and-accumulate budget from THIS campaign's persisted COLLECTION SETTINGS
  // (`profileScrollPasses`/`delayPerPassMs`, already clamped by the shared reducer) — or the explicit
  // archive-depth override (`req.passes`, FA2). The read is fail-safe (heals to
  // `DEFAULT_COLLECTION_SETTINGS`), so a settings hiccup degrades to minimal-depth capture rather than
  // breaking the run. Re-clamped MAIN-side (defence-in-depth) regardless of source.
  const settings = await deps.loadCollectionSettings(req.caseId);
  const passes = resolveScrollPasses(req.passes, settings.profileScrollPasses);
  const rawDelay = Math.floor(Number(settings.delayPerPassMs));
  const delayMs = Math.max(
    MIN_PASS_DELAY_MS,
    Math.min(MAX_PASS_DELAY_MS, Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : MIN_PASS_DELAY_MS),
  );
  const ctx: NormalizeContext = {
    caseId: req.caseId,
    jobId: req.jobId,
    collectorVersion: X_COLLECTOR_VERSION,
    harvestedAt: startedAt,
    channelId: req.channelId,
    channelLabel: req.channelLabel,
  };

  // Post-navigation settle, BEFORE the signed-in gate and the header read — his `scrapeProfile`
  // order exactly (`loadURL` → `sleep(3500)` → `assertSignedInPage` → `readProfileMetadata`). This
  // port had none, so on a slow render the header was read unpainted and the source was stored
  // with no display picture. Fail SOFT, the same posture as the verify and comment settles: a
  // settle that rejects must not abort a collection.
  try {
    await deps.delay(TIMELINE_SETTLE_MS);
  } catch {
    /* ignore a settle error — proceed to read, same soft posture as the other capture paths */
  }

  const gated = await deps.guard(win, async () => {
    // FA1: scroll-and-accumulate. Run `X_POST_SCRIPT` each pass (the ONLY payload ever run against the
    // capture page — still static, no scraped-data interpolation), accumulating the visible items by
    // Enterprise's `${id}:${repost|tweet}` key so a repost and the original tweet of the same status id
    // never collapse. Between passes scroll to the bottom + await `delayMs` so the SPA lazy-loads the
    // next batch; stop early after `TIMELINE_STAGNATION_LIMIT` consecutive no-growth passes (a stable
    // end), and never scroll after the final pass.
    //
    // FA1 finding 2 — iteration count matches Enterprise `scrapeProfile` EXACTLY: `for (index = 0;
    // index <= passes; index++)` (`main.cjs:1665`) ⇒ `passes + 1` reads and `passes` scrolls. The
    // previous `i < passes` loop read one viewport too few on every sweep (a systematic ~1-pass-
    // shallower capture, worst on a still-arriving prolific timeline).
    //
    // FA1 finding 1 — a challenge is re-checked MID-SCROLL: `deps.assertSignedIn(win)` runs after each
    // scroll+delay (Enterprise's `assertSignedInPage` at `main.cjs:1690`). The up-front `guard` only
    // covers the INITIAL page state; without this a session drop / verification challenge surfacing
    // after pass N would let us keep scrolling+scraping a flagged page for the rest of the budget and
    // then log the sweep as a clean stable end. On a mid-scroll block we stop and surface it so the
    // caller records an ERROR run (stopReason `'challenge'`), discarding the partial capture.
    // FB2 (audit HIGH #7): read the target profile HEADER's metadata FIRST — on the initial, still-
    // signed-in page, BEFORE the scroll loop (Enterprise `scrapeProfile` calls `readProfileMetadata`
    // before its post loop, `main.cjs:1652`). Carried out of the guard so the snapshot/`profile_change`
    // persistence happens alongside `savePosts` (never inside the scrape callback). `null` ⇒ no header.
    const profileMeta = await deps.readProfileMeta(win);
    const byKey = new Map<string, RawPost>();
    let stagnant = 0;
    let previousSize = 0;
    let completedPasses = 0;
    let challenged = false;
    let challengeReason: string | undefined;
    for (let i = 0; i <= passes; i += 1) {
      completedPasses = i + 1;
      const rawCollected = await deps.runCapture(win, X_POST_SCRIPT);
      const raws: RawPost[] = Array.isArray(rawCollected) ? (rawCollected as RawPost[]) : [];
      for (const r of raws) {
        const id = String(r?.id ?? '');
        if (!id) continue;
        byKey.set(`${id}:${r?.isRepost ? 'repost' : 'tweet'}`, r);
      }
      // FA-A review (Minor): don't let a slow-rendering SPA's LEADING empty reads trip the stable-end
      // early-stop before any post has appeared (the sweep/archive path has no article>0 pre-wait
      // that navigateXToProfile gives the manual path). Only count no-growth passes toward stagnation
      // once at least one post has been seen; leading all-empty reads just wait for the render.
      if (byKey.size !== previousSize) stagnant = 0;
      else if (byKey.size > 0) stagnant += 1;
      previousSize = byKey.size;
      if (stagnant >= TIMELINE_STAGNATION_LIMIT) break; // stable end reached
      if (i >= passes) break; // final pass — never scroll past the last read
      await deps.scroll(win);
      await deps.delay(delayMs);
      const midState = await deps.assertSignedIn(win);
      if (midState.blocked) {
        challenged = true;
        challengeReason = midState.reason;
        break;
      }
    }
    // Reached a stable end iff the most recent pass produced no new content AND no challenge cut the
    // loop short — covers both the stagnation early-stop AND a budget that ran out exactly as the
    // timeline did. `false` means the pass ceiling was hit while posts were still arriving (there may
    // be more, honestly reported).
    const reachedEnd = !challenged && stagnant > 0;

    if (challenged) {
      // A mid-scroll challenge: DISCARD the partial capture (Enterprise's `assertSignedInPage` throws,
      // so its `scrapeProfile` ingests nothing) and surface the block — the caller logs an ERROR run.
      return { results: [], completedPasses, reachedEnd: false, challenged: true, challengeReason, profileMeta };
    }

    const union = [...byKey.values()];
    const selections = selectTimelineCaptures(union, req.targetUsername, collect);
    const results: { item: XHarvestedItem; mediaRefs: string[] }[] = [];
    for (const { raw, kind } of selections) {
      const item =
        kind === 'reply' ? normalizeReply(raw, ctx) : kind === 'repost' ? normalizeRepost(raw, ctx) : normalizePost(raw, ctx);
      // Resolve THIS post's media while still inside the guarded/signed-in page — same page
      // the timeline scrape itself ran against, so the media fetch below shares its cookies/
      // session state, mirroring how the scrape and the media fetch always ran against the
      // same live window in the legacy (pre-Task-15) capture path. F1: when the source's
      // effective image policy is OFF, skip media entirely — `resolveMedia` (and thus any
      // `pbs.twimg.com` fetch) is never called for this source's posts.
      const mediaRefs = imagesEnabled
        ? await resolvePostMediaRefs(win, raw, req.caseId, deps.resolveMedia)
        : [];
      results.push({ item, mediaRefs });
    }
    return { results, completedPasses, reachedEnd, challenged: false, challengeReason: undefined, profileMeta };
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
      requestedPasses: passes,
      completedPasses: 0,
      reachedEnd: false,
      stopReason: gated.reason ?? 'blocked',
      status: 'error',
      startedAt,
      endedAt: deps.now(),
    });
    return { blocked: true, reason: gated.reason, added: 0, skipped: 0, posts: [] };
  }

  const gatedResult = gated.result ?? {
    results: [],
    completedPasses: 0,
    reachedEnd: false,
    challenged: false,
    challengeReason: undefined as string | undefined,
    profileMeta: null as RawProfileMeta | null,
  };

  // FA1 finding 1: a challenge that surfaced MID-SCROLL — the loop stopped and captured nothing usable.
  // Record an ERROR run (stopReason `'challenge'`) so the RUN LOG reflects the interrupted sweep
  // HONESTLY, not as a clean 'complete'/'stable_end', and return blocked (no partial persistence).
  if (gatedResult.challenged) {
    await emitRun(deps, req.caseId, {
      profileId: req.channelId,
      username: req.targetUsername,
      operation,
      observed: 0,
      added: 0,
      requestedPasses: passes,
      completedPasses: gatedResult.completedPasses,
      reachedEnd: false,
      stopReason: 'challenge',
      status: 'error',
      startedAt,
      endedAt: deps.now(),
    });
    return {
      blocked: true,
      reason: gatedResult.challengeReason ?? 'X presented a verification challenge mid-capture.',
      added: 0,
      skipped: 0,
      posts: [],
    };
  }

  const items: XHarvestedItem[] = gatedResult.results.map((r) => r.item);
  const posts: XPostArtifact[] = gatedResult.results.map((r) => toPostArtifact(r.item, r.mediaRefs));

  // Audit HIGH #3 (FA3): comment-thread scraping. When THIS campaign's collect gate has COMMENTS on,
  // navigate the same headless, Tor-gated, still-signed-in capture window to each captured ROOT post's
  // thread (up to `commentThreadsPerSource`), scroll `commentScrollPasses` passes, and record the
  // THIRD-PARTY replies as `kind:'comment'` linked to their root post via `parentPostId` — Enterprise
  // `scrapeCommentsForPosts` (`main.cjs:1603-1632`), previously a dead toggle here (the normalizer +
  // gate existed but were never called). The captured root posts (FA1) are the ONLY input; each thread
  // URL is host-anchored + validated by `assertValidPostUrl` BEFORE any navigation. Persisted ALONGSIDE
  // the timeline posts in the same `savePosts`/`saveItems` upsert below (each dedups by id).
  if (collect.comments && posts.length) {
    const commentPairs = await captureThreadComments(win, deps, req, ctx, collect, delayMs, settings, imagesEnabled, posts);
    for (const { item, mediaRefs } of commentPairs) {
      items.push(item);
      posts.push(toPostArtifact(item, mediaRefs));
    }
  }

  const [postsResult] = await Promise.all([
    deps.savePosts(req.caseId, posts),
    deps.saveItems(req.caseId, items),
  ]);

  // FB2 (audit HIGH #7): snapshot the profile HEADER metadata read up front, emitting a
  // `profile_change` on a bio/avatar/location/website/DISPLAY-NAME diff vs the last snapshot (the
  // first snapshot is a baseline — no event). Run AFTER `savePosts` so a snapshot-store hiccup can
  // never lose the just-captured posts. A profile with NO posts still snapshots (the header is the
  // evidence here, not the timeline). An all-empty read (a page that exposed no header) records
  // NOTHING — a baseline is only stored once we have actually observed some metadata.
  const profileMeta = gatedResult.profileMeta;
  if (profileMeta && (profileMeta.displayName || profileMeta.bio || profileMeta.avatar || profileMeta.location || profileMeta.website)) {
    const sourceUsername = String(req.targetUsername || req.channelLabel || '') || undefined;
    // BEST-EFFORT (review): profile-change tracking is derived intel, like the run-log below — a
    // snapshot-store hiccup must NOT reject an otherwise-successful capture or suppress the run-log
    // write. Swallow + warn, mirroring emitRun's telemetry-never-breaks-capture posture.
    try {
      await deps.snapshotProfile(
        req.caseId,
        {
          profileId: req.channelId,
          ...(sourceUsername ? { sourceUsername } : {}),
          displayName: profileMeta.displayName,
          bio: profileMeta.bio,
          avatar: profileMeta.avatar,
          location: profileMeta.location,
          website: profileMeta.website,
        },
        { now: startedAt },
      );
    } catch (err) {
      console.warn('[XListening] snapshotProfile (best-effort):', err);
    }
  }

  // Record the completed run (Task A3). `observed` = unique posts this capture accumulated across all
  // scroll passes; `added` = newly persisted; `duplicates` (= observed - added) is derived in
  // `buildRunRecord`. FA1: requested/completed passes + reachedEnd are the REAL loop telemetry (no
  // longer hardcoded 1/1/true), so the Collection Health / RUN LOG reflects the actual capture depth.
  await emitRun(deps, req.caseId, {
    profileId: req.channelId,
    username: req.targetUsername,
    operation,
    observed: posts.length,
    added: postsResult.added,
    requestedPasses: passes,
    completedPasses: gatedResult.completedPasses,
    reachedEnd: gatedResult.reachedEnd,
    stopReason: gatedResult.reachedEnd ? 'stable_end' : 'pass_limit',
    status: 'complete',
    startedAt,
    endedAt: deps.now(),
  });

  return { blocked: false, added: postsResult.added, skipped: postsResult.skipped, posts };
}

/**
 * FA3 (audit HIGH #3) — scrape the third-party comment threads under a source's captured root posts.
 *
 * A faithful rebuild of Enterprise `scrapeCommentsForPosts` (`main.cjs:1603-1632`) onto OUR hardened,
 * injectable seams. For up to `commentThreadsPerSource` of the just-captured ROOT posts (`kind:'post'`,
 * FA1's timeline output — the ONLY input), it:
 *
 *   1. VALIDATES the post's live URL with `assertValidPostUrl` — the same `openPostThread` guards the
 *      "VERIFY LIVE"/"Open Real Thread" paths use (host ∈ x/twitter apex, `/status/<digits>`, username
 *      `^[A-Za-z0-9_]{1,15}$`, forced https). An off-host / malformed URL is SKIPPED (never navigated
 *      to) — validation happens BEFORE `deps.navigate` is ever called;
 *   2. navigates the SAME hidden, Tor-gated, signed-in capture window to that canonical thread URL,
 *      settles for the SPA render (`COMMENT_THREAD_SETTLE_MS`), then re-asserts signed-in — a blocked
 *      page STOPS the comment phase (fail closed; a flagged page is never scraped further);
 *   3. scrolls `commentScrollPasses` passes accumulating the visible items, then admits the THIRD-PARTY
 *      replies via `selectThreadComments` (root post + the target's own replies excluded), normalizing
 *      each with `normalizeComment(raw, ctx, rootStatusId)` so it carries `kind:'comment'` + the root's
 *      bare status id as its parent.
 *
 * Media for a comment is resolved (host-anchored → local ref) only when the source's image policy is on,
 * exactly as the timeline path. Returns the `{item, mediaRefs}` pairs; the caller folds them into the
 * same evidence-hashed persistence as the timeline posts. `X_POST_SCRIPT` remains the ONLY payload run
 * against the page (the scroll uses the static `X_TIMELINE_SCROLL_SCRIPT` via `deps.scroll`).
 */
async function captureThreadComments(
  win: Electron.BrowserWindow,
  deps: XCaptureDeps,
  req: XTimelineCaptureRequest,
  ctx: NormalizeContext,
  collect: XCollectSettings,
  delayMs: number,
  settings: XCollectionSettings,
  imagesEnabled: boolean,
  timelinePosts: readonly XPostArtifact[],
): Promise<Array<{ item: XHarvestedItem; mediaRefs: string[] }>> {
  const maxThreads = Math.max(
    MIN_COMMENT_THREADS,
    Math.min(MAX_COMMENT_THREADS, Math.floor(Number(settings.commentThreadsPerSource)) || MIN_COMMENT_THREADS),
  );
  const passes = Math.max(
    MIN_COMMENT_SCROLL_PASSES,
    Math.min(MAX_COMMENT_SCROLL_PASSES, Math.floor(Number(settings.commentScrollPasses)) || MIN_COMMENT_SCROLL_PASSES),
  );
  // ONLY the target's own top-level posts have a comment thread worth reading (Enterprise filters
  // `profileRecords` to `kind === 'post'` before calling this, `main.cjs:1713`).
  const rootPosts = timelinePosts.filter((p) => p.kind === 'post').slice(0, maxThreads);

  const out: Array<{ item: XHarvestedItem; mediaRefs: string[] }> = [];
  for (const rootPost of rootPosts) {
    // VALIDATE BEFORE NAVIGATION: a malformed / off-host post URL is never loaded. `assertValidPostUrl`
    // canonicalizes to `https://x.com/<user>/status/<id>` (or throws) — so `deps.navigate` only ever
    // receives a host-anchored, username-validated thread URL. A throw skips just THIS thread.
    let target: URL;
    try {
      target = assertValidPostUrl(rootPost);
    } catch (err) {
      console.warn('[XListening] skipping comment thread — invalid post URL:', err);
      continue;
    }

    await deps.navigate(win, target.toString());
    await deps.delay(COMMENT_THREAD_SETTLE_MS);
    const state = await deps.assertSignedIn(win);
    if (state.blocked) break; // fail closed — stop the comment phase on a challenge / session drop

    // Accumulate the thread's visible items by bare status id (Enterprise keys the comment map on
    // `String(item.id)`, `main.cjs:1618`). `passes + 1` reads / `passes` scrolls (matches Enterprise's
    // `for (index = 0; index <= passes; index++)` comment loop, `main.cjs:1616`).
    const byKey = new Map<string, RawPost>();
    for (let i = 0; i <= passes; i += 1) {
      const rawCollected = await deps.runCapture(win, X_POST_SCRIPT);
      const raws: RawPost[] = Array.isArray(rawCollected) ? (rawCollected as RawPost[]) : [];
      for (const r of raws) {
        const id = String(r?.id ?? '');
        if (!id) continue;
        byKey.set(id, r);
      }
      if (i >= passes) break; // final read — never scroll past the last
      await deps.scroll(win);
      await deps.delay(delayMs);
    }

    const rootStatusId = String(rootPost.messageId || rootPost.id || '');
    const commentRaws = selectThreadComments([...byKey.values()], req.targetUsername, rootStatusId, collect);
    for (const raw of commentRaws) {
      const item = normalizeComment(raw, ctx, rootStatusId);
      const mediaRefs = imagesEnabled
        ? await resolvePostMediaRefs(win, raw, req.caseId, deps.resolveMedia)
        : [];
      out.push({ item, mediaRefs });
    }
  }
  return out;
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
  /** Await `ms` after the window loads and BEFORE the verify read, so X's SPA has time to hydrate
   *  (Enterprise's `sleep(2600)` between `loadURL` and the read, `main.cjs:2626-2640`). A unit
   *  harness injects an instant no-op; the production default is a real `setTimeout`-backed sleep.
   *  Wall-clock pacing only — never feeds an evidence/hash path. */
  delay: (ms: number) => Promise<void>;
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
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
    // SPA-render settle — Enterprise `verifyPostLive` sleeps 2600ms between `loadURL` and the read
    // (`main.cjs:2626-2640`) so X's client-side hydration finishes. Reading immediately after the
    // load can race the render and misclassify a not-yet-hydrated page as "available, unchanged".
    // Fail SOFT exactly like the rest of the module: a settle that rejects must not abort the
    // verification (the finally still destroys the window; the read proceeds best-effort).
    try {
      await deps.delay(VERIFY_POST_SETTLE_MS);
    } catch {
      /* ignore a settle error — proceed to read, same soft posture as the scroll/comment paths */
    }
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
// installs his page-side MutationObserver accumulator and scroll-drives it (X virtualizes the list),
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
  /** Scroll passes — clamped to [1, 240] (Enterprise `scrapeRelationshipRows`, `main.cjs:2356`).
   *  Defaults to `DEFAULT_NETWORK_PASSES`. */
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
  /** Per-handle network delta events computed AND PERSISTED this scan (M2, his
   *  `recordNetworkSnapshot` `networkEvents`): a `newly_observed` per newly-added handle and a
   *  CONSERVATIVE, gated `not_seen_latest` per PREVIOUS-SCAN handle absent from a comparable scan.
   *  The durable stream (`store.networkEvents`, surfaced via `listNetworkEvents`) is the UI's source
   *  of truth; this mirror is what was persisted. Absent on a blocked scan (nothing was observed). */
  deltaEvents?: XNetworkDeltaEvent[];
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
  /** Await `ms`. Wall-clock pacing ONLY — the post-navigation settle and the per-pass delay that
   *  let X render and lazy-load. This module's one capture path that lacked it returned an empty
   *  follower list as a SUCCESSFUL scan. A unit harness injects an instant/virtual clock; the
   *  production default is a real `setTimeout`. Never feeds an evidence/hash path. */
  delay: (ms: number) => Promise<void>;
  /** Install the page-side accumulator (`X_NETWORK_COLLECTOR_INSTALL_SCRIPT`) — static payload. */
  installCollector: (win: Electron.BrowserWindow) => Promise<void>;
  /** Capture once more and read the accumulator back (`X_NETWORK_COLLECTOR_READ_SCRIPT`). */
  readCollector: (win: Electron.BrowserWindow) => Promise<XNetworkCollectorState>;
  /** Per-pass progress for the analyst. His scan emits `pass i/N — C unique` throughout; without
   *  it a long scrape and a dead button are indistinguishable from the outside. Optional so every
   *  existing caller keeps working. */
  onProgress?: (p: { message: string; current: number; total: number }) => void;
  /** Mid-scroll signed-in/challenge re-check. The network scroll loop runs up to `MAX_NETWORK_PASSES`
   *  (240); a rate-limit or challenge surfacing PARTWAY through must DISCARD the truncated list and
   *  flag it, never persist it as `complete` — the same fail-closed honesty the timeline + comment
   *  loops already apply. Production default = `probeSignedInState`; a unit harness injects its own. */
  assertSignedIn: (win: Electron.BrowserWindow) => Promise<{ blocked: boolean; reason?: string }>;
  /** Read the ALREADY-persisted accounts for one (target, kind) — used only to report an honest
   *  `added` delta against the accumulator, never to gate the scan. */
  readNetwork: (
    caseId: string,
    target: string,
    kind: 'followers' | 'following',
  ) => Promise<XNetworkAccount[]>;
  /** Persist the freshly captured artifact (store.ts `networks.save`, the Task 7 accumulator). */
  saveNetwork: (caseId: string, artifact: XNetworkArtifact) => Promise<number>;
  /** Read the PREVIOUS scan's minimal state for one (target, relationship) — the diff basis + gate
   *  inputs for `deriveNetworkDeltaEvents` (M2). Null if this is the first scan. */
  readScanState: (
    caseId: string,
    target: string,
    kind: 'followers' | 'following',
  ) => Promise<XNetworkScanState | null>;
  /** Overwrite the previous-scan record with THIS scan's observed set/count/passes (M2). */
  saveScanState: (caseId: string, state: XNetworkScanState) => Promise<void>;
  /** Append this scan's per-handle delta events to the durable stream (M2, his `networkEvents`). */
  appendNetworkEvents: (caseId: string, events: XNetworkDeltaEvent[]) => Promise<void>;
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
/** Hard ceiling on the network scroll budget — Enterprise `scrapeRelationshipRows`'s
 *  `Math.min(240, requestedPasses)` (`main.cjs:2356`). Lets the FA4 archive relationship stepping
 *  actually deepen toward `maxNetworkDepth` (up to 240) instead of being re-capped at 60. */
const MAX_NETWORK_PASSES = 240;
/** Fallback consecutive-no-growth early-stop when settings can't supply one — Enterprise's
 *  `networkStagnationLimit` default (`main.cjs:2358`). The live limit is read per-campaign and
 *  re-clamped to [`MIN`,`MAX`] MAIN-side (defence-in-depth over the already-clamped setting). */
const DEFAULT_NETWORK_STAGNATION_LIMIT = 7;
const MIN_NETWORK_STAGNATION_LIMIT = 4;
const MAX_NETWORK_STAGNATION_LIMIT = 20;

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
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    installCollector: async (win) => {
      await defaultRunCapture(win, X_NETWORK_COLLECTOR_INSTALL_SCRIPT);
    },
    readCollector: async (win) => {
      const raw = await defaultRunCapture(win, X_NETWORK_COLLECTOR_READ_SCRIPT);
      const state = (raw ?? {}) as Partial<XNetworkCollectorState>;
      return {
        rows: Array.isArray(state.rows) ? state.rows : [],
        count: Number(state.count ?? 0) || 0,
        scrollTop: Number(state.scrollTop ?? 0) || 0,
        scrollHeight: Number(state.scrollHeight ?? 0) || 0,
        innerHeight: Number(state.innerHeight ?? 0) || 0,
      };
    },
    assertSignedIn: (win) => probeSignedInState(win),
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
    readScanState: async (caseId, target, kind) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.networkScanState.read(caseId, target, kind);
    },
    saveScanState: async (caseId, state) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      await store.networkScanState.write(caseId, state);
    },
    appendNetworkEvents: async (caseId, events) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      await store.networkEvents.append(caseId, events);
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
 * (the same key `normalizeNetwork`/`store.networks.save` use), and stops early once `stagnationLimit`
 * consecutive passes add nothing new (a stable end). Never runs the scroll after the final pass
 * (gentle on X). Returns the accumulated raw cells + the loop telemetry.
 */
async function scrapeNetworkRows(
  win: Electron.BrowserWindow,
  passes: number,
  stagnationLimit: number,
  delayMs: number,
  target: string,
  deps: XNetworkCaptureDeps,
): Promise<{ rows: RawUserCell[]; completedPasses: number; reachedEnd: boolean; challenged?: boolean; challengeReason?: string }> {
  // HIS loop (`scrapeRelationshipRows`, main.cjs:2347+), transcribed: install the page-side
  // accumulator once, then per pass read it back, report progress, test for a stable end, scroll,
  // WAIT, and re-assert signed-in.
  //
  // What this replaces read the viewport fresh each pass and paced nothing at all — no settle after
  // navigation, no delay between passes. That does not make a scrape slow, it makes it EMPTY AND
  // SUCCESSFUL: every read lands on an unhydrated page, the no-growth counter reaches
  // `stagnationLimit` in milliseconds, and the caller returns `{ blocked: false, observed: 0 }`.
  // Nothing failed, so nothing was reported. That is the dead Extract Followers button.
  await deps.installCollector(win);

  let completedPasses = 0;
  let stagnant = 0;
  let previousSize = 0;
  let reachedEnd = false;
  let rows: RawUserCell[] = [];

  // `passes + 1` reads and `passes` scrolls — his iteration count exactly (`index <= passes`).
  for (let i = 0; i <= passes; i += 1) {
    completedPasses = i + 1;
    const state = await deps.readCollector(win);
    rows = state.rows;

    // His stable-end test: the scroller is at the bottom (within his 8px tolerance).
    reachedEnd = state.scrollTop + state.innerHeight >= state.scrollHeight - 8;

    // LEADING-EMPTY GUARD — a deliberate hardening over his source, and the same one the timeline
    // loop already carries. An unhydrated page reports scrollHeight ≈ innerHeight, so `reachedEnd`
    // is TRUE before anything has rendered; counting those reads toward stagnation lets a page that
    // simply has not painted yet end the scan as a "stable end". Only count no-growth passes once
    // at least one account has actually been seen.
    if (state.count !== previousSize) stagnant = 0;
    else if (state.count > 0) stagnant += 1;
    previousSize = state.count;

    deps.onProgress?.({
      message: `Extracting ${target} — pass ${i + 1}/${passes + 1} — ${state.count} unique`,
      current: i + 1,
      total: passes + 1,
    });

    if (i >= passes) break;
    if (stagnant >= stagnationLimit && reachedEnd) break;

    await deps.scroll(win);
    // The pacing his loop has and this port did not: give the SPA time to mount the next batch.
    await deps.delay(delayMs);
    // FA-A review (Important): re-assert signed-in/challenge MID-SCROLL — mirrors the timeline +
    // comment loops. Over up to MAX_NETWORK_PASSES (240), a rate-limit/challenge interstitial can
    // surface partway through; without this the loop would keep scrolling the flagged page and the
    // caller would persist a TRUNCATED follower list logged as 'complete'. On a block we DISCARD the
    // partial (rows:[]) and flag it so the caller records an error run, never a false stable end.
    const mid = await deps.assertSignedIn(win);
    if (mid.blocked) {
      return { rows: [], completedPasses, reachedEnd: false, challenged: true, challengeReason: mid.reason };
    }
  }
  return { rows, completedPasses, reachedEnd };
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
  // capture; the value is re-clamped to [1,240] here (Enterprise's ceiling) regardless of source
  // (defence-in-depth over the already-clamped stored value). The 240 ceiling also lets the FA4
  // archive relationship stepping actually reach `maxNetworkDepth` instead of being re-capped at 60.
  const settings = await deps.loadCollectionSettings(req.caseId);
  const basePasses = kind === 'following' ? settings.followingBasePasses : settings.followerBasePasses;
  const passes = Math.max(1, Math.min(MAX_NETWORK_PASSES, Math.floor(Number(req.passes ?? basePasses)) || basePasses));
  // Early-stop limit from the campaign's `networkStagnationLimit` (Enterprise `main.cjs:2358`),
  // re-clamped to [4,20] MAIN-side (defence-in-depth over the already-clamped setting).
  const stagnationLimit = Math.max(
    MIN_NETWORK_STAGNATION_LIMIT,
    Math.min(
      MAX_NETWORK_STAGNATION_LIMIT,
      Math.floor(Number(settings.networkStagnationLimit)) || DEFAULT_NETWORK_STAGNATION_LIMIT,
    ),
  );
  // Per-pass pacing, from the same campaign setting the timeline loop uses, clamped to his band
  // ([500, 5000] in `scrapeRelationshipRows`). A scroll with no wait after it reads the same
  // viewport again.
  const delayMs = Math.max(
    MIN_NETWORK_PASS_DELAY_MS,
    Math.min(MAX_NETWORK_PASS_DELAY_MS, Math.floor(Number(settings.delayPerPassMs)) || DEFAULT_NETWORK_PASS_DELAY_MS),
  );
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
    // Post-navigation settle BEFORE the signed-in gate and the first read — his
    // `loadURL` → `sleep(3500)` → `assertSignedInPage` order. Fail SOFT, matching the verify and
    // comment settles: a settle that rejects must not abort the scan.
    try {
      await deps.delay(NETWORK_SETTLE_MS);
    } catch {
      /* ignore a settle error — proceed to read, same soft posture as the other capture paths */
    }
    const gated = await deps.guard(win, () =>
      scrapeNetworkRows(win, passes, stagnationLimit, delayMs, fullTarget, deps),
    );
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

    const { rows, completedPasses, reachedEnd, challenged, challengeReason } = gated.result ?? {
      rows: [],
      completedPasses: 0,
      reachedEnd: false,
    };
    if (challenged) {
      // Mid-scroll challenge (FA-A review): DISCARD the truncated list and record an honest ERROR
      // run — never persist a partial follower list logged as complete.
      await emitNetworkRun(deps, req.caseId, {
        profileId,
        username,
        operation: kind,
        observed: 0,
        added: 0,
        requestedPasses: passes,
        completedPasses,
        reachedEnd: false,
        stopReason: challengeReason ?? 'challenge',
        status: 'error',
        startedAt,
        endedAt: deps.now(),
      });
      return { blocked: true, reason: challengeReason, kind, target: fullTarget, observed: 0, added: 0, completedPasses, reachedEnd: false };
    }
    const capturedAt = deps.now();
    const artifact = normalizeNetwork(rows, username, kind, capturedAt, { caseId: req.caseId });

    // Honest `added` delta: which of this scan's accounts weren't already in the ACCUMULATOR.
    // `addedHandles` (not just the count) seed the `newly_observed` events — his `addedUsernames`.
    const prior = await deps.readNetwork(req.caseId, fullTarget, kind);
    const priorHandles = new Set(prior.map((a) => a.handle.toLowerCase()));
    const addedHandles = artifact.accounts
      .filter((a) => !priorHandles.has(a.handle.toLowerCase()))
      .map((a) => a.handle);
    const added = addedHandles.length;

    // M2: per-handle delta events — his `recordNetworkSnapshot` (main.cjs:540-581). `newly_observed`
    // is the accumulator diff (`addedHandles`); `not_seen_latest` is a CONSERVATIVE observation
    // gated against the PREVIOUS SCAN (never the all-time accumulator) on BOTH passesCompleted and
    // observedCount, so a shallow re-scan cannot falsely flag every missing account as "gone" and a
    // dropped handle is flagged ONCE, not on every later scan. The previous-scan read is fail-soft
    // (a missing/unreadable record ⇒ null ⇒ newly_observed only) — the same electron-less-harness
    // resilience `getCollectionSettings` uses; it never blocks a capture.
    let previousScan: XNetworkScanState | null = null;
    try {
      previousScan = await deps.readScanState(req.caseId, fullTarget, kind);
    } catch (err) {
      console.warn('[XListening] readScanState (network):', err);
    }
    const deltaEvents = deriveNetworkDeltaEvents({
      previous: previousScan,
      observed: artifact.accounts,
      passesCompleted: completedPasses,
      added: addedHandles,
      target: fullTarget,
      relationship: kind,
      observedAt: capturedAt,
    });

    await deps.saveNetwork(req.caseId, artifact);

    // Persist the delta stream + advance the previous-scan record (this scan becomes next scan's
    // `previous`). Best-effort, exactly like `emitNetworkRun` — a persistence miss is logged, never
    // fatal to the capture. The observed set is deduped + capped identically to the gate's basis so
    // the next comparison compares like with like.
    const observedUsernames = dedupeHandlesCI(artifact.accounts.map((a) => a.handle), X_MAX_SCAN_OBSERVED);
    try {
      if (deltaEvents.length > 0) await deps.appendNetworkEvents(req.caseId, deltaEvents);
      await deps.saveScanState(req.caseId, {
        target: fullTarget.toLowerCase(),
        relationship: kind,
        observedUsernames,
        observedCount: observedUsernames.length,
        passesCompleted: completedPasses,
        capturedAt,
      });
    } catch (err) {
      console.warn('[XListening] persist network deltas (M2):', err);
    }

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
      deltaEvents,
    };
  } finally {
    const w = win as unknown as { isDestroyed?: () => boolean; destroy?: () => void };
    if (typeof w.destroy === 'function' && !(w.isDestroyed && w.isDestroyed())) {
      w.destroy();
    }
  }
}

// ---- self-contained Tor-gated single-profile timeline capture (automatic sweep primitive, G1) ---
//
// The manual `captureTimeline` above captures whatever page an analyst already navigated the shared
// visible window to. An AUTOMATIC sweep (G1) has no analyst driving the window, so it needs a
// self-contained primitive that — exactly like `captureNetwork`/`verifyPost`/`openInX` — resolves the
// Tor posture ITSELF (FAIL CLOSED, no clearnet fallback unless the acked clearnet toggle is on), opens
// its OWN hidden window navigated to the target profile, runs `captureTimeline` against it, and
// destroys the window in a `finally`. This is where the sweep's Tor gate lives: a scheduled sweep can
// never open a proxy-less clearnet window while clearnet mode is off, and it opens NO window at all
// when Tor is down. It does NOT touch the operator's shared visible capture window.
//
// The gate default (`loadClearnetEnabled`) is STRICTER than the manual paths: it requires BOTH
// `AppSettings.xListening.clearnet` AND `clearnetAck` before it will report clearnet — so an
// unattended background sweep only ever leaves Tor when the operator has explicitly acknowledged the
// real-IP exposure. Quarantine discipline preserved: no static electron/Tor import — the production
// defaults lazy-import `./session` (the ONE sanctioned Tor seam) + the hardened window factory.

/** The context for one automatic-sweep single-profile capture. `collect`/`imagesEnabled` are resolved
 *  by the caller (the scheduler, from the per-campaign COLLECTION SETTINGS + per-profile image policy)
 *  and threaded straight into `captureTimeline`. */
export interface XProfileTimelineRequest {
  caseId: string;
  channelId: string;
  channelLabel: string;
  targetUsername: string;
  /** Surrounding-thread collect gate (F2 RECORD TYPES); defaults all-off inside `captureTimeline`. */
  collect?: XCollectSettings;
  /** This source's EFFECTIVE image policy (F1); when false `captureTimeline` fetches no media. */
  imagesEnabled?: boolean;
  /** FA4 scroll-depth OVERRIDE (FA1's `req.passes`): how many scroll-and-accumulate passes to run.
   *  The incremental-archive rotation supplies the source's stepped post-pass depth here so each
   *  cycle digs progressively deeper into history. Absent ⇒ the campaign's `profileScrollPasses`
   *  drives the loop (a plain sweep). */
  passes?: number;
}

/** Injectable seams so the sweep primitive is testable without electron/network. Production defaults
 *  are lazy dynamic imports of the sanctioned Tor seam (`./session`) + the hardened window factory;
 *  `capture` defaults to `captureTimeline`. */
export interface XProfileTimelineDeps {
  /** Read the acked clearnet opt-out MAIN-side, fail-closed. Default requires clearnet AND clearnetAck
   *  (stricter than the manual paths) — an unattended sweep leaves Tor only on an explicit ack. */
  loadClearnetEnabled: () => Promise<boolean>;
  /** Resolve the Tor posture from the acked clearnet flag (`session.ts` `resolveXTorGate`). */
  resolveGate: (clearnetEnabled: boolean) => XTorGate | Promise<XTorGate>;
  /** Open a hardened, hidden capture window at `url` over the resolved posture (proxy iff Tor mode). */
  openWindow: (url: string, proxy?: { socks: string }) => Promise<Electron.BrowserWindow>;
  /** Run the timeline capture against the opened window; defaults to `captureTimeline`. */
  capture: (
    win: Electron.BrowserWindow,
    req: XTimelineCaptureRequest,
    overrides?: Partial<XCaptureDeps>,
  ) => Promise<XTimelineCaptureResult>;
}

function defaultProfileTimelineDeps(): XProfileTimelineDeps {
  return {
    loadClearnetEnabled: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const settings = await settingsStore.read();
        // Stricter than the manual paths: an unattended sweep only leaves Tor when clearnet is BOTH
        // enabled AND acknowledged (shared `requireAckedClearnet`).
        return requireAckedClearnet(settings);
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
      win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      return win;
    },
    capture: (win, req, overrides) => captureTimeline(win, req, overrides),
  };
}

/**
 * Capture ONE profile's timeline in a self-opened, Tor-gated hidden window (G1 automatic-sweep
 * primitive). Validates + builds the `https://x.com/<user>` URL FIRST (a malformed handle throws,
 * opening NO window and never touching the gate/network), resolves the Tor posture and refuses
 * (opening no window, capturing nothing) when it is blocked — FAIL CLOSED, no clearnet fallback unless
 * the acked clearnet toggle is on — then runs `captureTimeline` against the window with the caller's
 * collect gate + image policy, and ALWAYS destroys the window in a `finally`. Returns the same shape
 * as `captureTimeline` (with `blocked:true` when the gate refused).
 */
export async function captureProfileTimeline(
  req: XProfileTimelineRequest,
  overrides: Partial<XProfileTimelineDeps> = {},
): Promise<XTimelineCaptureResult> {
  // Validate BEFORE touching the gate or network — a malformed handle opens nothing. Reuse the
  // exact `openInX('profile')` username guard + canonical `https://x.com/<user>` construction.
  const url = buildXOpenUrl('profile', req.targetUsername);
  // Audit HIGH #4: when this campaign's collect gate has REPLIES on, load the `/with_replies` tab
  // (His `scrapeProfile` route, main.cjs:1647-1648) so the target's own replies actually surface.
  // The username inside `url` was validated by `buildXOpenUrl` (`^[A-Za-z0-9_]{1,15}$`); `/with_replies`
  // is a fixed literal appended to the path — host stays x.com, no injection.
  if (req.collect?.replies) {
    url.pathname = `${url.pathname}/with_replies`;
  }

  const deps: XProfileTimelineDeps = { ...defaultProfileTimelineDeps(), ...overrides };

  // FAIL CLOSED: resolve the Tor posture and refuse (opening no window) when it is blocked.
  const clearnetEnabled = await deps.loadClearnetEnabled();
  const gate = await deps.resolveGate(clearnetEnabled);
  if (gate.blocked) {
    return { blocked: true, reason: gate.reason, added: 0, skipped: 0, posts: [] };
  }

  const win = await deps.openWindow(url.toString(), gate.proxy);
  try {
    return await deps.capture(
      win,
      {
        caseId: req.caseId,
        jobId: req.caseId,
        channelId: req.channelId,
        channelLabel: req.channelLabel,
        targetUsername: req.targetUsername,
        collect: req.collect,
        // FA4: thread the archive rotation's stepped post-pass depth into FA1's scroll loop when
        // present; a plain sweep leaves this undefined so `profileScrollPasses` drives the passes.
        ...(req.passes !== undefined ? { passes: req.passes } : {}),
        operation: 'posts',
      },
      req.imagesEnabled !== undefined
        ? { imagesEnabledForSource: async () => req.imagesEnabled as boolean }
        : {},
    );
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
