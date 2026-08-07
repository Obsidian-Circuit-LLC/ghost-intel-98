/**
 * TG1 — Telegram Hunter message-capture orchestration.
 *
 * Ties the pure normalizer (`extract.ts`) to the live Tor-proxied capture window,
 * the challenge/lock gate, host-restricted media resolution, and the encrypted
 * socmint case store. This is the seam class the v3.24.2 / Plan-A hollow-renderer
 * bugs taught us to test directly, so every collaborator is an INJECTABLE dep with a
 * production default:
 *
 *  - SETTLE before scrape: Telegram Web is a client-rendered SPA — the message DOM
 *    paints AFTER the async render, so the static scrape must wait for the visible
 *    set to render (single-viewport honesty: it waits, it does NOT scroll to load
 *    more). Order is settle → guard → scrape.
 *  - The challenge/lock gate (`extract.classifyTelegramPageState`) fronts every
 *    scrape: on a passcode-locked or signed-out page NOTHING is captured or persisted.
 *  - Media is resolved host-restricted to Telegram hosts (`TELEGRAM_MEDIA_HOSTS`) via
 *    the shared `remoteMediaToDataUri`; an unresolved remote avatar is DROPPED, and
 *    `normalizeMessage` admits `data:`-only regardless (no remote-media inlining).
 *
 * Quarantine-clean at module load: imports only `extract.ts` (pure) and the shared
 * `../../capture/security` (node:path-only). The socmint case store is imported
 * LAZILY inside the default dep, so importing this module never evaluates electron.
 *
 * NOTE (no fabricated navigation): unlike the X profile path, there is no per-chat
 * URL to navigate to — Telegram Web is a single SPA and the operator opens the target
 * chat themselves. Capture reads the CURRENTLY-OPEN chat: settle, gate, scrape. The
 * Tor gate + proxied partition + WebRTC lock are owned by `session.ts` (TF1).
 */
import {
  TG_MESSAGE_SCRIPT,
  TG_MEMBER_SCRIPT,
  TG_PAGE_STATE_SCRIPT,
  classifyTelegramPageState,
  normalizeMessage,
  normalizeMember,
  type RawMessage,
  type RawMember,
  type TelegramPageState,
  type TgHarvestedItem,
  type TgNormalizeContext,
} from './extract';
import {
  remoteMediaToDataUri,
  TELEGRAM_MEDIA_HOSTS,
  type MediaCapturePage,
} from '../../capture/security';
import type { TgMember } from './store';

/** This collector's version, stamped into every item's provenance. */
export const TG_COLLECTOR_VERSION = 'telegram-hunter/1.0.0';

/** The renderer-supplied context for a message capture: which case/job and which chat
 *  is being observed. `harvestedAt` + `collectorVersion` are stamped MAIN-side (the
 *  trusted clock + version), never accepted from the renderer. */
export interface TgCaptureRequest {
  caseId: string;
  jobId: string;
  /** The chat/group being observed (the HarvestedItem "channel"). */
  channelId: string;
  channelLabel: string;
}

export interface TgMessageCaptureResult {
  blocked: boolean;
  reason?: string;
  added: number;
  skipped: number;
  items: TgHarvestedItem[];
}

/** Injectable seams so the orchestration is testable without electron/network. */
export interface TgMessageCaptureDeps {
  /** Post-navigation SETTLE: a bounded wait so Telegram Web's async render paints the
   *  visible message DOM BEFORE the static scrape reads it. Runs BEFORE the gate/scrape.
   *  Injectable so tests stub it to a no-op (no real wait). */
  settle: (win: Electron.BrowserWindow) => Promise<void>;
  /** Run a static payload in the capture page → its result. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** Resolve a remote media URL to a local `data:` thumbnail (host-restricted), or null. */
  resolveMedia: (win: MediaCapturePage, url: string) => Promise<string | null>;
  /** The challenge/lock gate: runs `capture` ONLY on an unlocked, signed-in page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Persist normalized items to the encrypted socmint case store. */
  saveItems: (
    caseId: string,
    items: TgHarvestedItem[]
  ) => Promise<{ added: number; skipped: number }>;
  /** Injected clock — the ISO capture time stamped onto every item. */
  now: () => string;
}

/** Milliseconds the default settle waits for Telegram Web's async render to paint the
 *  visible message DOM. Bounded + self-contained (no external dep). */
const DEFAULT_SETTLE_MS = 2500;

/** The real settle: a self-contained bounded `setTimeout` Promise. Overridden in tests. */
function realSettle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DEFAULT_SETTLE_MS));
}

/** Default in-page runner — the same static-payload executor the capture stack uses,
 *  inlined so this module does not statically import electron. `userGesture=true`. */
function defaultRunCapture(win: Electron.BrowserWindow, js: string): Promise<unknown> {
  return win.webContents.executeJavaScript(js, true);
}

/** The production challenge/lock gate: probe the visible page and refuse on a locked /
 *  signed-out screen; otherwise run the capture. Uses `defaultRunCapture` for the probe. */
async function defaultGuard<T>(
  win: Electron.BrowserWindow,
  capture: () => Promise<T>
): Promise<{ blocked: boolean; reason?: string; result?: T }> {
  const probe = (await defaultRunCapture(win, TG_PAGE_STATE_SCRIPT)) as TelegramPageState;
  const state = classifyTelegramPageState({
    url: String(probe?.url || ''),
    text: String(probe?.text || ''),
    messages: Number(probe?.messages || 0),
  });
  if (state.blocked) return { blocked: true, reason: state.reason };
  return { blocked: false, result: await capture() };
}

function defaultDeps(): TgMessageCaptureDeps {
  return {
    settle: () => realSettle(),
    runCapture: defaultRunCapture,
    // Host-restricted to Telegram media hosts — a scraped SRC off those hosts is a
    // deanon beacon and is refused inside `remoteMediaToDataUri` before any fetch.
    resolveMedia: (win, url) => remoteMediaToDataUri(win, url, TELEGRAM_MEDIA_HOSTS),
    guard: defaultGuard,
    saveItems: async (caseId, items) => {
      const { upsertItems } = await import('../store');
      return upsertItems(caseId, items);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Resolve the avatar SRC on a raw message to a local `data:` thumbnail, dropping it on
 * any failure. A remote URL is NEVER carried forward — combined with
 * `normalizeMessage`'s `data:`-only filter this guarantees no stored field can beacon.
 */
async function resolveAvatar(
  win: Electron.BrowserWindow,
  raw: RawMessage,
  resolveMedia: TgMessageCaptureDeps['resolveMedia']
): Promise<RawMessage> {
  const src = String(raw.avatar ?? '');
  if (!src || src.startsWith('data:')) return raw;
  const dataUri = await resolveMedia(win, src);
  return { ...raw, avatar: dataUri ?? '' };
}

/**
 * Capture the visible Telegram messages in the live capture window and persist them.
 *
 * SETTLES first (async-SPA render), routes through the challenge/lock gate (nothing is
 * captured or persisted on a locked / signed-out page), runs the STATIC
 * `TG_MESSAGE_SCRIPT`, resolves each avatar to a host-restricted `data:` thumbnail,
 * stamps the honesty markers via `normalizeMessage`, and upserts into the encrypted
 * socmint case store.
 */
export async function captureVisibleMessages(
  win: Electron.BrowserWindow,
  req: TgCaptureRequest,
  overrides: Partial<TgMessageCaptureDeps> = {}
): Promise<TgMessageCaptureResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const ctx: TgNormalizeContext = {
    caseId: req.caseId,
    jobId: req.jobId,
    collectorVersion: TG_COLLECTOR_VERSION,
    harvestedAt: deps.now(),
    channelId: req.channelId,
    channelLabel: req.channelLabel,
  };

  // Let the async SPA render the visible message DOM BEFORE the static scrape reads it.
  await deps.settle(win);

  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, TG_MESSAGE_SCRIPT);
    const raws: RawMessage[] = Array.isArray(rawCollected) ? (rawCollected as RawMessage[]) : [];
    const items: TgHarvestedItem[] = [];
    for (const raw of raws) {
      const withAvatar = await resolveAvatar(win, raw, deps.resolveMedia);
      items.push(normalizeMessage(withAvatar, ctx));
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

// ======================================================================
// TG2 — member intelligence capture orchestration
// ======================================================================

/** The renderer-supplied context for a member scan: which case is being collected.
 *  The chat/group context is read from the visible page (the scraped chat title),
 *  never accepted from the renderer; `capturedAt` is stamped MAIN-side. */
export interface TgMemberCaptureRequest {
  caseId: string;
}

/**
 * The result of a member scan. `captured` is the count of visible member rows scraped
 * THIS pass; `added` is how many were genuinely new in the store. There is deliberately
 * NO group-total field — Telegram hides the real member/subscriber count and this
 * collector never fabricates one (honesty).
 */
export interface TgMemberCaptureResult {
  blocked: boolean;
  reason?: string;
  /** Members newly persisted this pass. */
  added: number;
  /** Visible member rows scraped this pass (== `members.length`). */
  captured: number;
  members: TgMember[];
}

/** Injectable seams so member capture is testable without electron/network. */
export interface TgMemberCaptureDeps {
  /** Post-navigation SETTLE — runs BEFORE the gate/scrape (async-SPA render wait). */
  settle: (win: Electron.BrowserWindow) => Promise<void>;
  /** Run a static payload in the capture page → its result. */
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  /** Resolve a remote media URL to a local `data:` thumbnail (host-restricted), or null. */
  resolveMedia: (win: MediaCapturePage, url: string) => Promise<string | null>;
  /** The challenge/lock gate: runs `capture` ONLY on an unlocked, signed-in page. */
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Persist visible members to the encrypted per-tool `members` artifact store. */
  saveMembers: (
    caseId: string,
    members: TgMember[]
  ) => Promise<{ added: number; total: number }>;
  /** Injected clock — the ISO capture time stamped onto every member. */
  now: () => string;
}

function defaultMemberDeps(): TgMemberCaptureDeps {
  return {
    settle: () => realSettle(),
    runCapture: defaultRunCapture,
    resolveMedia: (win, url) => remoteMediaToDataUri(win, url, TELEGRAM_MEDIA_HOSTS),
    guard: defaultGuard,
    saveMembers: async (caseId, members) => {
      const { prodTgHunterStore } = await import('./store');
      const store = await prodTgHunterStore();
      return store.members.saveMany(caseId, members);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Resolve a member's avatar SRC to a local `data:` thumbnail, dropping it on any
 * failure. A remote URL is NEVER carried forward — combined with `normalizeMember`'s
 * `data:`-only filter this guarantees no stored member field can beacon.
 */
async function resolveMemberAvatar(
  win: Electron.BrowserWindow,
  raw: RawMember,
  resolveMedia: TgMemberCaptureDeps['resolveMedia']
): Promise<RawMember> {
  const src = String(raw.avatar ?? '');
  if (!src || src.startsWith('data:')) return raw;
  const dataUri = await resolveMedia(win, src);
  return { ...raw, avatar: dataUri ?? '' };
}

/**
 * Capture the visible Telegram group/channel members in the live capture window and
 * persist them.
 *
 * SETTLES first (async-SPA render), routes through the challenge/lock gate (nothing is
 * captured or persisted on a locked / signed-out page), runs the STATIC
 * `TG_MEMBER_SCRIPT`, resolves each avatar to a host-restricted `data:` thumbnail,
 * stamps the honesty markers via `normalizeMember`, and batch-upserts into the encrypted
 * `members` artifact store. Reports ONLY the members actually collected — it NEVER
 * fabricates a group total (Telegram hides the real member/subscriber count).
 */
export async function captureMembers(
  win: Electron.BrowserWindow,
  req: TgMemberCaptureRequest,
  overrides: Partial<TgMemberCaptureDeps> = {}
): Promise<TgMemberCaptureResult> {
  const deps = { ...defaultMemberDeps(), ...overrides };
  const capturedAt = deps.now();

  // Let the async SPA render the visible member DOM BEFORE the static scrape reads it.
  await deps.settle(win);

  const gated = await deps.guard(win, async () => {
    const rawCollected = await deps.runCapture(win, TG_MEMBER_SCRIPT);
    const raws: RawMember[] = Array.isArray(rawCollected) ? (rawCollected as RawMember[]) : [];
    const members: TgMember[] = [];
    for (const raw of raws) {
      const withAvatar = await resolveMemberAvatar(win, raw, deps.resolveMedia);
      members.push(normalizeMember(withAvatar, { capturedAt }));
    }
    return members;
  });

  if (gated.blocked) {
    return { blocked: true, reason: gated.reason, added: 0, captured: 0, members: [] };
  }

  const members = gated.result ?? [];
  const { added } = await deps.saveMembers(req.caseId, members);
  return { blocked: false, added, captured: members.length, members };
}
