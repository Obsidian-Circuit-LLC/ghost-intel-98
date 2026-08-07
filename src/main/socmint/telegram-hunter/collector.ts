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
  TG_PROFILE_SCRIPT,
  TG_PAGE_STATE_SCRIPT,
  classifyTelegramPageState,
  normalizeMessage,
  normalizeMember,
  normalizeProfile,
  type RawMessage,
  type RawMember,
  type RawProfile,
  type TelegramPageState,
  type TgHarvestedItem,
  type TgNormalizeContext,
  type TgProfile,
} from './extract';
import {
  remoteMediaToDataUri,
  csvCell,
  escapeField,
  TELEGRAM_MEDIA_HOSTS,
  type MediaCapturePage,
} from '../../capture/security';
import type { TgMember } from './store';
import type { SocmintCollector } from '../collector';
import type { SocmintTransport } from '../tor-identity';
import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import type { TelegramCaptureResult } from './session';

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
  /** Mirror of `AppSettings.socmint.telegram.captureMedia`, read MAIN-side (the renderer
   *  never widens capture). When `false` (the default), avatar/media resolution is SKIPPED
   *  entirely — no media fetch runs and NO avatar is stored, even an in-page `data:` one —
   *  because the operator opts media capture in. When `true`, a remote SRC is resolved to a
   *  host-restricted `data:` thumbnail and an in-page `data:` avatar is kept. */
  captureMedia: boolean;
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
    // OFF by default — capture never silently WIDENS to media. The ipc handler reads the
    // real setting MAIN-side and passes it in; a settings-read failure falls back to false.
    captureMedia: false,
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
 *
 * When `captureMedia` is false the avatar is dropped WITHOUT any resolution — no media
 * fetch is issued and not even an in-page `data:` avatar is kept — so the setting is
 * honored, not a dormant no-op: media capture happens only when the operator opts in.
 */
async function resolveAvatar(
  win: Electron.BrowserWindow,
  raw: RawMessage,
  resolveMedia: TgMessageCaptureDeps['resolveMedia'],
  captureMedia: boolean
): Promise<RawMessage> {
  if (!captureMedia) return { ...raw, avatar: '' };
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
      const withAvatar = await resolveAvatar(win, raw, deps.resolveMedia, deps.captureMedia);
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
// TG4 — keyword watch + dedup (PURE, security-critical)
// ======================================================================
//
// Two invariants live here, both pinnable without electron/network/disk:
//
//   * Keyword matching is LITERAL — a saved term is a `.includes()` substring, NEVER
//     `new RegExp(untrustedTerm)`. A term of `(a+)+$` can therefore neither hang the
//     app (ReDoS) nor over-match (`a.c` must not match `abc`). This is the standing
//     "Keyword-watch is LITERAL match (no new RegExp(untrusted))" rule.
//   * The highlight DOES build a `RegExp`, but ONLY from regex-ESCAPED literal terms
//     (the source `highlightHtml` escape) — a flat literal alternation is ReDoS-free
//     and highlights the literal term, not a regex interpretation. It returns plain
//     text/marked SEGMENTS (main-side); wrapping them in `<mark>` is a render concern.
//
// Ported from quarantine `renderer.js` (`keywordMessageMatches`, `highlightHtml`) and
// `main.js` (`dedupe`, the `allKeywordRecords` seen-set).

/** A keyword rule as consumed by the matcher — the persisted `TgKeywordRule` (from the
 *  encrypt-at-rest `keywordWatch` store) satisfies this shape. */
export interface KeywordRule {
  term: string;
  /** Case-sensitive literal match when true; default (absent) is case-insensitive. */
  caseSensitive?: boolean;
  /** Exact-phrase (one `.includes`) when true/absent; all-words (each `.includes`) when false. */
  exactPhrase?: boolean;
}

/** One record row scanned by the matcher. A `TgHarvestedItem` satisfies this shape; the
 *  matcher reads only the visible searchable fields (never a fabricated one). */
export type KeywordSearchable = Pick<TgHarvestedItem, 'text' | 'authorHandle' | 'channelLabel'> & {
  authorDisplay?: string;
  links?: string[];
};

/** One highlight segment: a run of text and whether it is a keyword hit. */
export interface HighlightSegment {
  text: string;
  mark: boolean;
}

/** The visible searchable haystack for a record — text, the visible sender (display name
 *  when shown, else the @handle), the chat/channel label, and any verbatim links. Ported
 *  from the source `keywordMessageMatches` field set (`[m.text, m.author, m.chat, ...links]`). */
function keywordHaystack(rec: KeywordSearchable): string {
  return [rec.text, rec.authorDisplay || rec.authorHandle, rec.channelLabel, ...(rec.links ?? [])]
    .filter(Boolean)
    .join('\n');
}

/**
 * Does `rec` match keyword `rule`? LITERAL — a `.includes()` substring test, NEVER a
 * compiled `RegExp` on the untrusted term (ReDoS/injection guard). Exact-phrase matches
 * the whole term as one substring; `exactPhrase:false` matches when every whitespace-
 * split word appears (each literally). Case-insensitive unless `caseSensitive` is set.
 * Port of quarantine `renderer.js` `keywordMessageMatches`.
 */
export function matchesKeyword(rec: KeywordSearchable, rule: KeywordRule): boolean {
  const term = String(rule?.term ?? '');
  if (!term) return false;
  const fields = keywordHaystack(rec);
  const hay = rule.caseSensitive ? fields : fields.toLowerCase();
  const needle = rule.caseSensitive ? term : term.toLowerCase();
  if (rule.exactPhrase !== false) return hay.includes(needle);
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Scan `records` against `rules`, returning each record paired with the subset of rules
 *  it literally matched (records with no hits are omitted). */
export function matchKeywords<T extends KeywordSearchable>(
  records: readonly T[],
  rules: readonly KeywordRule[],
): Array<{ record: T; hits: KeywordRule[] }> {
  const out: Array<{ record: T; hits: KeywordRule[] }> = [];
  for (const record of records) {
    const hits = rules.filter((r) => matchesKeyword(record, r));
    if (hits.length) out.push({ record, hits });
  }
  return out;
}

/** Escape every regex metacharacter so a term is matched as a LITERAL inside a `RegExp`.
 *  Port of the source `highlightHtml` escape (`/[.*+?^${}()|[\]\\]/g`). */
export function escapeKeywordRegExp(term: string): string {
  return String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `value` into highlight SEGMENTS, marking each run that matches one of `terms`.
 * The `RegExp` is built ONLY from regex-ESCAPED literal terms (a flat alternation), so it
 * is ReDoS-free and marks the literal term — `a.c` marks `a.c`, never `abc`. Longer terms
 * are tried first (source ordering) so an overlapping shorter term never pre-empts them.
 * Reassembling the segments' `text` reproduces `value` verbatim (lossless — escaping to
 * HTML is the caller's job). Port of quarantine `renderer.js` `highlightHtml`.
 */
export function highlightKeyword(
  value: string,
  hits: ReadonlyArray<Pick<KeywordRule, 'term' | 'caseSensitive'>>,
): HighlightSegment[] {
  const text = String(value ?? '');
  const terms = [...new Set(hits.map((k) => String(k?.term ?? '')).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!terms.length) return [{ text, mark: false }];
  const flags = hits.some((k) => k.caseSensitive) ? 'g' : 'gi';
  const pattern = terms.map(escapeKeywordRegExp).join('|');
  const segs: HighlightSegment[] = [];
  try {
    const re = new RegExp(`(${pattern})`, flags);
    let last = 0;
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) segs.push({ text: text.slice(last, idx), mark: false });
      segs.push({ text: m[0], mark: true });
      last = idx + m[0].length;
    }
    if (last < text.length) segs.push({ text: text.slice(last), mark: false });
  } catch {
    return [{ text, mark: false }];
  }
  return segs.length ? segs : [{ text, mark: false }];
}

/**
 * The content-based dedup key for a captured record: chat · author · timestamp · text,
 * lower-cased. Two visible rows carrying the same content collapse to one regardless of a
 * differing surrogate id (cross-source dedup — a captured message and the same message in
 * an imported export are one record). Port of the source message dedup key.
 */
export function dedupKeyForItem(
  rec: Pick<TgHarvestedItem, 'channelId' | 'authorHandle' | 'publishedAt' | 'text'>,
): string {
  return [rec.channelId, rec.authorHandle, rec.publishedAt, rec.text]
    .map((v) => String(v ?? ''))
    .join('|')
    .toLowerCase();
}

/** Stable, order-preserving dedup by a caller-supplied key (first occurrence wins). An
 *  empty/falsy key is DROPPED (never coalesced). Port of quarantine `main.js` `dedupe`. */
export function dedupItems<T>(items: readonly T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of items) {
    const k = keyFn(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
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
  /** Mirror of `AppSettings.socmint.telegram.captureMedia`, read MAIN-side. When `false`
   *  (the default) member avatar resolution is SKIPPED entirely (no media fetch, no avatar
   *  stored — not even an in-page `data:` one); `true` resolves a remote SRC host-restricted
   *  and keeps an in-page `data:` avatar. The operator opts media capture in. */
  captureMedia: boolean;
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
    // OFF by default — member media capture happens only when the operator opts in.
    captureMedia: false,
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
  resolveMedia: TgMemberCaptureDeps['resolveMedia'],
  captureMedia: boolean
): Promise<RawMember> {
  if (!captureMedia) return { ...raw, avatar: '' };
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
      const withAvatar = await resolveMemberAvatar(win, raw, deps.resolveMedia, deps.captureMedia);
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

// ======================================================================
// TG3 — visible-profile capture (honesty-critical)
// ======================================================================
//
// The operator opens a user's profile panel (right column / user-info dialog) in the
// live capture window; this reads the CURRENTLY-VISIBLE panel via the STATIC
// `TG_PROFILE_SCRIPT` and persists ONE honesty-stamped `TgProfile` (or none when no
// panel is open). Mirrors member capture: settle → gate → scrape → host-restricted
// avatar → normalize → encrypted `profiles` artifact store. `normalizeProfile` keeps
// the account-creation date null (Telegram hides it) — never fabricated.

export interface TgProfileCaptureRequest {
  caseId: string;
}

/**
 * The result of a profile scan. `captured` is 0 or 1 (a single visible panel);
 * `added` is how many were genuinely new in the store. There is NO fabricated field —
 * `normalizeProfile` leaves the account-creation date null with the fixed label.
 */
export interface TgProfileCaptureResult {
  blocked: boolean;
  reason?: string;
  /** Profiles newly persisted this pass. */
  added: number;
  /** Visible profile panels scraped this pass (0 or 1 == `profiles.length`). */
  captured: number;
  profiles: TgProfile[];
}

/** Injectable seams so profile capture is testable without electron/network. */
export interface TgProfileCaptureDeps {
  settle: (win: Electron.BrowserWindow) => Promise<void>;
  runCapture: (win: Electron.BrowserWindow, js: string) => Promise<unknown>;
  resolveMedia: (win: MediaCapturePage, url: string) => Promise<string | null>;
  /** Mirror of `AppSettings.socmint.telegram.captureMedia`, read MAIN-side. When `false`
   *  (the default) avatar resolution is SKIPPED entirely (no media fetch, no avatar stored). */
  captureMedia: boolean;
  guard: <T>(
    win: Electron.BrowserWindow,
    capture: () => Promise<T>
  ) => Promise<{ blocked: boolean; reason?: string; result?: T }>;
  /** Persist visible profiles to the encrypted per-tool `profiles` artifact store. */
  saveProfiles: (
    caseId: string,
    profiles: TgProfile[]
  ) => Promise<{ added: number; total: number }>;
  now: () => string;
}

function defaultProfileDeps(): TgProfileCaptureDeps {
  return {
    settle: () => realSettle(),
    runCapture: defaultRunCapture,
    resolveMedia: (win, url) => remoteMediaToDataUri(win, url, TELEGRAM_MEDIA_HOSTS),
    captureMedia: false,
    guard: defaultGuard,
    saveProfiles: async (caseId, profiles) => {
      const { prodTgHunterStore } = await import('./store');
      const store = await prodTgHunterStore();
      return store.profiles.saveMany(caseId, profiles);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Resolve a profile's avatar SRC to a local `data:` thumbnail, dropping it on any
 * failure. A remote URL is NEVER carried forward — combined with `normalizeProfile`'s
 * `data:`-only filter no stored profile field can beacon.
 */
async function resolveProfileAvatar(
  win: Electron.BrowserWindow,
  raw: RawProfile,
  resolveMedia: TgProfileCaptureDeps['resolveMedia'],
  captureMedia: boolean
): Promise<RawProfile> {
  if (!captureMedia) return { ...raw, avatar: '' };
  const src = String(raw.avatar ?? '');
  if (!src || src.startsWith('data:')) return raw;
  const dataUri = await resolveMedia(win, src);
  return { ...raw, avatar: dataUri ?? '' };
}

/**
 * Capture the visible Telegram user profile currently open in the capture window and
 * persist it. SETTLES first (async-SPA render), routes through the challenge/lock gate
 * (nothing is captured or persisted on a locked / signed-out page), runs the STATIC
 * `TG_PROFILE_SCRIPT` (returns one `RawProfile` or null), resolves the avatar to a
 * host-restricted `data:` thumbnail, stamps the honesty markers via `normalizeProfile`,
 * and upserts into the encrypted `profiles` artifact store.
 */
export async function captureProfile(
  win: Electron.BrowserWindow,
  req: TgProfileCaptureRequest,
  overrides: Partial<TgProfileCaptureDeps> = {}
): Promise<TgProfileCaptureResult> {
  const deps = { ...defaultProfileDeps(), ...overrides };
  const capturedAt = deps.now();

  await deps.settle(win);

  const gated = await deps.guard(win, async () => {
    const raw = (await deps.runCapture(win, TG_PROFILE_SCRIPT)) as RawProfile | null;
    if (!raw || typeof raw !== 'object') return [] as TgProfile[];
    const withAvatar = await resolveProfileAvatar(win, raw, deps.resolveMedia, deps.captureMedia);
    return [normalizeProfile(withAvatar, { capturedAt })];
  });

  if (gated.blocked) {
    return { blocked: true, reason: gated.reason, added: 0, captured: 0, profiles: [] };
  }

  const profiles = gated.result ?? [];
  const { added } = await deps.saveProfiles(req.caseId, profiles);
  return { blocked: false, added, captured: profiles.length, profiles };
}

// ======================================================================
// TG5 — TelegramHunterCollector: the capture-window engine, wrapped so it
//       satisfies the existing SocmintCollector interface (the mtcute swap).
// ======================================================================
//
// SOCMINT's store/rank/filter/IPC seam is typed against `SocmintCollector`
// (connect/join/backfill/subscribe/disconnect). Implementing it here lets the
// Telegram Hunter capture-window engine drop in where `makeMtcuteCollector` used
// to sit — WITHOUT re-deriving any of the streaming pipeline.
//
// The capture-window model is fundamentally pull-based (the operator opens the
// target chat in the Tor-proxied window; a capture reads the CURRENTLY-VISIBLE
// set), so the streaming methods map honestly:
//   - connect()  → open the Tor-fail-closed capture window (`session.ts`). When Tor
//                  is not ready the opener returns `blocked` and NO window is made;
//                  connect() THROWS — there is never a clearnet fallback.
//   - join()     → a no-op `MonitoredChannel` (there is no per-chat URL to navigate;
//                  the operator opens the chat themselves).
//   - backfill() → one visible-message capture of the open chat (single-viewport
//                  honesty; `saveItems` overridden to a no-op so the caller owns
//                  persistence and nothing is written twice).
//   - subscribe()→ a no-op unsubscribe: a visible-DOM capture has no live push
//                  stream, and this collector never fabricates one.
//   - disconnect()→ close the capture window.
//
// The Telegram tab drives capture through the dedicated `open` / `captureMessages`
// / `captureGroupMembers` / `captureUserProfile` methods (wired in
// `telegram-hunter/ipc.ts`); the SocmintCollector methods keep the type contract intact.

/** The partition the Telegram capture window lives on. */
export const SOCMINT_TELEGRAM_PARTITION = 'persist:socmint-telegram';

export interface TelegramHunterCollectorConfig {
  /** Session partition (default `SOCMINT_TELEGRAM_PARTITION`). */
  partition?: string;
  /** Injected clock — the ISO capture time stamped onto backfilled items. */
  now?: () => string;
  /** The Tor-fail-closed window opener — defaults to a lazy `session.ts` import so
   *  this module pulls no electron statically (keeps it quarantine-clean at load). */
  openFn?: (partition: string) => Promise<TelegramCaptureResult>;
  /** Message-capture orchestrator — defaults to `captureVisibleMessages`. */
  captureMessagesFn?: (
    win: Electron.BrowserWindow,
    req: TgCaptureRequest,
    overrides?: Partial<TgMessageCaptureDeps>,
  ) => Promise<TgMessageCaptureResult>;
  /** Member-capture orchestrator — defaults to `captureMembers`. */
  captureMembersFn?: (
    win: Electron.BrowserWindow,
    req: TgMemberCaptureRequest,
    overrides?: Partial<TgMemberCaptureDeps>,
  ) => Promise<TgMemberCaptureResult>;
  /** Profile-capture orchestrator — defaults to `captureProfile`. */
  captureProfileFn?: (
    win: Electron.BrowserWindow,
    req: TgProfileCaptureRequest,
    overrides?: Partial<TgProfileCaptureDeps>,
  ) => Promise<TgProfileCaptureResult>;
}

export class TelegramHunterCollector implements SocmintCollector {
  private win: Electron.BrowserWindow | null = null;
  private readonly partition: string;
  private readonly now: () => string;
  private readonly openFn: (partition: string) => Promise<TelegramCaptureResult>;
  private readonly captureMessagesFn: NonNullable<TelegramHunterCollectorConfig['captureMessagesFn']>;
  private readonly captureMembersFn: NonNullable<TelegramHunterCollectorConfig['captureMembersFn']>;
  private readonly captureProfileFn: NonNullable<TelegramHunterCollectorConfig['captureProfileFn']>;

  constructor(cfg: TelegramHunterCollectorConfig = {}) {
    this.partition = cfg.partition ?? SOCMINT_TELEGRAM_PARTITION;
    this.now = cfg.now ?? (() => new Date().toISOString());
    this.openFn =
      cfg.openFn ??
      (async (partition) => {
        // Lazy so importing this module never evaluates electron/session/Tor.
        const { openTelegramCapture } = await import('./session');
        return openTelegramCapture(partition);
      });
    this.captureMessagesFn = cfg.captureMessagesFn ?? captureVisibleMessages;
    this.captureMembersFn = cfg.captureMembersFn ?? captureMembers;
    this.captureProfileFn = cfg.captureProfileFn ?? captureProfile;
  }

  /** True while a live (non-destroyed) capture window is held. */
  isOpen(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }

  /**
   * Open (or resurface) the Tor-proxied, WebRTC-locked Telegram capture window.
   * Returns `{ blocked }` and creates NO window when Tor is not ready — never a
   * clearnet fallback. A live window is surfaced rather than duplicated.
   */
  async open(): Promise<{ opened: true } | { blocked: true; reason: string }> {
    if (this.isOpen()) {
      const w = this.win as Electron.BrowserWindow & { show?: () => void; focus?: () => void };
      w.show?.();
      w.focus?.();
      return { opened: true };
    }
    const res = await this.openFn(this.partition);
    if ('blocked' in res) return { blocked: true, reason: res.reason };
    this.win = res.win;
    return { opened: true };
  }

  private requireWindow(): Electron.BrowserWindow {
    if (!this.isOpen() || !this.win) {
      throw new Error(
        'Telegram is not connected. Open the Tor capture window and sign in before capturing.',
      );
    }
    return this.win;
  }

  /** Capture the visible messages in the currently-open chat and persist them. */
  async captureMessages(
    req: TgCaptureRequest,
    overrides: Partial<TgMessageCaptureDeps> = {},
  ): Promise<TgMessageCaptureResult> {
    return this.captureMessagesFn(this.requireWindow(), req, overrides);
  }

  /** Capture the visible group/channel members and persist them (no fabricated total). */
  async captureGroupMembers(
    req: TgMemberCaptureRequest,
    overrides: Partial<TgMemberCaptureDeps> = {},
  ): Promise<TgMemberCaptureResult> {
    return this.captureMembersFn(this.requireWindow(), req, overrides);
  }

  /** Capture the visible user profile currently open and persist it (no fabricated
   *  account-creation date). */
  async captureUserProfile(
    req: TgProfileCaptureRequest,
    overrides: Partial<TgProfileCaptureDeps> = {},
  ): Promise<TgProfileCaptureResult> {
    return this.captureProfileFn(this.requireWindow(), req, overrides);
  }

  // ---- SocmintCollector interface --------------------------------------

  async connect(): Promise<void> {
    const res = await this.open();
    if ('blocked' in res) throw new Error(res.reason);
  }

  async join(channel: string): Promise<MonitoredChannel> {
    // No per-chat navigation — the operator opens the target chat in the window.
    return { channelId: channel, label: channel, keywords: [] };
  }

  async backfill(channelId: string, _limit: number): Promise<HarvestedItem[]> {
    // One visible-viewport capture. `saveItems` is overridden to a no-op: backfill
    // returns the items and the caller owns persistence (no double-write).
    const result = await this.captureMessages(
      { caseId: '', jobId: '', channelId, channelLabel: channelId },
      { saveItems: async () => ({ added: 0, skipped: 0 }), now: this.now },
    );
    return result.items;
  }

  subscribe(_channelIds: string[], _onItem: (i: HarvestedItem) => void): () => void {
    // A visible-DOM capture has no live push stream; return an inert unsubscribe.
    return () => {};
  }

  async disconnect(): Promise<void> {
    if (this.isOpen() && this.win) this.win.close();
    this.win = null;
  }
}

/**
 * CollectorFactory-compatible builder so `register.ts` can swap the Telegram engine in
 * where `makeMtcuteCollector` used to sit. The capture window self-gates on Tor
 * (`session.ts`), so `burnerId`/`transport` are intentionally ignored — there is no
 * MTProto burner and no per-collector dial; `harvestedAt` becomes the injected clock.
 */
export function makeTelegramHunterCollector(opts: {
  burnerId: string;
  transport: SocmintTransport;
  harvestedAt: () => string;
}): SocmintCollector {
  return new TelegramHunterCollector({ now: opts.harvestedAt });
}

// ======================================================================
// TG6 — case exports (reuse the shared export guards, CSV/HTML-safe)
// ======================================================================
//
// The quarantine source (`telegram-hunter/src/main.js`) exported a case to JSON
// and a per-collection CSV whose `csvEscape` only doubled interior quotes — a
// scraped bio like `=HYPERLINK("http://evil")` stayed a LIVE spreadsheet formula,
// and its PDF/DOCX reports interpolated visible fields with no HTML escape. This
// port keeps the same three collections (messages / members / profiles) but routes
// EVERY CSV cell through the shared `csvCell` (RFC-4180 + formula-injection guard)
// and EVERY HTML-report field through the shared `escapeField` — the exact guards
// the X Listening Station exporter uses. No new dependency: PDF/DOCX (which needed
// pdfkit/docx in the source) become a dependency-free self-contained HTML report.
//
// These serializers are PURE (no electron/disk/network): `ipc.ts` reads the records
// from the encrypted stores and hands them here. Everything a scraped field could
// carry is neutralized at THIS boundary before it reaches a spreadsheet or a browser.

/** Export container formats the Telegram tab offers. `json` is the raw honesty-stamped
 *  records; `csv` is formula-guarded; `html` is a self-contained escaped report. */
export type TgExportFormat = 'json' | 'csv' | 'html';

/** Which captured collection is being exported. */
export type TgExportCollection = 'messages' | 'members' | 'profiles';

/** A flat, already-stringified export table: a title, column headers, and rows. The values
 *  are plain strings — the CSV/HTML emitters own ALL escaping so no caller can bypass it. */
export interface TgExportTable {
  title: string;
  headers: string[];
  rows: string[][];
}

/** Message export columns (the visible `HarvestedItem` fields — never a fabricated one). */
const MESSAGE_EXPORT_COLUMNS: ReadonlyArray<keyof HarvestedItem> = [
  'platform',
  'channelId',
  'channelLabel',
  'authorHandle',
  'authorId',
  'messageId',
  'text',
  'publishedAt',
  'harvestedAt',
  'url',
];

/** Coerce any field value to the export string form (nullish → empty; never `"undefined"`). */
function cellText(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Build the messages export table from captured `HarvestedItem`s. */
export function messagesTable(items: readonly HarvestedItem[]): TgExportTable {
  return {
    title: 'Telegram messages',
    headers: MESSAGE_EXPORT_COLUMNS.map((c) => String(c)),
    rows: items.map((it) =>
      MESSAGE_EXPORT_COLUMNS.map((c) => cellText((it as unknown as Record<string, unknown>)[c])),
    ),
  };
}

/** Build the members export table (visible member intelligence — no fabricated total). */
export function membersTable(members: readonly TgMember[]): TgExportTable {
  const headers = ['handle', 'displayName', 'phone', 'status', 'context', 'profileUrl', 'capturedAt'];
  return {
    title: 'Telegram members',
    headers,
    rows: members.map((m) => [
      cellText(m.handle),
      cellText(m.displayName),
      cellText(m.phone),
      cellText(m.status),
      cellText(m.context),
      cellText(m.profileUrl),
      cellText(m.capturedAt),
    ]),
  };
}

/** Build the profiles export table. The account-creation column carries the FIXED
 *  unavailable LABEL — never a fabricated date (Telegram Web does not expose one). */
export function profilesTable(profiles: readonly TgProfile[]): TgExportTable {
  const headers = [
    'handle',
    'displayName',
    'phone',
    'bio',
    'status',
    'context',
    'links',
    'profileUrl',
    'accountCreation',
    'capturedAt',
  ];
  return {
    title: 'Telegram profiles',
    headers,
    rows: profiles.map((p) => [
      cellText(p.handle),
      cellText(p.displayName),
      cellText(p.phone),
      cellText(p.bio),
      cellText(p.status),
      cellText(p.context),
      (p.links ?? []).map((l) => cellText(l)).join('; '),
      cellText(p.profileUrl),
      // Honesty: the fixed unavailable label, NEVER an inferred creation date.
      cellText(p.accountCreationLabel),
      cellText(p.capturedAt),
    ]),
  };
}

/** Resolve the export table for a collection from its already-read records. */
export function tableFor(collection: TgExportCollection, records: readonly unknown[]): TgExportTable {
  switch (collection) {
    case 'members':
      return membersTable(records as readonly TgMember[]);
    case 'profiles':
      return profilesTable(records as readonly TgProfile[]);
    case 'messages':
    default:
      return messagesTable(records as readonly HarvestedItem[]);
  }
}

/**
 * Serialize a table to RFC-4180 CSV with EVERY cell (header + body) routed through the
 * shared `csvCell` — a scraped value whose first char could start a spreadsheet formula
 * (`= + - @`, tab, CR) is prefixed with `'` so Excel/Sheets treat it as literal text.
 */
export function tableToCsv(table: TgExportTable): string {
  const header = table.headers.map((h) => csvCell(h)).join(',');
  const rows = table.rows.map((r) => r.map((c) => csvCell(c)).join(','));
  return [header, ...rows].join('\r\n');
}

/**
 * Serialize a table to a self-contained HTML report with EVERY field (title, header, cell)
 * routed through the shared `escapeField` — a scraped `<script>` / `"` / `&` becomes an
 * entity and can never break out of its cell into markup or an attribute. Dependency-free
 * stand-in for the source's pdfkit/docx reports (no new dep is permitted).
 */
export function tableToHtml(table: TgExportTable): string {
  const title = escapeField(table.title);
  const head = table.headers.map((h) => `<th>${escapeField(h)}</th>`).join('');
  const body = table.rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeField(c)}</td>`).join('')}</tr>`)
    .join('');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${title}</title></head><body><h1>${title}</h1>` +
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    '</body></html>'
  );
}
