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

  // HONESTY: the visible display name is stored ONLY when actually shown. It is NEVER
  // backfilled from the @handle — an unobserved display name is absent, not fabricated.
  const display = String(raw.author ?? '').trim();
  if (display) item.authorDisplay = display;

  const profileUrl = guardTelegramUrl(String(raw.authorProfileUrl ?? ''));
  if (profileUrl) item.authorProfileUrl = profileUrl;

  // Avatar admitted ONLY as a local data: thumbnail — a remote URL is DROPPED (beacon guard).
  if (avatar.startsWith('data:')) item.avatar = avatar;

  if (String(raw.eventType ?? '') === 'SERVICE EVENT') item.eventType = 'SERVICE EVENT';

  return item;
}
