/**
 * GhostScrape (Task 2) — pure GraphQL response parsing: X timeline/profile JSON
 * → typed records, plus the post-capture retweet/date/dedupe/cap filter.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native Electron
 * primitives.
 *
 * Clearnet quarantine (spec §3.2, mirrored from src/main/x/ipc.ts) — this module
 * MUST NOT import from:
 *   src/main/bgconn/*
 *   src/main/chat/transport-tor
 *   src/main/chat/socks5
 *   src/main/searchlight/tor-socks
 *   src/main/socmint/collector
 * All egress is the hidden browser's own clearnet HTTPS to x.com; nothing here
 * makes a network call. Secrets/settings/storage are injected from register.ts,
 * never imported here.
 *
 * The X GraphQL response shape is undocumented, unstable, and adversarial (it is
 * server-controlled JSON from the network, outside our trust boundary). Every
 * level of traversal is guarded — no assumption that any key exists or has the
 * expected type — so a shape change or garbage response degrades to an
 * empty/`null` result rather than throwing.
 */

import type { GhostScrapeConfig, ScrapedProfile, ScrapedTweet } from './types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Safe nested property read: returns undefined the moment any hop isn't a record. */
function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Twitter's `created_at` format ("Wed Jun 25 12:00:00 +0000 2026") parses fine
 * via Date; fall back to the raw string (never throw, never invent a value). */
function toIso(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

/**
 * A single X GraphQL `UserTweets`/`UserTweetsAndReplies` response nests its
 * timeline instructions under one of a few sibling paths depending on API
 * version; try each, first match wins (ported from ZenScraper's fallback chain).
 */
function extractInstructions(raw: unknown): unknown[] {
  const result = get(raw, 'data', 'user', 'result');
  if (!isRecord(result)) return [];

  const candidates: unknown[] = [
    get(result, 'timeline_v2', 'timeline', 'instructions'),
    get(result, 'timeline', 'timeline', 'instructions'),
    get(result, 'legacy', 'timeline_v2', 'timeline', 'instructions')
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

/** Extract a tweet from an `itemContent` object — shared by single `tweet-*` entries and the
 *  items[] of a `TimelineTimelineModule` (conversation / self-thread) entry. Returns null for
 *  non-tweet item content (cursors, "show more" controls, promoted slots, etc.). */
function tweetFromItemContent(itemContent: unknown): ScrapedTweet | null {
  const tweetResult = get(itemContent, 'tweet_results', 'result');
  if (!isRecord(tweetResult)) return null;

  const id = str(tweetResult['rest_id']);
  if (!id) return null;

  const legacy = tweetResult['legacy'];
  const legacyRec = isRecord(legacy) ? legacy : {};

  const noteText = str(get(tweetResult, 'note_tweet', 'note_tweet_results', 'result', 'text'));
  const ownFullText = collapseWs(noteText || str(legacyRec['full_text']));

  const retweetedResult = get(legacyRec, 'retweeted_status_result', 'result');
  const isRetweet = ownFullText.startsWith('RT @') || isRecord(retweetedResult);

  let text = ownFullText;
  if (isRetweet && isRecord(retweetedResult)) {
    const rtNoteText = str(
      get(retweetedResult, 'note_tweet', 'note_tweet_results', 'result', 'text')
    );
    const rtLegacy = retweetedResult['legacy'];
    const rtLegacyRec = isRecord(rtLegacy) ? rtLegacy : {};
    const rtFullText = collapseWs(rtNoteText || str(rtLegacyRec['full_text']));
    if (rtFullText) text = rtFullText;
  }

  return {
    id,
    text,
    createdAt: toIso(str(legacyRec['created_at'])),
    isRetweet,
    likeCount: num(legacyRec['favorite_count']),
    retweetCount: num(legacyRec['retweet_count']),
    replyCount: num(legacyRec['reply_count']),
    url: `https://x.com/i/web/status/${id}`
  };
}

/**
 * Extract every tweet from one timeline entry. A `tweet-*` entry yields at most one tweet
 * (`content.itemContent`). A `TimelineTimelineModule` entry (conversation / self-thread) carries
 * MULTIPLE tweets under `content.items[].item.itemContent` — these were previously dropped, so
 * threads and self-threads went uncaptured. Cursor and other non-tweet entries yield nothing.
 */
function extractTweetsFromEntry(entry: unknown): ScrapedTweet[] {
  const entryId = str(get(entry, 'entryId'));
  const content = get(entry, 'content');

  if (entryId.startsWith('tweet-')) {
    const t = tweetFromItemContent(get(content, 'itemContent'));
    return t ? [t] : [];
  }

  const items = get(content, 'items');
  if (Array.isArray(items)) {
    const out: ScrapedTweet[] = [];
    for (const it of items) {
      const t = tweetFromItemContent(get(it, 'item', 'itemContent'));
      if (t) out.push(t);
    }
    return out;
  }

  return [];
}

/**
 * Flattens `instructions → entries → tweet_results → legacy` across one or more
 * raw X GraphQL timeline responses into a flat tweet list. Tolerant of any
 * shape mismatch: never throws, degrades to `[]`.
 */
export function parseTimeline(rawResponses: unknown[]): ScrapedTweet[] {
  const tweets: ScrapedTweet[] = [];
  if (!Array.isArray(rawResponses)) return tweets;

  for (const raw of rawResponses) {
    const instructions = extractInstructions(raw);
    for (const instr of instructions) {
      const entries = get(instr, 'entries');
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        for (const tweet of extractTweetsFromEntry(entry)) tweets.push(tweet);
      }
    }
  }
  return tweets;
}

/**
 * Resolves t.co short links inside a profile bio against
 * `legacy.entities.description.urls[].{url,expanded_url}` (ported from
 * ZenScraper's description-resolution step).
 */
function resolveDescriptionUrls(description: string, legacyRec: Record<string, unknown>): string {
  const urls = get(legacyRec, 'entities', 'description', 'urls');
  if (!Array.isArray(urls)) return description;

  let resolved = description;
  for (const u of urls) {
    if (!isRecord(u)) continue;
    const tco = str(u['url']);
    const expanded = str(u['expanded_url']) || tco;
    if (tco && expanded) resolved = resolved.split(tco).join(expanded);
  }
  return resolved;
}

/**
 * Extracts a profile from a single X GraphQL `UserByScreenName` response.
 * Returns `null` (never throws) if the response doesn't have a usable
 * `data.user.result.legacy` with at least a handle.
 */
export function parseProfile(rawResponse: unknown): ScrapedProfile | null {
  const legacy = get(rawResponse, 'data', 'user', 'result', 'legacy');
  if (!isRecord(legacy)) return null;

  const handle = str(legacy['screen_name']);
  if (!handle) return null;

  return {
    handle,
    displayName: str(legacy['name']),
    bio: resolveDescriptionUrls(str(legacy['description']), legacy),
    followers: num(legacy['followers_count']),
    following: num(legacy['friends_count']),
    joined: toIso(str(legacy['created_at']))
  };
}

/**
 * Post-capture filter: drop by scrape type (retweets excluded for `'tweets'`,
 * everything but retweets excluded for `'retweets'`), restrict to an ISO-8601
 * `sinceAfter`/`before` window, dedupe by id, sort newest-first (createdAt desc,
 * id asc tiebreak — deterministic regardless of input order), then cap at `max`.
 */
export function applyFilters(
  tweets: ScrapedTweet[],
  cfg: Pick<GhostScrapeConfig, 'type' | 'sinceAfter' | 'before' | 'max'>
): ScrapedTweet[] {
  const sinceMs = cfg.sinceAfter ? Date.parse(cfg.sinceAfter) : NaN;
  const beforeMs = cfg.before ? Date.parse(cfg.before) : NaN;
  const hasSince = Number.isFinite(sinceMs);
  const hasBefore = Number.isFinite(beforeMs);

  const byType = tweets.filter((t) => {
    if (cfg.type === 'tweets') return !t.isRetweet;
    if (cfg.type === 'retweets') return t.isRetweet;
    return true;
  });

  const byDate = byType.filter((t) => {
    if (!hasSince && !hasBefore) return true;
    const ms = Date.parse(t.createdAt);
    if (!Number.isFinite(ms)) return false;
    if (hasSince && ms <= sinceMs) return false;
    if (hasBefore && ms >= beforeMs) return false;
    return true;
  });

  const seen = new Set<string>();
  const deduped: ScrapedTweet[] = [];
  for (const t of byDate) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    deduped.push(t);
  }

  deduped.sort((a, b) => {
    const aMs = Date.parse(a.createdAt);
    const bMs = Date.parse(b.createdAt);
    const an = Number.isFinite(aMs) ? aMs : -Infinity;
    const bn = Number.isFinite(bMs) ? bMs : -Infinity;
    if (bn !== an) return bn - an;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });

  const max = Number.isFinite(cfg.max) && cfg.max > 0 ? Math.floor(cfg.max) : deduped.length;
  return deduped.slice(0, max);
}
