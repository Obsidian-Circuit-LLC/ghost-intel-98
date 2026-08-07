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
