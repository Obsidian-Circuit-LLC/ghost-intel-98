/**
 * X Listening Station — connect / status / challenge-refusal IPC (Plan A, Task X2).
 *
 * The main-side seam that opens an authenticated X session in the shared hardened
 * capture window (F1) and derives connectivity from the auth cookie WITHOUT ever
 * copying, echoing, or logging the token. Also the challenge-refusal gate: before
 * any capture runs, the visible page state is probed and — on an X verification /
 * rate-limit / arkose interstitial, or a signed-out page — capture STOPS and
 * reports `blocked`. It NEVER attempts to solve or bypass a challenge.
 *
 * CLEARNET-QUARANTINE NOTE: this module imports ONLY the shared capture harness
 * and electron's `session`. It pulls in NOTHING from `bgconn`/Tor/socks/`socmint`/
 * `telegram`; the X caller passes NO proxy (clearnet, the operator's own IP +
 * cookies). Ported and hardened from quarantine `electron/main.cjs`:
 *   - `getXSessionStatus` (auth-cookie → boolean) at `main.cjs:236-242`
 *   - `assertSignedInPage` (challenge refusal) at `main.cjs:426-443`
 * The quarantine THREW on a challenge; here the gate returns a structured
 * `{ blocked:true }` so the caller stops cleanly and runs no capture.
 */

import { session } from 'electron';
import { channels } from '@shared/ipc-contracts';
import {
  createCaptureWindow,
  runCapture,
  assertTrustedSender
} from '../capture/capture-window';
import { remoteMediaToDataUri, type MediaCapturePage } from '../capture/security';
import {
  X_POST_SCRIPT,
  USER_CELL_SCRIPT,
  normalizePost,
  normalizeReply,
  normalizeRepost,
  normalizeComment,
  normalizeNetwork,
  networkToCsv,
  selectTimelineCaptures,
  selectThreadComments,
  guardXPermalink,
  type RawPost,
  type RawUserCell,
  type NormalizeContext,
  type XHarvestedItem,
  type XItemKind,
  type XCollectSettings
} from './extract';
import { prodXStore } from './store';
import type { XNetworkAccount, XNetworkArtifact, XNote, XArchiveState } from './store';

/** Clearnet partition the authenticated X session lives on. Matches the X1 contract. */
export const X_LISTENING_PARTITION = 'persist:x-listening';
/** The signed-in landing surface the connect window loads. */
export const X_HOME_URL = 'https://x.com/home';
/** Hosts the capture window may navigate to (x.com / twitter.com + subdomains). */
export const X_ALLOW_HOSTS = ['x.com', 'twitter.com'];

/** The single live connect window, reused across `connect()` calls. */
let xWindow: Electron.BrowserWindow | null = null;

/** Test hook: drop the cached connect window so each case starts clean. */
export function __resetXWindowForTests(): void {
  xWindow = null;
}

/**
 * Open (or reopen) the hardened X login window on the clearnet partition. No proxy
 * is ever supplied — X is a clearnet-quarantine trust domain. If a live window
 * already exists it is surfaced rather than duplicated.
 */
export async function connectXSession(): Promise<{ opened: boolean }> {
  if (xWindow && !xWindow.isDestroyed()) {
    xWindow.show();
    xWindow.focus();
    return { opened: true };
  }
  const win = await createCaptureWindow({
    partition: X_LISTENING_PARTITION,
    url: X_HOME_URL,
    allowHosts: X_ALLOW_HOSTS
    // NO `proxy`: clearnet quarantine — the operator's own IP + cookies.
  });
  xWindow = win;
  win.show();
  win.focus();
  return { opened: true };
}

/** True iff `domain` is x.com / twitter.com or a subdomain of either. */
function isXAuthDomain(domain: string): boolean {
  return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(domain);
}

/**
 * Derive a `connected` boolean from the presence of an `auth_token` cookie scoped
 * to x.com / twitter.com. The token VALUE is read for the domain check only and is
 * never returned, echoed, or logged. Port of quarantine `main.cjs:236-242`.
 */
export async function xSessionStatus(): Promise<{ connected: boolean }> {
  const ses = session.fromPartition(X_LISTENING_PARTITION);
  const cookies = await ses.cookies.get({ name: 'auth_token' });
  const connected = cookies.some((c) => isXAuthDomain(c.domain || ''));
  return { connected };
}

/** Shape returned by the in-page state probe (visible-DOM only). */
export interface PageState {
  url: string;
  text: string;
  articles: number;
}

/**
 * STATIC page-state probe. No interpolation — the harness never builds a payload
 * from scraped input. Reads only the current URL, a bounded slice of visible body
 * text, and the count of rendered tweet articles. Port of quarantine
 * `main.cjs:427-432` (the `assertSignedInPage` probe).
 */
export const PAGE_STATE_SCRIPT = `(() => ({
  url: location.href,
  text: (document.body && document.body.innerText || '').slice(0, 5000),
  articles: document.querySelectorAll('article[data-testid="tweet"]').length
}))()`;

const LOGIN_URL_RE = /\/i\/flow\/login/i;
const LOGIN_TEXT_RE = /sign in to x/i;
const CHALLENGE_RE =
  /verify your identity|unusual activity|temporarily limited|rate limit exceeded|try again later|security check|arkose/i;

/**
 * Classify a captured page state (pure). `blocked` marks an X verification /
 * rate-limit / arkose interstitial the analyst must resolve manually — capture
 * must STOP, never solve. `signedIn` is false on the login/flow page (session
 * expired). Port of the two `assertSignedInPage` branches at `main.cjs:436-442`.
 */
export function classifyPageState(page: PageState): {
  signedIn: boolean;
  blocked: boolean;
  reason?: string;
} {
  const url = String(page?.url || '');
  const text = String(page?.text || '');
  if (CHALLENGE_RE.test(text)) {
    return {
      signedIn: true,
      blocked: true,
      reason:
        'X presented a verification challenge or temporary limit. Collection stopped without attempting to bypass it — resolve the prompt in the X session before continuing.'
    };
  }
  if (LOGIN_URL_RE.test(url) || LOGIN_TEXT_RE.test(text)) {
    return {
      signedIn: false,
      blocked: false,
      reason: 'The saved X session is no longer signed in. Reconnect it before continuing.'
    };
  }
  return { signedIn: true, blocked: false };
}

/** Probe the live capture window and classify its visible state. Visible-DOM only. */
export async function checkCaptureAllowed(win: Electron.BrowserWindow): Promise<{
  signedIn: boolean;
  blocked: boolean;
  reason?: string;
}> {
  const raw = (await runCapture(win, PAGE_STATE_SCRIPT)) as PageState;
  return classifyPageState({
    url: String(raw?.url || ''),
    text: String(raw?.text || ''),
    articles: Number(raw?.articles || 0)
  });
}

/**
 * Run `capture` ONLY when the live page is signed in and unchallenged. On a
 * challenge or a signed-out page the capture callback is never invoked and the
 * caller gets `{ blocked:true, reason }`. This is the single refusal gate every
 * X capture path (X3+) routes through.
 */
export async function guardedCapture<T>(
  win: Electron.BrowserWindow,
  capture: () => Promise<T>
): Promise<{ blocked: boolean; reason?: string; result?: T }> {
  const state = await checkCaptureAllowed(win);
  if (state.blocked) {
    return { blocked: true, reason: state.reason };
  }
  if (!state.signedIn) {
    return { blocked: true, reason: state.reason ?? 'The saved X session is no longer signed in.' };
  }
  const result = await capture();
  return { blocked: false, result };
}

// ---- X3: visible-post capture → persisted HarvestedItems ----------------

/** This collector's version, stamped into every item's provenance. */
export const X_COLLECTOR_VERSION = 'x-listening/1.0.0';

/**
 * The renderer-supplied context for a capture: which case/job and which profile
 * timeline is being observed. `harvestedAt` + `collectorVersion` are stamped
 * MAIN-side (the trusted clock + version), never accepted from the renderer.
 */
export interface CaptureRequest {
  caseId: string;
  jobId: string;
  /** The profile/timeline being observed (the HarvestedItem "channel"). */
  channelId: string;
  channelLabel: string;
  /** Which surrounding-thread kinds to capture (X4). Sourced MAIN-side from
   *  `AppSettings.xListening.collect` — never trusted from the renderer. Defaults
   *  to all-off, so a target's own top-level posts are captured but nothing else. */
  collect?: XCollectSettings;
}

/** All-off collect gate — a target's own posts only. The trusted default. */
export const DEFAULT_COLLECT: XCollectSettings = {
  replies: false,
  reposts: false,
  comments: false
};

/** The kind→normalizer map for the timeline path (comments are sourced separately). */
function normalizeByKind(
  raw: RawPost,
  ctx: NormalizeContext,
  kind: Exclude<XItemKind, 'comment'>
): XHarvestedItem {
  if (kind === 'reply') return normalizeReply(raw, ctx);
  if (kind === 'repost') return normalizeRepost(raw, ctx);
  return normalizePost(raw, ctx);
}

export interface TimelineCaptureResult {
  blocked: boolean;
  reason?: string;
  added: number;
  skipped: number;
  items: XHarvestedItem[];
}

/** Injectable seams so the orchestration is testable without electron/network. */
export interface TimelineCaptureDeps {
  /** Run the static timeline payload in the capture page → RawPost[]. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** Resolve a remote media URL to a local `data:` thumbnail, or null. */
  resolveMedia: (win: MediaCapturePage, url: string) => Promise<string | null>;
  /** Persist normalized items to the encrypted case store. */
  saveItems: (
    caseId: string,
    items: XHarvestedItem[]
  ) => Promise<{ added: number; skipped: number }>;
  /** The challenge-refusal gate (X2): runs `capture` only on a signed-in, unchallenged page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Injected clock — the ISO capture time stamped onto every item. */
  now: () => string;
}

function defaultCaptureDeps(): TimelineCaptureDeps {
  return {
    runCapture,
    resolveMedia: remoteMediaToDataUri,
    saveItems: async (caseId, items) => (await prodXStore()).saveItems(caseId, items),
    guard: guardedCapture,
    now: () => new Date().toISOString()
  };
}

/**
 * Resolve every remote media URL on a raw post to a local `data:` thumbnail,
 * dropping any that fail. A remote URL is NEVER carried forward — combined with
 * `normalizePost`'s `data:`-only filter this guarantees no stored field can ever
 * beacon (the review's media-inlining finding).
 */
async function resolveRawMedia(
  win: Electron.BrowserWindow,
  raw: RawPost,
  resolveMedia: TimelineCaptureDeps['resolveMedia']
): Promise<RawPost> {
  const resolved: string[] = [];
  for (const url of raw.media || []) {
    const src = String(url ?? '');
    if (src.startsWith('data:')) {
      resolved.push(src);
      continue;
    }
    const dataUri = await resolveMedia(win, src);
    if (dataUri) resolved.push(dataUri);
  }
  return { ...raw, media: resolved };
}

/**
 * Capture the visible X timeline in the live connect window and persist it.
 *
 * Routes through the X2 challenge-refusal gate FIRST — on a verification /
 * rate-limit page nothing is captured and `{blocked:true}` is returned. Otherwise
 * the STATIC `X_POST_SCRIPT` reads the visible tweet articles, each post's media
 * is resolved to local `data:` thumbnails, `normalizePost` stamps the honesty
 * markers, and the items land in the encrypted case store via `xStore.saveItems`.
 */
export async function captureVisibleTimeline(
  win: Electron.BrowserWindow,
  req: CaptureRequest,
  overrides: Partial<TimelineCaptureDeps> = {}
): Promise<TimelineCaptureResult> {
  const deps = { ...defaultCaptureDeps(), ...overrides };
  const ctx: NormalizeContext = {
    caseId: req.caseId,
    jobId: req.jobId,
    collectorVersion: X_COLLECTOR_VERSION,
    harvestedAt: deps.now(),
    channelId: req.channelId,
    channelLabel: req.channelLabel
  };

  const collect = req.collect ?? DEFAULT_COLLECT;
  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, X_POST_SCRIPT);
    const raws: RawPost[] = Array.isArray(rawCollected) ? (rawCollected as RawPost[]) : [];
    // Gate on the collect toggles FIRST (X4): a target's own posts are always
    // captured; replies/reposts only when their toggle is on; a stray non-target,
    // non-repost item is never the target's speech and is dropped.
    const selected = selectTimelineCaptures(raws, req.channelId, collect);
    const items: XHarvestedItem[] = [];
    for (const { raw, kind } of selected) {
      const withMedia = await resolveRawMedia(win, raw, deps.resolveMedia);
      items.push(normalizeByKind(withMedia, ctx, kind));
    }
    return items;
  });

  if (gated.blocked) {
    return { blocked: true, reason: gated.reason, added: 0, skipped: 0, items: [] };
  }

  const items = gated.result ?? [];
  const { added, skipped } = await deps.saveItems(req.caseId, items);
  return { blocked: false, added, skipped, items };
}

// ---- X4: third-party comments on a target's post ------------------------

/** A capture of the third-party replies under ONE of the target's root posts. */
export interface ThreadCaptureRequest {
  caseId: string;
  jobId: string;
  /** The observed target profile (used to exclude the target's OWN replies). */
  channelId: string;
  channelLabel: string;
  /** The target root post whose thread is being read. */
  rootPostId: string;
  /** The root post permalink to navigate to — scheme/host guarded before use. */
  rootPostUrl: string;
  collect?: XCollectSettings;
}

/** Injectable seams for the thread-comment path — adds navigation to the timeline deps. */
export interface ThreadCaptureDeps extends TimelineCaptureDeps {
  /** Navigate the live capture window to a (already scheme-guarded) thread URL. */
  navigate: (win: Electron.BrowserWindow, url: string) => Promise<void>;
}

function defaultThreadDeps(): ThreadCaptureDeps {
  return {
    ...defaultCaptureDeps(),
    navigate: async (win, url) => {
      await win.webContents.loadURL(url);
    }
  };
}

/**
 * Capture the THIRD-PARTY comments under one of the target's posts (X4). Gated on
 * `collect.comments`: when off, the window is NEVER navigated and nothing is
 * captured. The root URL is scheme/host guarded (x.com/twitter.com https only)
 * before any navigation — a scraped/off-domain URL is refused, never loaded. The
 * challenge-refusal gate (X2) still fronts the capture, and only third-party
 * replies survive `selectThreadComments` (the root post and the target's own
 * replies are excluded — those are the target's speech, captured on the timeline).
 * Port of quarantine `scrapeCommentsForPosts` (`main.cjs:472-500`).
 */
export async function captureThreadComments(
  win: Electron.BrowserWindow,
  req: ThreadCaptureRequest,
  overrides: Partial<ThreadCaptureDeps> = {}
): Promise<TimelineCaptureResult> {
  const collect = req.collect ?? DEFAULT_COLLECT;
  if (!collect.comments) {
    return { blocked: false, added: 0, skipped: 0, items: [] };
  }
  const safeUrl = guardXPermalink(String(req.rootPostUrl ?? ''));
  if (!safeUrl) {
    return {
      blocked: true,
      reason: 'The root post URL is not a valid x.com/twitter.com permalink — refused to navigate it.',
      added: 0,
      skipped: 0,
      items: []
    };
  }

  const deps = { ...defaultThreadDeps(), ...overrides };
  const ctx: NormalizeContext = {
    caseId: req.caseId,
    jobId: req.jobId,
    collectorVersion: X_COLLECTOR_VERSION,
    harvestedAt: deps.now(),
    channelId: req.channelId,
    channelLabel: req.channelLabel
  };

  // Navigate into the thread FIRST, THEN gate. The challenge-refusal probe must
  // run against the LOADED thread page — navigating into a thread is exactly when
  // X throws a rate-limit / verification interstitial. If the guard fronted the
  // navigation (probing the pre-nav page) capture would run on the challenge page
  // and report `blocked:false`, silently weakening the STOP-on-challenge honesty
  // invariant. `safeUrl` is already scheme/host guarded (x.com/twitter.com https).
  // Mirrors quarantine `main.cjs:481-482`: loadURL(rootPost.url) THEN
  // assertSignedInPage(win).
  await deps.navigate(win, safeUrl);
  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, X_POST_SCRIPT);
    const raws: RawPost[] = Array.isArray(rawCollected) ? (rawCollected as RawPost[]) : [];
    const comments = selectThreadComments(raws, req.channelId, req.rootPostId, collect);
    const items: XHarvestedItem[] = [];
    for (const raw of comments) {
      const withMedia = await resolveRawMedia(win, raw, deps.resolveMedia);
      items.push(normalizeComment(withMedia, ctx, req.rootPostId));
    }
    return items;
  });

  if (gated.blocked) {
    return { blocked: true, reason: gated.reason, added: 0, skipped: 0, items: [] };
  }

  const items = gated.result ?? [];
  const { added, skipped } = await deps.saveItems(req.caseId, items);
  return { blocked: false, added, skipped, items };
}

/**
 * Read the collect toggles from persisted settings, MAIN-side and trusted. Lazy
 * dynamic import so this module never pulls the settings/store graph at import
 * time (keeps the electron-minimal test mocks + the clearnet-quarantine import
 * graph clean). Falls back to the all-off default on any read error — capture
 * never silently WIDENS on a settings failure.
 */
async function loadCollectSettings(): Promise<XCollectSettings> {
  try {
    const { settingsStore } = await import('../storage/json-fs');
    const settings = await settingsStore.read();
    return settings.xListening?.collect ?? DEFAULT_COLLECT;
  } catch {
    return DEFAULT_COLLECT;
  }
}

// ---- X5: follower / following network extraction ------------------------

/** A follower/following extraction request for one target profile. */
export interface NetworkCaptureRequest {
  caseId: string;
  jobId: string;
  /** The profile whose followers/following to read (the @handle, with or without @). */
  target: string;
}

/** The outcome of one network capture — the ACTUAL visible accounts, never a total. */
export interface NetworkCaptureResult {
  blocked: boolean;
  reason?: string;
  target: string;
  kind: 'followers' | 'following';
  /** The visible accounts captured this pass (honest — `accounts.length` is the count). */
  accounts: XNetworkAccount[];
}

/** Injectable seams so the network orchestration is testable without electron/network. */
export interface NetworkCaptureDeps {
  /** Navigate the live capture window to a (already scheme/host-guarded) URL. */
  navigate: (win: Electron.BrowserWindow, url: string) => Promise<void>;
  /** Run the static UserCell payload in the capture page → RawUserCell[]. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** Resolve a remote avatar URL to a local `data:` thumbnail, or null. */
  resolveMedia: (win: MediaCapturePage, url: string) => Promise<string | null>;
  /** The X2 challenge-refusal gate: runs `capture` only on a signed-in, unchallenged page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Persist the captured network artifact to the encrypted `networks` artifact store. */
  saveNetwork: (caseId: string, artifact: XNetworkArtifact) => Promise<number>;
  /** Injected clock — the ISO capture time stamped onto the artifact. */
  now: () => string;
}

function defaultNetworkDeps(): NetworkCaptureDeps {
  return {
    navigate: async (win, url) => {
      await win.webContents.loadURL(url);
    },
    runCapture,
    resolveMedia: remoteMediaToDataUri,
    guard: guardedCapture,
    saveNetwork: async (caseId, artifact) => (await prodXStore()).networks.save(caseId, artifact),
    now: () => new Date().toISOString()
  };
}

/** A visible X handle: 1–15 of `[A-Za-z0-9_]`. Mirror of the extract-side guard. */
const NETWORK_TARGET_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Resolve a captured cell's remote avatar to a local `data:` thumbnail, dropping it
 * on failure. A remote URL is NEVER carried forward — combined with
 * `normalizeUserCell`'s `data:`-only filter this guarantees no stored avatar can beacon.
 */
async function resolveCellAvatar(
  win: Electron.BrowserWindow,
  raw: RawUserCell,
  resolveMedia: NetworkCaptureDeps['resolveMedia']
): Promise<RawUserCell> {
  const src = String(raw.avatar ?? '');
  if (src.startsWith('data:')) return raw;
  if (!src) return { ...raw, avatar: '' };
  const dataUri = await resolveMedia(win, src);
  return { ...raw, avatar: dataUri ?? '' };
}

/**
 * Capture the visible follower/following accounts for one target profile (X5).
 *
 * Navigates the `x.com/<target>/(followers|following)` surface FIRST, THEN routes
 * through the X2 challenge-refusal gate — a rate-limit / verification interstitial
 * (which X throws exactly on these high-signal pages) is seen by the probe and stops
 * the capture cleanly (`blocked:true`, nothing persisted). The URL is built from a
 * validated `[A-Za-z0-9_]{1,15}` handle and scheme/host guarded before any
 * navigation. The visible `UserCell` rows are normalized to the ACTUAL accounts —
 * never a scraped count-number — each avatar resolved to a local `data:` thumbnail,
 * and the artifact is upserted (keyed by target+kind) into the encrypted `networks`
 * store. Port of quarantine `scrapeRelationshipRows`/`readVisibleUserCells`
 * (`electron/main.cjs:982-1011`, `:1047-1082`), honesty-hardened.
 */
export async function captureNetwork(
  win: Electron.BrowserWindow,
  req: NetworkCaptureRequest,
  kind: 'followers' | 'following',
  overrides: Partial<NetworkCaptureDeps> = {}
): Promise<NetworkCaptureResult> {
  const username = String(req.target ?? '').replace(/^@+/, '');
  if (!NETWORK_TARGET_RE.test(username)) {
    return {
      blocked: true,
      reason: 'The target is not a valid X handle — refused to open a followers/following page for it.',
      target: `@${username}`,
      kind,
      accounts: []
    };
  }

  const safeUrl = guardXPermalink(`https://x.com/${username}/${kind}`);
  if (!safeUrl) {
    return {
      blocked: true,
      reason: 'The followers/following URL failed the x.com/twitter.com scheme-host guard.',
      target: `@${username}`,
      kind,
      accounts: []
    };
  }

  const deps = { ...defaultNetworkDeps(), ...overrides };

  // Navigate into the followers/following surface FIRST, THEN gate. Same ordering
  // invariant as the thread path: the challenge-refusal probe must run against the
  // LOADED page — these relationship pages are exactly where X throws a rate-limit /
  // verification interstitial. Gating before navigation would probe the pre-nav page
  // and silently weaken the STOP-on-challenge honesty invariant.
  await deps.navigate(win, safeUrl);
  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, USER_CELL_SCRIPT);
    const rows: RawUserCell[] = Array.isArray(rawCollected) ? (rawCollected as RawUserCell[]) : [];
    const resolved: RawUserCell[] = [];
    for (const row of rows) {
      resolved.push(await resolveCellAvatar(win, row, deps.resolveMedia));
    }
    return normalizeNetwork(resolved, username, kind, deps.now());
  });

  if (gated.blocked) {
    return { blocked: true, reason: gated.reason, target: `@${username}`, kind, accounts: [] };
  }

  const artifact = gated.result as XNetworkArtifact;
  await deps.saveNetwork(req.caseId, artifact);
  return { blocked: false, target: artifact.target, kind, accounts: artifact.accounts };
}

/** Capture the target's visible FOLLOWERS. See `captureNetwork`. */
export function captureFollowers(
  win: Electron.BrowserWindow,
  req: NetworkCaptureRequest,
  overrides: Partial<NetworkCaptureDeps> = {}
): Promise<NetworkCaptureResult> {
  return captureNetwork(win, req, 'followers', overrides);
}

/** Capture the accounts the target is FOLLOWING. See `captureNetwork`. */
export function captureFollowing(
  win: Electron.BrowserWindow,
  req: NetworkCaptureRequest,
  overrides: Partial<NetworkCaptureDeps> = {}
): Promise<NetworkCaptureResult> {
  return captureNetwork(win, req, 'following', overrides);
}

/**
 * Read a case's captured networks and serialize them to a formula-guarded CSV string.
 * The renderer hands the returned text to the app's existing file-save flow; every
 * cell is neutralized by `csvCell` (via `networkToCsv`) so a scraped bio can never
 * execute as a spreadsheet formula.
 */
export async function exportNetworkCsv(caseId: string): Promise<{ csv: string; count: number }> {
  const artifacts = await (await prodXStore()).networks.read(caseId);
  const count = artifacts.reduce((n, a) => n + (a.accounts?.length ?? 0), 0);
  return { csv: networkToCsv(artifacts), count };
}

// ---- X6: analyst notes --------------------------------------------------

/** The longest note the store will accept — ported from quarantine `main.cjs:1310`. */
export const NOTE_MAX_LENGTH = 20000;

/** A note-save/read request from the renderer. `savedAt` is stamped MAIN-side. */
export interface SaveNoteRequest {
  caseId: string;
  /** The finding the note is pinned to (one note per finding). */
  findingId: string;
  text: string;
}

/** Injectable seams so the notes orchestration is testable without electron/secure-fs. */
export interface NotesDeps {
  /** Upsert one note keyed by findingId → the fresh note list. */
  saveNote: (caseId: string, findingId: string, text: string, savedAt: string) => Promise<XNote[]>;
  /** Read the case's notes. */
  readNotes: (caseId: string) => Promise<XNote[]>;
  /** Injected clock — the ISO `savedAt` stamped onto the note (determinism). */
  now: () => string;
}

function defaultNotesDeps(): NotesDeps {
  return {
    saveNote: async (caseId, findingId, text, savedAt) =>
      (await prodXStore()).notes.save(caseId, findingId, text, savedAt),
    readNotes: async (caseId) => (await prodXStore()).notes.read(caseId),
    now: () => new Date().toISOString()
  };
}

/**
 * Save (upsert) an analyst note against a finding. The text is trimmed and validated
 * (non-empty, ≤ NOTE_MAX_LENGTH) — ported from the quarantine `notes:add`/`notes:update`
 * guards (`main.cjs:1308-1310`, `1321-1323`) — and `savedAt` is stamped MAIN-side from
 * the injected clock, never accepted from the renderer. Returns the fresh note list.
 */
export async function saveNote(
  req: SaveNoteRequest,
  overrides: Partial<NotesDeps> = {}
): Promise<{ notes: XNote[] }> {
  const findingId = String(req?.findingId ?? '').trim();
  if (!findingId) {
    throw new Error('A note must be attached to a finding.');
  }
  const text = String(req?.text ?? '').trim();
  if (!text) {
    throw new Error('Note text is required.');
  }
  if (text.length > NOTE_MAX_LENGTH) {
    throw new Error(`Note is too long. Maximum length is ${NOTE_MAX_LENGTH} characters.`);
  }
  const deps = { ...defaultNotesDeps(), ...overrides };
  const notes = await deps.saveNote(req.caseId, findingId, text, deps.now());
  return { notes };
}

/** Read a case's analyst notes (encrypted `notes` artifact store). */
export async function readNotes(
  caseId: string,
  overrides: Partial<NotesDeps> = {}
): Promise<{ notes: XNote[] }> {
  const deps = { ...defaultNotesDeps(), ...overrides };
  return { notes: await deps.readNotes(caseId) };
}

// ---- X7: low-rate archive cycles ---------------------------------------

/** A resumable archive state with no prior run — the pre-first-cycle baseline. */
export const EMPTY_ARCHIVE_STATE: XArchiveState = {
  cursor: null,
  cycles: 0,
  lastRunAt: null
};

/** One archive cycle observes the same profile timeline a manual capture does. */
export interface ArchiveCycleRequest {
  caseId: string;
  jobId: string;
  channelId: string;
  channelLabel: string;
  /** Which surrounding-thread kinds to include; sourced MAIN-side, defaults all-off. */
  collect?: XCollectSettings;
}

/** The outcome of one archive cycle. `ran` is true only for a completed capture. */
export interface ArchiveCycleResult {
  /** True iff a capture actually executed AND completed (toggle on, not blocked). */
  ran: boolean;
  /** True iff the challenge-refusal gate stopped the cycle. */
  blocked: boolean;
  reason?: string;
  added: number;
  skipped: number;
  items: XHarvestedItem[];
  /** The archive state AFTER this cycle — advanced on a completed run, else unchanged. */
  state: XArchiveState;
}

/** Injectable seams so a cycle is testable without electron/network/secure-fs. */
export interface ArchiveCycleDeps {
  /** Read `AppSettings.xListening.archiveCycles` MAIN-side (trusted). */
  isEnabled: () => Promise<boolean>;
  /** Run one visible-timeline capture (persists items itself); defaults to `captureVisibleTimeline`. */
  capture: (win: Electron.BrowserWindow, req: CaptureRequest) => Promise<TimelineCaptureResult>;
  /** Read the case's resumable archive state (null before the first cycle). */
  readState: (caseId: string) => Promise<XArchiveState | null>;
  /** Persist the advanced archive state. */
  writeState: (caseId: string, state: XArchiveState) => Promise<void>;
  /** Injected clock — the ISO `lastRunAt` stamped when a cycle completes (determinism). */
  now: () => string;
}

/**
 * Read the archive-cycles toggle MAIN-side. Lazy dynamic import (same pattern as
 * `loadCollectSettings`) so this module never pulls the settings graph at import
 * time. Falls back to OFF on any read error — the archive never silently RUNS on a
 * settings failure (fail-closed, matching the collect-gate posture).
 */
async function loadArchiveEnabled(): Promise<boolean> {
  try {
    const { settingsStore } = await import('../storage/json-fs');
    const settings = await settingsStore.read();
    return settings.xListening?.archiveCycles === true;
  } catch {
    return false;
  }
}

function defaultArchiveDeps(): ArchiveCycleDeps {
  return {
    isEnabled: loadArchiveEnabled,
    capture: (win, req) => captureVisibleTimeline(win, req),
    readState: async (caseId) => (await prodXStore()).archiveState.read(caseId),
    writeState: async (caseId, state) => (await prodXStore()).archiveState.write(caseId, state),
    now: () => new Date().toISOString()
  };
}

/**
 * Advance the opaque resume cursor. The last captured item's `messageId` is an
 * honest "where we left off" marker; a cycle that captured nothing HOLDS the prior
 * cursor rather than inventing a new one.
 */
function advanceCursor(prev: string | null, items: readonly XHarvestedItem[]): string | null {
  const last = items.length ? String(items[items.length - 1].messageId ?? '') : '';
  return last || prev;
}

/**
 * Run ONE low-rate archive cycle. Gated on the `archiveCycles` toggle — when off,
 * NO capture runs and archive state is left untouched (`ran:false`). Otherwise the
 * X3/X4 timeline capture runs (challenge-refusal gate + encrypted persistence
 * inside `captureVisibleTimeline`); on a completed run the resumable `XArchiveState`
 * advances (cycle count + injected clock + cursor) and is persisted. A cycle the
 * challenge gate BLOCKS does NOT advance state — an incomplete cycle must never
 * look like a completed one. Port of quarantine `runArchiveCycle`
 * (`electron/main.cjs:757-836`), reduced to the single-profile visible-capture path.
 */
export async function runArchiveCycle(
  win: Electron.BrowserWindow,
  req: ArchiveCycleRequest,
  overrides: Partial<ArchiveCycleDeps> = {}
): Promise<ArchiveCycleResult> {
  const deps = { ...defaultArchiveDeps(), ...overrides };
  const prev = (await deps.readState(req.caseId)) ?? EMPTY_ARCHIVE_STATE;

  if (!(await deps.isEnabled())) {
    return { ran: false, blocked: false, added: 0, skipped: 0, items: [], state: prev };
  }

  const captured = await deps.capture(win, {
    caseId: req.caseId,
    jobId: req.jobId,
    channelId: req.channelId,
    channelLabel: req.channelLabel,
    collect: req.collect
  });

  if (captured.blocked) {
    return {
      ran: false,
      blocked: true,
      reason: captured.reason,
      added: 0,
      skipped: 0,
      items: [],
      state: prev
    };
  }

  const next: XArchiveState = {
    cursor: advanceCursor(prev.cursor, captured.items),
    cycles: prev.cycles + 1,
    lastRunAt: deps.now()
  };
  await deps.writeState(req.caseId, next);
  return {
    ran: true,
    blocked: false,
    added: captured.added,
    skipped: captured.skipped,
    items: captured.items,
    state: next
  };
}

/** Bound + cancellation + low-rate spacing for a run of archive cycles. */
export interface ArchiveLoopOptions {
  /** Hard upper bound on cycles this run — clamped to [0, 1000] (bounded). */
  maxCycles: number;
  /** Low-rate spacing between cycles, in ms. Applied via the injected/real `sleep`. */
  delayMs?: number;
  /** Cooperative cancellation — checked before each cycle and before each sleep. */
  shouldCancel?: () => boolean;
  /** Injected sleep (determinism/testing); defaults to a real `setTimeout` delay. */
  sleep?: (ms: number) => Promise<void>;
}

/** The aggregate outcome of a bounded archive run. */
export interface ArchiveLoopResult {
  /** How many cycles actually completed. */
  cyclesRun: number;
  /** Total items added across the run. */
  totalAdded: number;
  /** True iff a cycle was challenge-blocked (which stops the loop). */
  blocked: boolean;
  reason?: string;
  /** True iff `shouldCancel` halted the loop early. */
  cancelled: boolean;
  /** The latest archive state observed (advanced by the last completed cycle). */
  state: XArchiveState;
}

const DEFAULT_ARCHIVE_DELAY_MS = 4 * 60 * 60 * 1000; // 4h — matches the quarantine default cadence.

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Run a BOUNDED, CANCELLABLE, low-rate sequence of archive cycles. Each cycle goes
 * through `runArchiveCycle` (so the toggle gate, challenge refusal, and state
 * advance all hold); the loop stops early the instant a cycle does not complete —
 * toggle turned off, or the challenge gate blocked it — and on cooperative
 * cancellation. A low-rate `sleep` sits BETWEEN cycles (never after the last), so a
 * long archive run stays gentle on X. Scheduling is deterministic: `sleep` and the
 * per-cycle clock are injectable, nothing here reads `Date.now()`. Port of the
 * quarantine `restartArchiveTimer` cadence (`electron/main.cjs:839-847`) recast as
 * an explicit bounded loop rather than a free-running `setInterval`.
 */
export async function runArchiveCycles(
  win: Electron.BrowserWindow,
  req: ArchiveCycleRequest,
  options: ArchiveLoopOptions,
  overrides: Partial<ArchiveCycleDeps> = {}
): Promise<ArchiveLoopResult> {
  const maxCycles = Math.max(0, Math.min(1000, Math.floor(Number(options.maxCycles) || 0)));
  const delayMs = Math.max(0, Number(options.delayMs ?? DEFAULT_ARCHIVE_DELAY_MS));
  const sleep = options.sleep ?? realSleep;
  const shouldCancel = options.shouldCancel ?? (() => false);

  let cyclesRun = 0;
  let totalAdded = 0;
  let state: XArchiveState =
    (await (overrides.readState ?? defaultArchiveDeps().readState)(req.caseId)) ??
    EMPTY_ARCHIVE_STATE;

  for (let i = 0; i < maxCycles; i++) {
    if (shouldCancel()) {
      return { cyclesRun, totalAdded, blocked: false, cancelled: true, state };
    }
    const res = await runArchiveCycle(win, req, overrides);
    state = res.state;
    if (!res.ran) {
      // Toggle off or challenge-blocked: an incomplete cycle stops the run.
      return { cyclesRun, totalAdded, blocked: res.blocked, reason: res.reason, cancelled: false, state };
    }
    cyclesRun++;
    totalAdded += res.added;
    if (i < maxCycles - 1) {
      if (shouldCancel()) {
        return { cyclesRun, totalAdded, blocked: false, cancelled: true, state };
      }
      await sleep(delayMs);
    }
  }
  return { cyclesRun, totalAdded, blocked: false, cancelled: false, state };
}

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => void;

/**
 * Wire the connect/status channels. Every handler validates the sender frame
 * FIRST (`assertTrustedSender`) — a hardened capture window can host a hostile
 * remote page, so an IPC message from a non-app frame must never be honoured —
 * then runs under the injected `handle`.
 *
 * The injected `handle` MUST be an event-PRESERVING wrapper: register.ts supplies
 * `safeHandleWithEvent` (vault gate + error sanitisation + the raw
 * `IpcMainInvokeEvent` forwarded as the handler's first argument). This is NOT the
 * plain `safeHandle` the investigation seams use — that one discards the event and
 * passes only the renderer args, which would leave `assertTrustedSender` reading a
 * renderer-controlled value (spoofable) or `undefined` (fails closed). The event
 * this handler validates is delivered by Electron/`ipcMain`, never by the renderer.
 */
export function registerXListeningIpc(deps: { handle: HandleWithEvent }): void {
  deps.handle(channels.xListening.connect, (e) => {
    assertTrustedSender(e);
    return connectXSession();
  });
  deps.handle(channels.xListening.status, (e) => {
    assertTrustedSender(e);
    return xSessionStatus();
  });
  deps.handle(channels.xListening.capture, async (e, reqArg) => {
    assertTrustedSender(e);
    if (!xWindow || xWindow.isDestroyed()) {
      throw new Error('X is not connected. Open the connect window and sign in before capturing.');
    }
    const req = reqArg as Partial<CaptureRequest> | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.channelId !== 'string') {
      throw new Error('Capture requires a caseId and a target channelId.');
    }
    // The collect toggles are read MAIN-side from settings — the renderer never gets
    // to widen capture beyond what the operator opted into (X4 trust boundary).
    const collect = await loadCollectSettings();
    return captureVisibleTimeline(xWindow, {
      caseId: req.caseId,
      jobId: typeof req.jobId === 'string' ? req.jobId : req.caseId,
      channelId: req.channelId,
      channelLabel: typeof req.channelLabel === 'string' ? req.channelLabel : `@${req.channelId}`,
      collect
    });
  });

  const networkHandler =
    (kind: 'followers' | 'following') =>
    (e: Electron.IpcMainInvokeEvent, reqArg: unknown) => {
      assertTrustedSender(e);
      if (!xWindow || xWindow.isDestroyed()) {
        throw new Error('X is not connected. Open the connect window and sign in before capturing.');
      }
      const req = reqArg as Partial<NetworkCaptureRequest> | undefined;
      if (!req || typeof req.caseId !== 'string' || typeof req.target !== 'string') {
        throw new Error('A network capture requires a caseId and a target handle.');
      }
      return captureNetwork(
        xWindow,
        {
          caseId: req.caseId,
          jobId: typeof req.jobId === 'string' ? req.jobId : req.caseId,
          target: req.target
        },
        kind
      );
    };
  deps.handle(channels.xListening.captureFollowers, networkHandler('followers'));
  deps.handle(channels.xListening.captureFollowing, networkHandler('following'));

  deps.handle(channels.xListening.exportNetwork, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Network export requires a caseId.');
    }
    return exportNetworkCsv(caseIdArg);
  });

  // Notes are pure store ops (no capture window, no network) — they need no
  // connectivity gate, only the sender check + arg validation. `savedAt` is stamped
  // MAIN-side inside `saveNote`; the renderer supplies only caseId/findingId/text.
  deps.handle(channels.xListening.saveNote, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as Partial<SaveNoteRequest> | undefined;
    if (
      !req ||
      typeof req.caseId !== 'string' ||
      typeof req.findingId !== 'string' ||
      typeof req.text !== 'string'
    ) {
      throw new Error('Saving a note requires a caseId, findingId and text.');
    }
    return saveNote({ caseId: req.caseId, findingId: req.findingId, text: req.text });
  });
  deps.handle(channels.xListening.readNotes, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Reading notes requires a caseId.');
    }
    return readNotes(caseIdArg);
  });
}
