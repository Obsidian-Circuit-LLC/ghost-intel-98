/**
 * TG1 — Telegram Hunter visible-message extraction + normalization.
 *
 * PURE and quarantine-clean: this module imports only `node:crypto` and the shared
 * `HarvestedItem` TYPE (erased at runtime) — no electron, no bgconn/Tor/session. It
 * provides two things the Telegram capture path (`collector.ts`) leans on:
 *
 *  1. `TG_MESSAGE_SCRIPT` — the STATIC in-page payload the hardened capture window
 *     runs via `executeJavaScript`. Ported from quarantine
 *     `telegram-hunter/src/renderer.js` `extractionScript` (the message loop). It
 *     contains NO `${…}` interpolation: nothing scraped is ever spliced into
 *     executed code, and — unlike the source, which fetched avatar blobs in-page
 *     with NO host restriction — it does NOT `fetch()` any media. It reads ONLY the
 *     visible message DOM and returns each row's avatar SRC; host-restricted
 *     resolution to a local `data:` thumbnail is deferred to the collector (via the
 *     shared, host-restricted `remoteMediaToDataUri`).
 *
 *  2. `normalizeMessage` — the pure normalizer turning one captured raw message into
 *     a `HarvestedItem`, honest by construction:
 *       - message text is preserved VERBATIM (escaping is a render/export concern,
 *         handled by `escapeField` at emit time, never baked into storage);
 *       - the avatar is admitted ONLY as a local `data:` thumbnail — any remote
 *         `http(s)` URL is DROPPED, never stored (no remote-media inlining / beacon);
 *       - the visible display name is recorded honestly and NEVER falls back to the
 *         @handle (an unobserved display name is absent, not fabricated);
 *       - the visible profile permalink is scheme-guarded to Telegram hosts.
 *     Every item is stamped `verified:false` + `captureProvenance:'visible-capture'`.
 *
 * `classifyTelegramPageState` + `TG_PAGE_STATE_SCRIPT` are the challenge/lock gate:
 * a static probe of the visible page + a pure classifier the collector routes every
 * scrape through, so a locked / signed-out Telegram Web never yields a capture.
 */
import { createHash } from 'node:crypto';
import type { HarvestedItem } from '@shared/socmint/types';
// TYPE-ONLY (erased at runtime): the member normalizer emits the store's canonical
// `TgMember` record. This is a type import, so it pulls NO runtime code from store.ts
// and keeps extract.ts pure / quarantine-clean.
import type { TgMember } from './store';

// ---- captured-DOM raw shape --------------------------------------------

/**
 * One raw message row as returned by `TG_MESSAGE_SCRIPT` (a visible message bubble).
 * `avatar` is the image SRC (or an in-page `canvas.toDataURL()` result) at capture
 * time; the collector resolves a remote SRC to a local `data:` thumbnail
 * host-restricted to Telegram hosts before normalization, and `normalizeMessage`
 * admits ONLY a `data:` avatar regardless (defense in depth — no remote inlining).
 */
export interface RawMessage {
  /** The visible chat/group title the message was seen under. */
  chat: string;
  /** The visible sender display name — '' when none was shown (NEVER the @handle). */
  author: string;
  /** The visible sender handle as `@handle`, or '' when none was visible. */
  authorUsername: string;
  /** The visible sender profile link (`https://t.me/<handle>`) — scheme-guarded on normalize. */
  authorProfileUrl: string;
  /** The visible timestamp text, exactly as Telegram Web rendered it (verbatim). */
  timestamp: string;
  /** The visible message body text (verbatim). */
  text: string;
  /** URLs found verbatim in the message text. */
  links: string[];
  /** The avatar SRC (or an in-page `data:`), resolved to a `data:` thumbnail before storage. */
  avatar: string;
  /** `'SERVICE EVENT'` for a join/leave/pin/etc. service line, else ''. */
  eventType: string;
  /** The `data-message-id` attribute when present, else '' (a surrogate is derived). */
  messageId: string;
}

// ---- normalized output --------------------------------------------------

/**
 * A captured Telegram message. Extends the shared `HarvestedItem` (so it round-trips
 * through the socmint case store) with Telegram-specific, honesty-critical fields:
 *
 *  - `verified` is always `false` — visible-DOM capture never verifies content.
 *  - `captureProvenance` is always `'visible-capture'`.
 *  - `authorDisplay` is the visible sender display name, OMITTED when none was
 *    shown — it is NEVER backfilled from the @handle.
 *  - `authorProfileUrl` is a Telegram-host-guarded profile permalink, when visible.
 *  - `avatar` is a local `data:` thumbnail only — never a remote URL.
 *  - `eventType` marks a service line (join/leave/pin) — absent for ordinary messages.
 */
export interface TgHarvestedItem extends HarvestedItem {
  captureProvenance: 'visible-capture';
  verified: false;
  /** Visible sender display name; ABSENT when none was shown — never the @handle. */
  authorDisplay?: string;
  /** Telegram-host-guarded profile permalink, when visible. */
  authorProfileUrl?: string;
  /** URLs found verbatim in the message text. */
  links: string[];
  /** `'SERVICE EVENT'` when the row was a service line, else absent. */
  eventType?: 'SERVICE EVENT';
  /** Local `data:` avatar thumbnail — data: only, never a remote URL. */
  avatar?: string;
}

/** Context the pure normalizer needs but cannot observe from a single message row. */
export interface TgNormalizeContext {
  caseId: string;
  jobId: string;
  collectorVersion: string;
  /** ISO timestamp — injected clock. NEVER computed here (determinism floor). */
  harvestedAt: string;
  /** The chat/group being observed — the `HarvestedItem` "channel". */
  channelId: string;
  channelLabel: string;
}

// ---- static in-page payload (port of renderer.js extractionScript) ------

/**
 * STATIC payload run in the capture page to read the visible message DOM. No
 * interpolation — the ONLY inputs are literal selectors — and NO in-page media
 * fetch (the source fetched avatar blobs unrestricted; this returns the avatar SRC
 * for host-restricted resolution in the collector). Returns `RawMessage[]`, filtered
 * to rows that actually carry visible text. Ported from quarantine
 * `telegram-hunter/src/renderer.js` `extractionScript`.
 */
export const TG_MESSAGE_SCRIPT = `
  (() => {
    const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    const raw = (e) => ((e && (e.innerText || e.textContent)) || '').trim();
    const text = (e) => clean(raw(e));
    const all = (s) => Array.from(document.querySelectorAll(s));
    const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
    const links = (v) => Array.from(new Set(
      Array.from(String(v).matchAll(/(?:https?:\\/\\/|t\\.me\\/)[^\\s<>]+/gi))
        .map((m) => m[0].replace(/[),.;]+$/, ''))
    ));
    const avatarSrc = (el) => {
      if (!el) return '';
      try {
        if (el.tagName === 'CANVAS') return el.toDataURL('image/png');
      } catch (_e) { return ''; }
      let s = el.currentSrc || el.src || '';
      if (!s) {
        const bg = (getComputedStyle(el).backgroundImage) || '';
        const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
        s = (m && m[1]) || '';
      }
      return s || '';
    };

    const heads = all('h1,h2,h3,[class*="title"],[class*="Title"]').filter(vis).map(text).filter(Boolean);
    const chatTitle = heads.find((h) => h.length < 120 && !/Telegram Web|Search|Settings/i.test(h)) || document.title || 'Telegram chat';

    const nodes = all('[class*="message"],[class*="Message"],[data-message-id]').filter(vis);
    const messages = [];
    for (const e of nodes) {
      const v = text(e);
      if (!v || v.length >= 20000) continue;
      const time = text(e.querySelector('time,[class*="time"],[class*="Time"]'));
      const author = text(e.querySelector('[class*="sender"],[class*="Sender"],[class*="author"],[class*="Author"]'));
      const authorNode = e.querySelector('[class*="sender"],[class*="Sender"],[class*="author"],[class*="Author"]');
      const anchor = (authorNode && authorNode.closest('a')) || e.querySelector('a[href*="t.me/"],a[href*="#@"],a[href*="#"]');
      const href = (anchor && anchor.href) || '';
      const hrefMatch = href.match(/(?:t\\.me\\/|#@?)([a-zA-Z0-9_]{4,32})/);
      let au = (hrefMatch && hrefMatch[1]) || '';
      if (!au) {
        const textMatch = author.match(/@[a-zA-Z0-9_]{4,32}/);
        au = (textMatch ? textMatch[0] : '').replace(/^@/, '');
      }
      const avatarEl = e.querySelector('img[class*="avatar"],img[class*="Avatar"],canvas,[class*="avatar"],[class*="Avatar"],[style*="background-image"]')
        || (e.parentElement && e.parentElement.querySelector('img[class*="avatar"],img[class*="Avatar"],canvas,[class*="avatar"],[class*="Avatar"]'));
      const eventType = /joined|added .* group|left the group|removed|pinned|changed the group|created the group/i.test(v) ? 'SERVICE EVENT' : '';
      const messageId = (e.getAttribute && e.getAttribute('data-message-id')) || '';
      messages.push({
        chat: chatTitle,
        author: author,
        authorUsername: au ? ('@' + au) : '',
        authorProfileUrl: au ? ('https://t.me/' + au) : (/^https?:/i.test(href) ? href : ''),
        timestamp: time,
        text: v,
        links: links(v),
        avatar: avatarSrc(avatarEl),
        eventType: eventType,
        messageId: messageId
      });
    }
    return messages;
  })()
`;

// ---- challenge / lock gate ----------------------------------------------

/** The classified visible state of the Telegram Web capture page. */
export interface TelegramPageState {
  url: string;
  text: string;
  messages: number;
}

/**
 * STATIC page-state probe. No interpolation — the harness never builds a payload from
 * scraped input. Reads only the current URL, a bounded slice of visible body text, and
 * the count of visible message rows. Consumed by the collector's challenge/lock gate.
 */
export const TG_PAGE_STATE_SCRIPT = `(() => ({
  url: location.href,
  text: (document.body && document.body.innerText || '').slice(0, 5000),
  messages: document.querySelectorAll('[class*="message"],[class*="Message"],[data-message-id]').length
}))()`;

const TG_LOCK_RE = /enter your passcode|your cloud password|unlock telegram/i;
const TG_LOGIN_RE = /log in to telegram|scan (?:the|this) qr|qr code to log in|enter your phone number/i;

/**
 * Classify a captured Telegram Web page state (pure). `blocked` marks a page the
 * scrape must STOP on without attempting to bypass: a local passcode lock, or a
 * signed-out / QR-login page. Capture never solves a lock — it refuses.
 */
export function classifyTelegramPageState(page: TelegramPageState): {
  signedIn: boolean;
  locked: boolean;
  blocked: boolean;
  reason?: string;
} {
  const text = String(page?.text || '');
  if (TG_LOCK_RE.test(text)) {
    return {
      signedIn: true,
      locked: true,
      blocked: true,
      reason:
        'Telegram Web is locked (passcode / cloud password). Capture stopped without attempting to bypass it — unlock the session before continuing.',
    };
  }
  if (TG_LOGIN_RE.test(text)) {
    return {
      signedIn: false,
      locked: false,
      blocked: true,
      reason:
        'The Telegram Web session is not signed in. Log in (over Tor) before capturing — nothing was collected.',
    };
  }
  return { signedIn: true, locked: false, blocked: false };
}

// ---- helpers ------------------------------------------------------------

const TELEGRAM_URL_HOSTS = ['t.me', 'web.telegram.org'];

/**
 * Scheme-guard a Telegram profile/permalink: return it only if it is an `https:`
 * `t.me` / `web.telegram.org` URL with no userinfo; otherwise ''. A scraped href can
 * be `javascript:`, `file:`, an off-domain host, or carry `user:pass@` to spoof the
 * displayed host — none of those may ever reach a render or an external opener.
 */
export function guardTelegramUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    return '';
  }
  if (u.protocol !== 'https:') return '';
  if (u.username || u.password) return '';
  return TELEGRAM_URL_HOSTS.includes(u.hostname) ? url : '';
}

/** sha256 hex — the shared HarvestedItem dedup key / a content-keyed surrogate. */
function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * The stable message key. Telegram Web's visible DOM does not always expose a
 * `data-message-id`; when it does not, derive a DETERMINISTIC surrogate from the
 * visible content (chat|timestamp|author|text) — a pure function of what was seen,
 * never a clock read or random. It is a LOCAL dedup key, not fabricated platform data.
 */
function resolveMessageId(raw: RawMessage): string {
  const id = String(raw.messageId ?? '').trim();
  if (id) return id;
  const basis = [raw.chat, raw.timestamp, raw.author, raw.text].map((v) => String(v ?? '')).join('|');
  return `d-${sha256(basis).slice(0, 24)}`;
}

// ---- message normalizer -------------------------------------------------

/**
 * Map one captured raw message → a `TgHarvestedItem`, honesty-stamped and free of any
 * remote media URL. Pure: every id/timestamp is derived from the input or the injected
 * context, never from a clock read here.
 */
export function normalizeMessage(raw: RawMessage, ctx: TgNormalizeContext): TgHarvestedItem {
  const messageId = resolveMessageId(raw);
  const handle = String(raw.authorUsername ?? '').trim(); // already '@handle' or ''
  const authorId = handle.replace(/^@+/, '');
  const avatar = String(raw.avatar ?? '');

  const item: TgHarvestedItem = {
    id: sha256(`telegram:${ctx.channelId}:${messageId}`),
    platform: 'telegram',
    authorHandle: handle,
    authorId,
    text: String(raw.text ?? ''),
    channelId: ctx.channelId,
    channelLabel: ctx.channelLabel,
    messageId,
    publishedAt: String(raw.timestamp ?? ''),
    harvestedAt: ctx.harvestedAt,
    url: guardTelegramUrl(String(raw.authorProfileUrl ?? '')),
    provenance: {
      collectorVersion: ctx.collectorVersion,
      jobId: ctx.jobId,
      caseId: ctx.caseId,
    },
    captureProvenance: 'visible-capture',
    verified: false,
    links: Array.isArray(raw.links) ? raw.links.map((l) => String(l ?? '')).filter(Boolean) : [],
  };

  // HONESTY: the visible display name is stored ONLY when actually shown AND not merely an
  // echo of the @handle (with or without the leading @) — it is NEVER backfilled from the
  // handle. Parity with normalizeProfile/normalizeMember; an unobserved (or echo) display
  // name is absent, not fabricated.
  // Case-FOLDED compare: Telegram handles are case-insensitive, so "johndoe" vs "@JohnDoe"
  // is the SAME identity echoed — a case-sensitive compare would store it as a fabricated
  // display name. Fold both sides.
  const display = String(raw.author ?? '').trim();
  const displayFold = display.toLowerCase();
  if (display && displayFold !== handle.toLowerCase() && displayFold !== authorId.toLowerCase())
    item.authorDisplay = display;

  const profileUrl = guardTelegramUrl(String(raw.authorProfileUrl ?? ''));
  if (profileUrl) item.authorProfileUrl = profileUrl;

  // Avatar admitted ONLY as a local data: thumbnail — a remote URL is DROPPED (beacon guard).
  if (avatar.startsWith('data:')) item.avatar = avatar;

  if (String(raw.eventType ?? '') === 'SERVICE EVENT') item.eventType = 'SERVICE EVENT';

  return item;
}

// ======================================================================
// TG2 — member intelligence (visible group/channel members)
// ======================================================================

/**
 * One raw member row as returned by `TG_MEMBER_SCRIPT` (a visible member UserCell).
 * `avatar` is the image SRC (or an in-page `canvas.toDataURL()`); the collector resolves
 * a remote SRC to a local `data:` thumbnail host-restricted to Telegram hosts before
 * normalization, and `normalizeMember` admits ONLY a `data:` avatar regardless.
 * `displayName` is the visible display name — '' when none was shown (NEVER the @handle).
 */
export interface RawMember {
  /** The visible sender handle as `@handle`, or '' when none was visible. */
  username: string;
  /** The visible display name — '' when none was shown (NEVER the @handle). */
  displayName: string;
  /** The visible phone — '' when not shown to this account (never inferred). */
  phone: string;
  /** The visible status / role line (e.g. "admin · online"), '' when none. */
  status: string;
  /** URLs found verbatim in the visible row text. */
  links: string[];
  /** The chat/group title the member was seen under. */
  context: string;
  /** The visible profile link (`https://t.me/<handle>`) — scheme-guarded on normalize. */
  profileUrl: string;
  /** The avatar SRC (or an in-page `data:`), resolved to a `data:` thumbnail before storage. */
  avatar: string;
}

/**
 * STATIC payload run in the capture page to read the visible member list (a group's
 * participant/subscriber panel or a member popup). No interpolation — the ONLY inputs
 * are literal selectors — and NO in-page media fetch (the source fetched avatar blobs
 * unrestricted; this returns the avatar SRC for host-restricted resolution in the
 * collector). Returns `RawMember[]` for the CURRENTLY-VISIBLE rows only. It NEVER emits
 * a group total (Telegram hides the real member/subscriber count — we do not fabricate
 * one). Ported from quarantine `telegram-hunter/src/renderer.js` `extractionScript`
 * member loop, with the source's `displayName = … || username || 'Telegram member'`
 * fallback REMOVED (an unobserved display name is left '' — honesty).
 */
export const TG_MEMBER_SCRIPT = `
  (() => {
    const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    const raw = (e) => ((e && (e.innerText || e.textContent)) || '').trim();
    const text = (e) => clean(raw(e));
    const all = (s) => Array.from(document.querySelectorAll(s));
    const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
    const links = (v) => Array.from(new Set(
      Array.from(String(v).matchAll(/(?:https?:\\/\\/|t\\.me\\/)[^\\s<>]+/gi))
        .map((m) => m[0].replace(/[),.;]+$/, ''))
    ));
    const avatarSrc = (el) => {
      if (!el) return '';
      try {
        if (el.tagName === 'CANVAS') return el.toDataURL('image/png');
      } catch (_e) { return ''; }
      let s = el.currentSrc || el.src || '';
      if (!s) {
        const bg = (getComputedStyle(el).backgroundImage) || '';
        const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
        s = (m && m[1]) || '';
      }
      return s || '';
    };

    const heads = all('h1,h2,h3,[class*="title"],[class*="Title"]').filter(vis).map(text).filter(Boolean);
    const chatTitle = heads.find((h) => h.length < 120 && !/Telegram Web|Search|Settings/i.test(h)) || document.title || 'Telegram chat';

    // HONESTY: the phone is admitted ONLY from a dedicated phone field — a tel: link, a
    // phone-classed element, or a line that is JUST a phone number. A +number embedded in
    // bio/status prose is NOT a phone (the source scraped the whole row innerText, which
    // mis-attributed any phone-shaped substring); we scope it so we never fabricate one.
    const PHONE_RE = /\\+\\d[\\d ()-]{6,20}\\d/;
    const STANDALONE_PHONE_RE = /^\\+[\\d ()-]{7,22}$/;
    const phoneField = (rootEl, lns) => {
      const el = rootEl && rootEl.querySelector('a[href^="tel:"],[class*="phone"],[class*="Phone"]');
      if (el) { const m = text(el).match(PHONE_RE); if (m) return m[0]; }
      for (const line of (lns || [])) {
        if (STANDALONE_PHONE_RE.test(line)) { const m = line.match(PHONE_RE); if (m) return m[0]; }
      }
      return '';
    };

    const memberRoots = all('[class*="members"],[class*="Members"],[class*="participants"],[class*="Participants"],[class*="subscribers"],[class*="Subscribers"],[role="dialog"],[class*="popup"],[class*="Popup"]')
      .filter(vis)
      .filter((e) => { const t = text(e), r = e.getBoundingClientRect(); return t.length > 0 && t.length < 12000 && r.width > 220; });

    const rowSet = new Set();
    for (const root of memberRoots) {
      for (const e of root.querySelectorAll('[class*="ListItem"],[class*="list-item"],[role="listitem"],[class*="participant"],[class*="Participant"],[class*="member"],[class*="Member"]')) {
        if (vis(e)) rowSet.add(e);
      }
    }

    const members = [];
    for (const e of rowSet) {
      const multi = raw(e);
      const v = clean(multi);
      if (v.length < 2 || v.length > 260) continue;
      if (links(v).length > 3) continue;
      const lines = multi.split(/\\n+/).map(clean).filter(Boolean);
      const username = (v.match(/@[a-zA-Z0-9_]{4,32}/) || [])[0] || '';
      const phone = phoneField(e, lines);
      const status = (lines.slice(1).join(' · ')).slice(0, 180);
      if (!(username || phone || /online|last seen|subscriber|member|bot|admin|owner/i.test(v))) continue;
      if (/someone just got access|new login|source:\\s*https?:\\/\\//i.test(v)) continue;
      const displayName = (lines.find((x) => x.length < 100 && !/^@/.test(x) && !/^online$|^last seen/i.test(x))) || '';
      const bare = username.replace(/^@/, '');
      const avatarEl = e.querySelector('img[class*="avatar"],img[class*="Avatar"],canvas,[class*="avatar"],[class*="Avatar"],[style*="background-image"]');
      members.push({
        username: username,
        displayName: displayName,
        phone: phone,
        status: status,
        links: links(v).slice(0, 10),
        context: chatTitle,
        profileUrl: bare ? ('https://t.me/' + bare) : '',
        avatar: avatarSrc(avatarEl)
      });
    }
    return members;
  })()
`;

// ======================================================================
// TG3 — visible profile fields (honesty-critical)
// ======================================================================

/**
 * One raw profile panel as returned by `TG_PROFILE_SCRIPT` (a right-column / user-info
 * panel or a profile dialog). `avatar` is the image SRC (or an in-page
 * `canvas.toDataURL()`); the collector resolves a remote SRC to a local `data:`
 * thumbnail host-restricted to Telegram hosts before normalization, and
 * `normalizeProfile` admits ONLY a `data:` avatar regardless. `displayName` is the
 * visible display name — '' when none was shown (NEVER the @handle, and NEVER a page
 * heading: the source's `||heads[0]` fallback is dropped in the port).
 */
export interface RawProfile {
  /** The visible display name — '' when none was shown (NEVER the @handle). */
  displayName: string;
  /** The visible handle as `@handle`, or '' when none was visible. */
  username: string;
  /** The visible phone — '' when not shown to this account (never inferred). */
  phone: string;
  /** The visible bio / panel text (verbatim, bounded). */
  bio: string;
  /** The visible status line (e.g. "last seen recently", "online"), '' when none. */
  status: string;
  /** URLs found verbatim in the visible panel text. */
  links: string[];
  /** The chat/section title the panel was seen under. */
  context: string;
  /** The visible profile link (`https://t.me/<handle>`) — scheme-guarded on normalize. */
  profileUrl: string;
  /** The avatar SRC (or an in-page `data:`), resolved to a `data:` thumbnail before storage. */
  avatar: string;
}

/**
 * A captured Telegram profile, honest by construction:
 *
 *  - `displayName` is stored ONLY when shown AND not a mere echo of the @handle — it is
 *    NEVER backfilled from the handle or a page heading (an unobserved name is absent);
 *  - `phone` is stored ONLY when it was visible to the logged-in account;
 *  - `accountCreationDate` is ALWAYS `null` and `accountCreationLabel` is a FIXED
 *    unavailable string — Telegram Web does not expose a reliable creation date and this
 *    module NEVER infers one (from a first-message timestamp, an id, or anything else);
 *  - `avatar`, when present, is a local `data:` thumbnail — never a remote URL;
 *  - `profileUrl`, when present, is a Telegram-host-guarded permalink.
 * A missing bio/status/context is OMITTED here — the "Not visible" label is a render-time
 * concern, never fabricated into storage.
 */
export interface TgProfile {
  handle: string;
  displayName?: string;
  phone?: string;
  bio?: string;
  status?: string;
  context?: string;
  links: string[];
  avatar?: string;
  profileUrl?: string;
  /** ALWAYS null — Telegram Web does not expose a reliable account creation date. */
  accountCreationDate: null;
  /** The fixed honesty label shown wherever a creation date would appear. */
  accountCreationLabel: string;
  /** ISO timestamp supplied by the caller (injected clock) — never computed here. */
  capturedAt: string;
}

/**
 * The FIXED label recorded in place of an account-creation date. Telegram Web does not
 * expose one; it is never inferred. This constant is the single source of that truth.
 */
export const TG_ACCOUNT_CREATION_LABEL = 'Unavailable — Telegram does not expose it';

/**
 * STATIC payload run in the capture page to read the visible profile panel (a
 * right-column / user-info panel or a profile dialog). No interpolation — the ONLY
 * inputs are literal selectors — and NO in-page media fetch (the source fetched the
 * avatar blob unrestricted; this returns the avatar SRC for host-restricted resolution
 * in the collector). Returns a single `RawProfile` or `null` when no user panel is
 * visible. Ported from quarantine `telegram-hunter/src/renderer.js` `extractionScript`
 * profile block, with the source's `displayName = … || heads[0] || ''` heading fallback
 * REMOVED (an unobserved display name is left '' — honesty).
 */
export const TG_PROFILE_SCRIPT = `
  (() => {
    const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    const raw = (e) => ((e && (e.innerText || e.textContent)) || '').trim();
    const text = (e) => clean(raw(e));
    const all = (s) => Array.from(document.querySelectorAll(s));
    const vis = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
    const links = (v) => Array.from(new Set(
      Array.from(String(v).matchAll(/(?:https?:\\/\\/|t\\.me\\/)[^\\s<>]+/gi))
        .map((m) => m[0].replace(/[),.;]+$/, ''))
    ));
    const avatarSrc = (el) => {
      if (!el) return '';
      try {
        if (el.tagName === 'CANVAS') return el.toDataURL('image/png');
      } catch (_e) { return ''; }
      let s = el.currentSrc || el.src || '';
      if (!s) {
        const bg = (getComputedStyle(el).backgroundImage) || '';
        const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
        s = (m && m[1]) || '';
      }
      return s || '';
    };

    const heads = all('h1,h2,h3,[class*="title"],[class*="Title"]').filter(vis).map(text).filter(Boolean);
    const chatTitle = heads.find((h) => h.length < 120 && !/Telegram Web|Search|Settings/i.test(h)) || '';

    // HONESTY: the phone is admitted ONLY from a dedicated phone field — a tel: link, a
    // phone-classed element, or a line that is JUST a phone number. A +number embedded in
    // the bio prose is NOT a phone (the source scraped the whole panel innerText, which
    // mis-attributed any phone-shaped substring); we scope it so we never fabricate one.
    const PHONE_RE = /\\+\\d[\\d ()-]{6,20}\\d/;
    const STANDALONE_PHONE_RE = /^\\+[\\d ()-]{7,22}$/;
    const phoneField = (rootEl, lns) => {
      const el = rootEl && rootEl.querySelector('a[href^="tel:"],[class*="phone"],[class*="Phone"]');
      if (el) { const m = text(el).match(PHONE_RE); if (m) return m[0]; }
      for (const line of (lns || [])) {
        if (STANDALONE_PHONE_RE.test(line)) { const m = line.match(PHONE_RE); if (m) return m[0]; }
      }
      return '';
    };

    const visiblePanels = all('[class*="profile"],[class*="Profile"],[class*="user-info"],[class*="UserInfo"],[class*="right-column"],[class*="RightColumn"],[class*="sidebar-right"],[class*="SidebarRight"],[role="dialog"]')
      .filter(vis)
      .filter((e) => { const t = text(e); const r = e.getBoundingClientRect(); return t.length > 2 && t.length < 4000 && r.width > 180 && r.width < 850; });

    const panel = visiblePanels.sort((a, b) => {
      const au = /@\\w{4,32}/.test(text(a)) ? 2 : 0;
      const bu = /@\\w{4,32}/.test(text(b)) ? 2 : 0;
      return (bu + Math.min(text(b).length, 800) / 800) - (au + Math.min(text(a).length, 800) / 800);
    })[0] || null;
    if (!panel) return null;

    const pt = text(panel);
    const panelLines = raw(panel).split(/\\n+/).map(clean).filter(Boolean);
    const panelUser = (pt.match(/@[a-zA-Z0-9_]{4,32}/) || [])[0] || '';
    const panelPhone = phoneField(panel, panelLines);
    if (!(panelUser || panelPhone || /bio|username|phone|last seen|online/i.test(pt))) return null;

    // HONESTY: display name = the first non-@handle panel line; NO heads[0] fallback.
    const displayName = panelLines.find((v) => v && v.length < 100 && !/^@/.test(v)) || '';
    const status = panelLines.find((v) => /online|last seen|bot|subscriber|member|admin|owner/i.test(v)) || '';
    const panelImg = panel.querySelector('img[class*="avatar"],img[class*="Avatar"],canvas,[class*="avatar"],[class*="Avatar"],[style*="background-image"]');

    return {
      displayName: displayName,
      username: panelUser,
      phone: panelPhone,
      bio: pt.slice(0, 1200),
      status: status,
      links: links(pt).slice(0, 20),
      context: chatTitle,
      profileUrl: panelUser ? ('https://t.me/' + panelUser.replace(/^@/, '')) : '',
      avatar: avatarSrc(panelImg)
    };
  })()
`;

/**
 * Map one captured raw profile panel → a `TgProfile`, honesty-stamped and free of any
 * remote media URL. Pure: the only clock is the injected `ctx.capturedAt`.
 *
 *  - the visible display name is stored ONLY when shown AND not a mere echo of the
 *    @handle — it is NEVER backfilled (the source's heading/handle fallbacks, refused);
 *  - the phone is stored ONLY when it was visible to the logged-in account;
 *  - the account-creation date is ALWAYS `null` with a FIXED unavailable label — never inferred;
 *  - the avatar is admitted ONLY as a local `data:` thumbnail (a remote URL is dropped);
 *  - the profile permalink is scheme-guarded to Telegram hosts;
 *  - a missing bio/status/context is OMITTED ("Not visible" is a render concern).
 */
export function normalizeProfile(raw: RawProfile, ctx: { capturedAt: string }): TgProfile {
  const handle = String(raw.username ?? '').trim(); // already '@handle' or ''

  const profile: TgProfile = {
    handle,
    links: Array.isArray(raw.links) ? raw.links.map((l) => String(l ?? '')).filter(Boolean) : [],
    // HONESTY: Telegram Web does not expose a reliable account creation date. It is
    // recorded as null with a FIXED label and is NEVER inferred from a first-message
    // timestamp, a numeric id, or any scraped hint.
    accountCreationDate: null,
    accountCreationLabel: TG_ACCOUNT_CREATION_LABEL,
    capturedAt: ctx.capturedAt,
  };

  // HONESTY: display name stored ONLY when shown AND not merely an echo of the @handle.
  // Case-FOLDED: handles are case-insensitive, so "alice" vs "@Alice" is the same echo.
  const display = String(raw.displayName ?? '').trim();
  const bareHandle = handle.replace(/^@+/, '');
  const displayFold = display.toLowerCase();
  if (display && displayFold !== handle.toLowerCase() && displayFold !== bareHandle.toLowerCase())
    profile.displayName = display;

  const phone = String(raw.phone ?? '').trim();
  if (phone) profile.phone = phone;

  const bio = String(raw.bio ?? '').trim();
  if (bio) profile.bio = bio;

  const status = String(raw.status ?? '').trim();
  if (status) profile.status = status;

  const context = String(raw.context ?? '').trim();
  if (context) profile.context = context;

  // Avatar admitted ONLY as a local data: thumbnail — a remote URL is DROPPED (beacon guard).
  const avatar = String(raw.avatar ?? '');
  if (avatar.startsWith('data:')) profile.avatar = avatar;

  const profileUrl = guardTelegramUrl(String(raw.profileUrl ?? ''));
  if (profileUrl) profile.profileUrl = profileUrl;

  return profile;
}

/**
 * Map one captured raw member → a `TgMember`, honesty-stamped and free of any remote
 * media URL. Pure: the only clock is the injected `ctx.capturedAt`.
 *
 *  - the visible display name is stored ONLY when shown AND not a mere echo of the
 *    @handle — it is NEVER backfilled from the handle (the source's fallback, refused);
 *  - the phone is stored ONLY when it was visible to the logged-in account;
 *  - the avatar is admitted ONLY as a local `data:` thumbnail (a remote URL is dropped);
 *  - the profile permalink is scheme-guarded to Telegram hosts.
 */
export function normalizeMember(raw: RawMember, ctx: { capturedAt: string }): TgMember {
  const handle = String(raw.username ?? '').trim(); // already '@handle' or ''
  const member: TgMember = { handle, capturedAt: ctx.capturedAt };

  // HONESTY: display name stored ONLY when shown AND not merely an echo of the @handle.
  // Case-FOLDED: handles are case-insensitive, so "alice" vs "@Alice" is the same echo.
  const display = String(raw.displayName ?? '').trim();
  const bareHandle = handle.replace(/^@+/, '');
  const displayFold = display.toLowerCase();
  if (display && displayFold !== handle.toLowerCase() && displayFold !== bareHandle.toLowerCase())
    member.displayName = display;

  const phone = String(raw.phone ?? '').trim();
  if (phone) member.phone = phone;

  const status = String(raw.status ?? '').trim();
  if (status) member.status = status;

  const context = String(raw.context ?? '').trim();
  if (context) member.context = context;

  // Avatar admitted ONLY as a local data: thumbnail — a remote URL is DROPPED (beacon guard).
  const avatar = String(raw.avatar ?? '');
  if (avatar.startsWith('data:')) member.avatar = avatar;

  const profileUrl = guardTelegramUrl(String(raw.profileUrl ?? ''));
  if (profileUrl) member.profileUrl = profileUrl;

  return member;
}
