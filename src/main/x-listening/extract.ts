/**
 * X Listening Station — visible-post extraction + normalization (Plan A, Task X3).
 *
 * PURE and quarantine-clean: this module imports only `node:crypto`, the shared
 * `HarvestedItem` TYPE, the network artifact TYPES from `./store` (type-only, erased
 * at runtime), and `csvCell` from the sibling `../capture/security` (itself
 * node:path-only) — no electron, no bgconn/Tor/socmint/telegram:
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
import { csvCell } from '../capture/security';
import type { XNetworkAccount, XNetworkArtifact } from './store';

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
/**
 * What the captured item is, relative to the profile timeline being observed:
 *  - `post`    — the target's own top-level tweet.
 *  - `reply`   — the target's own reply to another account.
 *  - `repost`  — a DIFFERENT account's tweet the target reposted (the original
 *                author is recorded honestly; it is filed under the target's channel).
 *  - `comment` — a THIRD PARTY's reply seen under one of the target's posts.
 */
export type XItemKind = 'post' | 'reply' | 'repost' | 'comment';

/** The three surrounding-thread collect toggles (mirror of `AppSettings.xListening.collect`). */
export interface XCollectSettings {
  replies: boolean;
  reposts: boolean;
  comments: boolean;
}

export interface XHarvestedItem extends HarvestedItem {
  captureProvenance: 'visible-capture';
  verified: false;
  metrics: XPostMetrics;
  media: string[];
  /** post / reply / repost / comment — see `XItemKind`. */
  kind: XItemKind;
  /** For a `comment`: the target root-post id whose thread it was seen under. Honest
   *  lineage only — never a fabricated "in reply to". Absent for every other kind. */
  parentId?: string;
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
export function guardXPermalink(url: string): string {
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
 * Map one captured raw item → an `XHarvestedItem` tagged with `kind`, stamped for
 * honesty and free of any remote media URL. Pure: every timestamp/id is derived
 * from the input or the injected context, never from a clock read here. `parentId`
 * is admitted only for a `comment` (the target root post it appeared under).
 */
function normalizeItem(
  raw: RawPost,
  ctx: NormalizeContext,
  kind: XItemKind,
  parentId?: string,
): XHarvestedItem {
  const messageId = String(raw.id ?? '');
  const username = String(raw.username ?? '').replace(/^@+/, '');
  const media = dataUrisOnly(raw.media);

  const item: XHarvestedItem = {
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
    kind,
  };
  // Only a comment carries a parent — never fabricate lineage for other kinds.
  if (kind === 'comment' && parentId != null && parentId !== '') {
    item.parentId = String(parentId);
  }
  return item;
}

/** The target's own top-level post → an `XHarvestedItem` (`kind:'post'`). */
export function normalizePost(raw: RawPost, ctx: NormalizeContext): XHarvestedItem {
  return normalizeItem(raw, ctx, 'post');
}

/** The target's own reply → an `XHarvestedItem` (`kind:'reply'`). */
export function normalizeReply(raw: RawPost, ctx: NormalizeContext): XHarvestedItem {
  return normalizeItem(raw, ctx, 'reply');
}

/**
 * A different account's tweet the target reposted → an `XHarvestedItem`
 * (`kind:'repost'`). The original author is recorded honestly (from `raw.username`);
 * the item is still filed under the observed target's channel.
 */
export function normalizeRepost(raw: RawPost, ctx: NormalizeContext): XHarvestedItem {
  return normalizeItem(raw, ctx, 'repost');
}

/**
 * A third party's reply seen under one of the target's posts → an `XHarvestedItem`
 * (`kind:'comment'`), linked to the target root post via `parentId`.
 */
export function normalizeComment(
  raw: RawPost,
  ctx: NormalizeContext,
  parentId: string,
): XHarvestedItem {
  return normalizeItem(raw, ctx, 'comment', parentId);
}

// ---- collect gate (port of main.cjs:551-570 / :472-500) -----------------

/** Case-insensitive handle equality, tolerant of a leading `@`. */
function handleEq(a: string, b: string): boolean {
  return (
    String(a ?? '').replace(/^@+/, '').toLowerCase() ===
    String(b ?? '').replace(/^@+/, '').toLowerCase()
  );
}

/**
 * The profile-timeline capture gate (pure). Given the visible timeline items, the
 * observed target handle, and the collect toggles, decide what to capture and how
 * to tag it — a port of the `scrapeProfile` classification loop
 * (`main.cjs:551-570`):
 *
 *  - a target top-level post is ALWAYS captured (`post`);
 *  - a target reply only when `collect.replies` (`reply`);
 *  - a someone-else repost only when `collect.reposts` (`repost`);
 *  - a non-target, non-repost item is dropped — it is not the target's speech.
 *
 * Comments are NOT sourced here (they live in a post's thread) — see
 * `selectThreadComments`.
 */
export function selectTimelineCaptures(
  raws: readonly RawPost[] | undefined,
  targetUsername: string,
  collect: XCollectSettings,
): Array<{ raw: RawPost; kind: Exclude<XItemKind, 'comment'> }> {
  const out: Array<{ raw: RawPost; kind: Exclude<XItemKind, 'comment'> }> = [];
  for (const raw of raws ?? []) {
    const authorMatches = handleEq(raw.username, targetUsername);
    if (raw.isRepost && !authorMatches) {
      if (collect.reposts) out.push({ raw, kind: 'repost' });
      continue;
    }
    if (!authorMatches) continue;
    if (raw.isReply) {
      if (collect.replies) out.push({ raw, kind: 'reply' });
    } else {
      out.push({ raw, kind: 'post' });
    }
  }
  return out;
}

/**
 * The third-party-comment gate (pure). Given the items visible in one root post's
 * thread, the observed target handle, and the root post id, return the THIRD PARTY
 * replies — a port of `scrapeCommentsForPosts` (`main.cjs:490-499`):
 *
 *  - empty unless `collect.comments` is on;
 *  - the root post itself is excluded (it is the target's own post);
 *  - the target's OWN replies are excluded (captured on the timeline as `reply`,
 *    not as "comments");
 *  - duplicates (same status id) are collapsed.
 *
 * The caller normalizes each survivor with `normalizeComment(raw, ctx, rootPostId)`.
 */
export function selectThreadComments(
  threadRaws: readonly RawPost[] | undefined,
  targetUsername: string,
  rootPostId: string,
  collect: XCollectSettings,
): RawPost[] {
  if (!collect.comments) return [];
  const out: RawPost[] = [];
  const seen = new Set<string>();
  for (const raw of threadRaws ?? []) {
    const id = String(raw.id ?? '');
    if (!id || id === String(rootPostId)) continue;
    if (handleEq(raw.username, targetUsername)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(raw);
  }
  return out;
}

// ---- X5: follower / following network extraction ------------------------

/**
 * One raw `UserCell` as returned by `USER_CELL_SCRIPT`. `avatar` is the remote
 * `profile_images` `src` at capture time; the orchestration resolves it to a
 * `data:` thumbnail before normalization, and `normalizeUserCell` admits ONLY a
 * `data:` avatar regardless (defense in depth — no remote media inlining).
 */
export interface RawUserCell {
  /** The visible account handle (no leading `@`, or tolerated with one). */
  username: string;
  /** The visible display name. */
  displayName: string;
  /** The visible bio line(s), joined — may be ''. */
  bio: string;
  /** The visible profile permalink. */
  url: string;
  /** The avatar image `src` — resolved to a `data:` thumbnail before storage. */
  avatar: string;
}

/** A visible X handle: 1–15 of `[A-Za-z0-9_]`. Anything else is not a real account. */
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * STATIC in-page payload reading the visible follower/following `UserCell` rows.
 * No interpolation — the ONLY inputs are literal selectors. Returns `RawUserCell[]`,
 * filtered to cells that actually expose a handle and a profile link. Port of
 * quarantine `readVisibleUserCells` (`electron/main.cjs:982-1011`).
 */
export const USER_CELL_SCRIPT = `
  (() => {
    const scope = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main') || document;
    return Array.from(scope.querySelectorAll('[data-testid="UserCell"]')).map((cell) => {
      const rawText = cell.innerText || '';
      const lines = rawText.split(/\\n+/).map((line) => line.trim()).filter(Boolean);
      const links = Array.from(cell.querySelectorAll('a[href^="/"]'))
        .map((link) => link.getAttribute('href') || '')
        .filter(Boolean);
      const profileHref = links.find((href) => /^\\/[A-Za-z0-9_]{1,15}$/.test(href)) || '';
      const hrefMatch = profileHref.match(/^\\/([A-Za-z0-9_]{1,15})$/);
      const textMatch = rawText.match(/(?:^|\\s)@([A-Za-z0-9_]{1,15})(?:\\b|$)/);
      const username = (hrefMatch && hrefMatch[1]) || (textMatch && textMatch[1]) || '';
      // HONESTY: when NO display-name line is visible, leave it '' — never fall back to
      // the @handle. An unobserved display name must be recorded as absent, not fabricated
      // from the handle (which would present a value the module never actually saw).
      const displayName = lines.find((line) => !line.startsWith('@') && !/^(Follow|Following|Follows you|Verified)$/i.test(line)) || '';
      const ignored = new Set([displayName, '@' + username, 'Follow', 'Following', 'Follows you', 'Verified']);
      const bio = lines.filter((line) => !ignored.has(line)).join(' ').trim();
      const avatar = (cell.querySelector('img[src*="profile_images"]') || {}).getAttribute
        ? (cell.querySelector('img[src*="profile_images"]').getAttribute('src') || '')
        : '';
      return {
        username: username,
        displayName: displayName,
        bio: bio,
        url: profileHref ? new URL(profileHref, location.origin).href : '',
        avatar: avatar
      };
    }).filter((item) => item.username && item.url);
  })()
`;

/**
 * Map one captured `UserCell` → an `XNetworkAccount`, or `null` when the handle is
 * not a real X username (never fabricate a row). The avatar is admitted ONLY as a
 * local `data:` thumbnail — a remote `profile_images` URL is DROPPED (no remote
 * media inlining). An empty bio is omitted rather than stored as ''.
 *
 * HONESTY: a display name that was not visible is OMITTED — it is NEVER silently
 * backfilled from the @handle. Presenting the handle as the display name would pass
 * off an unobserved value as captured; the renderer surfaces the absent field as
 * "Not visible" instead.
 */
export function normalizeUserCell(raw: RawUserCell): XNetworkAccount | null {
  const username = String(raw?.username ?? '').replace(/^@+/, '');
  if (!USERNAME_RE.test(username)) return null;
  const account: XNetworkAccount = {
    handle: `@${username}`,
  };
  const displayName = String(raw?.displayName ?? '').trim();
  if (displayName) account.displayName = displayName;
  const bio = String(raw?.bio ?? '').trim();
  if (bio) account.bio = bio;
  const avatar = String(raw?.avatar ?? '');
  if (avatar.startsWith('data:')) account.avatar = avatar;
  return account;
}

/**
 * Turn the captured `UserCell` rows into an `XNetworkArtifact`: the ACTUAL visible
 * accounts, deduped case-insensitively by handle, invalid handles dropped. HONESTY:
 * the artifact records the accounts the module SAW — it never carries a scraped
 * follower/following count-number (the count is `accounts.length`, nothing more).
 * `capturedAt` is the caller's injected clock. Port + honesty-fix of quarantine
 * `ingestRelationships` (`electron/main.cjs:1013-1044`), which mutated shared
 * app-state and sorted; here it is a pure function returning a fresh artifact.
 */
export function normalizeNetwork(
  rows: readonly RawUserCell[] | undefined,
  target: string,
  kind: 'followers' | 'following',
  capturedAt: string,
): XNetworkArtifact {
  const seen = new Set<string>();
  const accounts: XNetworkAccount[] = [];
  for (const raw of rows ?? []) {
    const account = normalizeUserCell(raw);
    if (!account) continue;
    const key = account.handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(account);
  }
  const t = String(target ?? '').replace(/^@+/, '');
  return { target: `@${t}`, kind, accounts, capturedAt };
}

/** CSV columns for a follower/following network export. */
export const NETWORK_CSV_HEADER = [
  'target',
  'relationship',
  'handle',
  'display_name',
  'bio',
  'captured_at',
] as const;

/**
 * Serialize captured network artifacts to a CSV string, one row per account, with
 * EVERY cell routed through `csvCell` — so a scraped bio like `=HYPERLINK("http://evil")`
 * is neutralized as literal text (the review's spreadsheet formula-injection finding).
 * A leading BOM + CRLF line endings match the app's other CSV exports. Port of
 * quarantine `exportRelationshipsCsv` (`electron/main.cjs:1146-1170`).
 */
export function networkToCsv(artifacts: readonly XNetworkArtifact[] | undefined): string {
  const lines: string[] = [NETWORK_CSV_HEADER.map((h) => csvCell(h)).join(',')];
  for (const art of artifacts ?? []) {
    for (const account of art.accounts ?? []) {
      lines.push(
        [
          art.target,
          art.kind,
          account.handle,
          account.displayName,
          account.bio ?? '',
          art.capturedAt,
        ]
          .map((cellValue) => csvCell(String(cellValue ?? '')))
          .join(','),
      );
    }
  }
  return `﻿${lines.join('\r\n')}`;
}
