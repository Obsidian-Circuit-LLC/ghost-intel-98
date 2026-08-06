/**
 * X Listening Station — visible-post extraction + normalization (Plan A, Task X3).
 *
 * Two halves, both PURE and quarantine-clean (this module imports only `node:crypto`
 * and the shared `HarvestedItem` TYPE — no electron, no bgconn/Tor/socmint/telegram):
 *
 *  1. `X_POST_SCRIPT` — the STATIC in-page payload the capture window runs via
 *     `executeJavaScript`. Ported verbatim-in-intent from quarantine
 *     `electron/main.cjs:382-422` (`readVisibleTimelineItems`). It contains NO
 *     `${…}` interpolation: nothing scraped is ever spliced into executed code.
 *     It reads ONLY the visible tweet-article DOM.
 *
 *  2. `parseMetricText` + `normalizePost` — pure normalizers turning one captured
 *     raw post into a `HarvestedItem`, honest by construction:
 *       - Rounded engagement metrics ("1.2K") are stored VERBATIM with
 *         `approx:true` and a best-effort numeric expansion — never a bare
 *         false-precision integer (fixes the review's false-precision finding).
 *         Ported from `parseMetricText` at `main.cjs:371-379`, which returned only
 *         the rounded integer and dropped the honesty flag.
 *       - Media is admitted only as local `data:` thumbnails; any remote
 *         `http(s)` URL is DROPPED, never stored (fixes the beacon finding — a
 *         stored remote URL must never reach an `<img src>`). Resolution to
 *         `data:` happens in the capture orchestration (via
 *         `remoteMediaToDataUri`) BEFORE normalization; this function is the
 *         defense-in-depth filter.
 *       - Post text is preserved VERBATIM. Escaping is a render/export concern
 *         handled by `escapeField` at emit time, not baked into storage.
 *     Every item is stamped `verified:false` + `captureProvenance:'visible-capture'`.
 */
import { createHash } from 'node:crypto';
import type { HarvestedItem } from '@shared/socmint/types';

// ---- captured-DOM raw shape --------------------------------------------

/**
 * One raw post as returned by `X_POST_SCRIPT` (visible tweet article). `media`
 * entries are the remote `pbs.twimg.com` image `src`s at capture time; the
 * orchestration resolves them to `data:` thumbnails before normalization, and
 * `normalizePost` filters to `data:`-only regardless.
 */
export interface RawPost {
  /** The tweet status id (from the visible permalink). */
  id: string;
  /** The visible author handle (no leading `@`). */
  username: string;
  /** The visible permalink; scheme-guarded during normalization. */
  url: string;
  /** The visible tweet body text (verbatim). */
  text: string;
  /** The `time[datetime]` ISO string, or '' when not visible. */
  createdAt: string;
  isReply: boolean;
  isRepost: boolean;
  socialContext: string;
  /** Rounded engagement strings exactly as X rendered them. */
  metricsRaw: {
    replies: string;
    reposts: string;
    likes: string;
    views: string;
  };
  /** Media image sources — resolved to `data:` thumbnails before storage. */
  media: string[];
}

// ---- normalized output --------------------------------------------------

/** One engagement metric: verbatim display token + best-effort value + honesty flag. */
export interface XMetric {
  /** The rounded display token exactly as X rendered it, e.g. `"1.2K"` — verbatim. */
  raw: string;
  /** Best-effort numeric expansion; honest ONLY when paired with `approx`. */
  value: number;
  /** True when the source was a rounded display (K/M/B) — never claim false precision. */
  approx: boolean;
}

export interface XPostMetrics {
  replies: XMetric;
  reposts: XMetric;
  likes: XMetric;
  views: XMetric;
}

/**
 * A captured X post. Extends the shared `HarvestedItem` (so it round-trips through
 * `xStore.saveItems`) with X-specific, honesty-critical fields:
 *
 *  - `verified` is always `false` — visible-DOM capture never verifies content.
 *  - `captureProvenance` is always `'visible-capture'` — the honesty stamp the
 *    spec calls "provenance:'visible-capture'". (The base `HarvestedItem.provenance`
 *    is a structured object carrying collector/job/case ids and is kept as-is; this
 *    separate marker records the CAPTURE METHOD without overloading that object.)
 *  - `metrics` are rounded-display-safe (`{raw,value,approx}` per field).
 *  - `media` are local `data:` thumbnails only — never a remote URL.
 */
export interface XHarvestedItem extends HarvestedItem {
  captureProvenance: 'visible-capture';
  verified: false;
  metrics: XPostMetrics;
  media: string[];
  /** X3 emits `'post'`; replies/reposts/comments are tagged in X4. */
  kind: 'post';
}

/** Context the pure normalizer needs but cannot observe from a single post. */
export interface NormalizeContext {
  caseId: string;
  jobId: string;
  collectorVersion: string;
  /** ISO timestamp — injected clock. NEVER computed here (determinism floor). */
  harvestedAt: string;
  /** The profile/timeline being observed — the `HarvestedItem` "channel". */
  channelId: string;
  channelLabel: string;
}

// ---- static in-page payload (port of main.cjs:382-422) ------------------

/**
 * STATIC payload run in the capture page to read the visible timeline. No
 * interpolation — the ONLY inputs are literal selectors. Returns `RawPost[]`.
 * Filtered in-page to posts that actually have an id, url, and text.
 */
export const X_POST_SCRIPT = `
  (() => {
    const metric = (article, testId) => {
      const node = article.querySelector('[data-testid="' + testId + '"]');
      if (!node) return '';
      return node.getAttribute('aria-label') || node.textContent || '';
    };

    return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map((article) => {
      const time = article.querySelector('time');
      const timeLink = time && time.closest('a[href*="/status/"]');
      const statusLink = timeLink || Array.from(article.querySelectorAll('a[href*="/status/"]'))[0];
      const rawHref = (statusLink && statusLink.getAttribute('href')) || '';
      const match = rawHref.match(/^\\/([^/]+)\\/status\\/(\\d+)/);
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      const fullText = article.innerText || '';
      const socialContext = (article.querySelector('[data-testid="socialContext"]') || {}).textContent || '';
      const images = Array.from(article.querySelectorAll('img[src*="pbs.twimg.com/media"]'))
        .map((image) => image.getAttribute('src'))
        .filter(Boolean);

      return {
        id: (match && match[2]) || '',
        username: (match && match[1]) || '',
        url: rawHref ? new URL(rawHref, location.origin).href : '',
        text: ((tweetText && tweetText.innerText) || '').trim(),
        createdAt: (time && time.getAttribute('datetime')) || '',
        isReply: /Replying to/i.test(fullText),
        isRepost: /reposted/i.test(socialContext),
        socialContext: String(socialContext).trim(),
        metricsRaw: {
          replies: metric(article, 'reply'),
          reposts: metric(article, 'retweet'),
          likes: metric(article, 'like'),
          views: metric(article, 'analytics')
        },
        media: Array.from(new Set(images))
      };
    }).filter((item) => item.id && item.url && item.text);
  })()
`;

// ---- metric normalization (port + honesty fix of main.cjs:371-379) ------

const MULTIPLIER: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
const METRIC_RE = /([\d.,]+)\s*([KMB])?/i;

/**
 * Parse a rounded engagement display string into `{raw, value, approx}`.
 *
 * `raw` is the verbatim matched token (`"1.2K"`, `"1,234"`) — what X actually
 * showed. `value` is a best-effort numeric expansion (commas stripped, K/M/B
 * applied). `approx` is true iff a K/M/B suffix was present, i.e. the number was
 * a rounded display and must NOT be treated as exact. An unparseable/empty input
 * is a zeroed, non-approx cell (an honest "no signal", never a guess).
 */
export function parseMetricText(value: string): XMetric {
  const text = String(value ?? '').trim();
  const match = text.match(METRIC_RE);
  if (!match) return { raw: '', value: 0, approx: false };

  const raw = String(match[0]).trim();
  const suffix = String(match[1] ? match[2] || '' : '').toUpperCase();
  const number = Number(String(match[1]).replace(/,/g, ''));
  if (!Number.isFinite(number)) return { raw, value: 0, approx: false };

  const approx = suffix in MULTIPLIER;
  const multiplier = MULTIPLIER[suffix] ?? 1;
  return { raw, value: Math.round(number * multiplier), approx };
}

// ---- helpers ------------------------------------------------------------

/** sha256 hex of `x:${channelId}:${messageId}` — the shared HarvestedItem dedup key. */
function xItemId(channelId: string, messageId: string): string {
  return createHash('sha256').update(`x:${channelId}:${messageId}`, 'utf8').digest('hex');
}

/** Keep only local `data:` thumbnails — a remote URL must NEVER be stored. */
function dataUrisOnly(media: readonly string[] | undefined): string[] {
  if (!Array.isArray(media)) return [];
  return media.map((m) => String(m ?? '')).filter((m) => m.startsWith('data:'));
}

/**
 * Scheme-guard an X permalink: return it only if it is an `https:` x.com /
 * twitter.com URL with no userinfo; otherwise ''. Inlined (not imported from the
 * socmint namespace) to keep the clearnet-quarantine import graph clean.
 */
function guardXPermalink(url: string): string {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    if (u.hostname === 'x.com' || u.hostname === 'twitter.com') return url;
    return '';
  } catch {
    return '';
  }
}

// ---- post normalizer ----------------------------------------------------

/**
 * Map one captured raw post → an `XHarvestedItem`, stamped for honesty and free
 * of any remote media URL. Pure: every timestamp/id is derived from the input or
 * the injected context, never from a clock read here.
 */
export function normalizePost(raw: RawPost, ctx: NormalizeContext): XHarvestedItem {
  const messageId = String(raw.id ?? '');
  const username = String(raw.username ?? '').replace(/^@+/, '');
  const media = dataUrisOnly(raw.media);

  return {
    id: xItemId(ctx.channelId, messageId),
    platform: 'x',
    authorHandle: username ? `@${username}` : '',
    // The numeric account id is not visible in the timeline DOM; the handle is the
    // only stable identifier we actually saw — recorded as-is (no fabricated id).
    authorId: username,
    text: String(raw.text ?? ''),
    mediaType: media.length ? 'image' : undefined,
    mediaRef: media[0],
    channelId: ctx.channelId,
    channelLabel: ctx.channelLabel,
    messageId,
    publishedAt: String(raw.createdAt ?? ''),
    harvestedAt: ctx.harvestedAt,
    url: guardXPermalink(raw.url),
    provenance: {
      collectorVersion: ctx.collectorVersion,
      jobId: ctx.jobId,
      caseId: ctx.caseId,
    },
    captureProvenance: 'visible-capture',
    verified: false,
    metrics: {
      replies: parseMetricText(raw.metricsRaw?.replies ?? ''),
      reposts: parseMetricText(raw.metricsRaw?.reposts ?? ''),
      likes: parseMetricText(raw.metricsRaw?.likes ?? ''),
      views: parseMetricText(raw.metricsRaw?.views ?? ''),
    },
    media,
    kind: 'post',
  };
}
