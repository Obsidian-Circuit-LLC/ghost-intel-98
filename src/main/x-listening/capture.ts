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
  classifyXPageState,
  normalizePost,
  normalizeReply,
  normalizeRepost,
  selectTimelineCaptures,
  type RawPost,
  type NormalizeContext,
  type XHarvestedItem,
  type XCollectSettings,
  type XPageState,
} from './extract';
import { postEvidenceHash } from './evidence';
import type { XPostArtifact, XPostMetrics, XPostMetricsRaw } from './store';
import type { HarvestedItem } from '@shared/socmint/types';

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
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.posts.save(caseId, posts);
    },
    saveItems: async (caseId, items) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.saveItems(caseId, items);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Map one normalized `XHarvestedItem` (extract.ts's nested `{raw,value,approx}` metric
 * shape) → the richer, flat `XPostArtifact` (store.ts) that persists to the `x-posts.json`
 * sidecar. Folds BOTH the parsed `metrics` and the RAW platform strings `metricsRaw` into
 * `evidenceHash` via `postEvidenceHash` — the Task 2 honesty fix over Enterprise, which
 * omits metrics from its evidence hash entirely.
 */
export function toPostArtifact(item: XHarvestedItem): XPostArtifact {
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
  const ctx: NormalizeContext = {
    caseId: req.caseId,
    jobId: req.jobId,
    collectorVersion: X_COLLECTOR_VERSION,
    harvestedAt: deps.now(),
    channelId: req.channelId,
    channelLabel: req.channelLabel,
  };

  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, X_POST_SCRIPT);
    const raws: RawPost[] = Array.isArray(rawCollected) ? (rawCollected as RawPost[]) : [];
    const selections = selectTimelineCaptures(raws, req.targetUsername, collect);
    const items: XHarvestedItem[] = selections.map(({ raw, kind }) => {
      if (kind === 'reply') return normalizeReply(raw, ctx);
      if (kind === 'repost') return normalizeRepost(raw, ctx);
      return normalizePost(raw, ctx);
    });
    return items;
  });

  if (gated.blocked) {
    return { blocked: true, reason: gated.reason, added: 0, skipped: 0, posts: [] };
  }

  const items: XHarvestedItem[] = gated.result ?? [];
  const posts: XPostArtifact[] = items.map(toPostArtifact);

  const [postsResult] = await Promise.all([
    deps.savePosts(req.caseId, posts),
    deps.saveItems(req.caseId, items),
  ]);

  return { blocked: false, added: postsResult.added, skipped: postsResult.skipped, posts };
}
