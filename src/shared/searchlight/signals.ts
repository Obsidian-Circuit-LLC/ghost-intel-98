/**
 * Pure structural signal extractor — NO Date.now / Math.random.
 * Same input → identical output (determinism invariant).
 *
 * Parsing rules (HARD):
 *  - STATIC regexes only — never `new RegExp(untrustedInput)` (ReDoS / main-thread freeze).
 *  - JSON-LD blocks: guarded try/catch; malformed → skip, signal stays 0.
 *  - All parsing bounded by caller's 64 KB BODY_CAP upstream.
 */

import type { MaigretSiteEntry, RawCheckResult, SignalVector } from './types';
import {
  AUTH_PATH_PATTERNS,
  ERROR_KEYWORDS,
  ERROR_SECTION_HINTS,
  POSITIVE_KEYWORDS,
  PROFILE_SECTION_HINTS,
} from './keywords';

// ---------------------------------------------------------------------------
// Static regexes (compile once; never parameterised by untrusted input)
// ---------------------------------------------------------------------------

const RE_TITLE       = /<title[^>]*>([^<]*)<\/title>/i;
const RE_OG_TITLE    = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;
const RE_TW_TITLE    = /<meta[^>]+property=["']twitter:title["'][^>]+content=["']([^"']+)["']/i;
const RE_CANONICAL   = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;
const RE_OG_TYPE_PROFILE = /<meta[^>]+property=["']og:type["'][^>]+content=["']profile["']/i;
const RE_JSON_LD_BLOCK   = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const RE_META_TAGS       = /<meta[^>]+>/gi;
const RE_IMG             = /<img\b/gi;
const RE_INPUT           = /<input\b/gi;
const RE_FORM            = /<form\b/gi;
const RE_LINK            = /<a\b/gi;
const RE_TAGS_STRIP      = /<[^>]*>/g;

/** Extract all `<script type="application/ld+json">` block text values. */
function extractJsonLdBlocks(body: string): string[] {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RE_JSON_LD_BLOCK.source, 'gi'); // fresh instance per call for lastIndex safety
  while ((m = re.exec(body)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

/** Returns true if any JSON-LD block parses successfully and contains "@type": "Person". */
function hasJsonLdPerson(body: string): boolean {
  const blocks = extractJsonLdBlocks(body);
  for (const raw of blocks) {
    try {
      const obj = JSON.parse(raw) as unknown;
      if (obj !== null && typeof obj === 'object') {
        const t = (obj as Record<string, unknown>)['@type'];
        if (typeof t === 'string' && t.toLowerCase() === 'person') return true;
        // Also handle arrays: "@type": ["Person"]
        if (Array.isArray(t) && t.some((v: unknown) => typeof v === 'string' && v.toLowerCase() === 'person')) return true;
      }
    } catch {
      // malformed — skip
    }
  }
  return false;
}

/** Case-insensitive substring presence check. */
function ci(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Count distinct keyword hits in text (lowercased comparison). */
function countDistinctKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) count++;
  }
  return count;
}

/** Extract all <meta …> tag text concatenated. */
function extractMetaText(body: string): string {
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RE_META_TAGS.source, 'gi');
  while ((m = re.exec(body)) !== null) {
    parts.push(m[0]);
  }
  return parts.join(' ');
}

/**
 * Count class/id attribute hits for the given hint list.
 * Looks for hint strings appearing in the body (covers class names, ids, data-attrs).
 */
function countSectionHits(body: string, hints: string[]): number {
  const lower = body.toLowerCase();
  let count = 0;
  for (const hint of hints) {
    if (lower.includes(hint)) count++;
  }
  return count;
}

/** Strip HTML tags and return plain text. */
function stripTags(html: string): string {
  return html.replace(RE_TAGS_STRIP, ' ');
}

/** Derive the username from the last path segment of a URL (lowercased, decoded). */
function usernameFromUrl(targetUrl: string): string {
  const stripped = targetUrl.replace(/\/+$/, '');
  const last = stripped.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last).toLowerCase();
  } catch {
    return last.toLowerCase();
  }
}

/** Test whether a URL path matches any AUTH_PATH_PATTERNS entry (static list). */
function matchesAuthPattern(url: string | null): boolean {
  if (!url) return false;
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  for (const pat of AUTH_PATH_PATTERNS) {
    if (path.includes(pat)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a `SignalVector` from a probe result.
 *
 * Cheap signals (HTTP-tier) are always present.
 * Body signals are present and computed only when `raw.body` is non-empty;
 * otherwise they are omitted entirely (the ML layer fills missing keys with
 * the model's training mean so they contribute neutrally).
 *
 * NO `Date.now`, NO `Math.random` — pure function of its inputs.
 */
export function extractSignals(
  _site: MaigretSiteEntry,
  raw: RawCheckResult,
  targetUrl: string,
): SignalVector {
  const v: SignalVector = {};
  const { statusCode, elapsed, redirectUrl, body } = raw;

  // ---- Cheap (always) ----
  v.http_200  = statusCode === 200 ? 1 : 0;
  v.http_3xx  = statusCode >= 300 && statusCode < 400 ? 1 : 0;
  v.http_404  = statusCode === 404 ? 1 : 0;
  v.http_4xx  = statusCode >= 400 && statusCode < 500 && statusCode !== 404 ? 1 : 0;
  v.http_5xx  = statusCode >= 500 ? 1 : 0;

  const username = usernameFromUrl(targetUrl);
  v.has_username_in_path = username && targetUrl.toLowerCase().split('/').includes(username) ? 1 : 0;

  v.has_auth_pattern = (matchesAuthPattern(targetUrl) || matchesAuthPattern(redirectUrl)) ? 1 : 0;
  v.redirect_count   = redirectUrl ? 1 : 0;
  v.response_time    = elapsed;
  v.content_length   = body ? body.length : 0;

  // ---- Body (only when present) ----
  if (body) {
    // Title
    const titleMatch = RE_TITLE.exec(body);
    const titleText  = titleMatch ? titleMatch[1] : '';
    v.title_has_username = titleText && username && ci(titleText, username) ? 1 : 0;

    // Meta og:title / twitter:title
    const ogTitleM  = RE_OG_TITLE.exec(body);
    const twTitleM  = RE_TW_TITLE.exec(body);
    const metaTitleText = [ogTitleM?.[1] ?? '', twTitleM?.[1] ?? ''].join(' ');
    v.meta_has_username = username && metaTitleText && ci(metaTitleText, username) ? 1 : 0;

    // Canonical URL
    const canonM = RE_CANONICAL.exec(body);
    const canonHref = canonM ? canonM[1] : '';
    v.username_in_canonical = username && canonHref && ci(canonHref, username) ? 1 : 0;

    // og:type profile
    v.og_type_profile = RE_OG_TYPE_PROFILE.test(body) ? 1 : 0;

    // JSON-LD Person
    v.has_json_ld_person = hasJsonLdPerson(body) ? 1 : 0;

    // Keyword counts in full body text
    const bodyText = stripTags(body);
    v.error_keyword_count    = countDistinctKeywords(bodyText, ERROR_KEYWORDS);
    v.positive_keyword_count = countDistinctKeywords(bodyText, POSITIVE_KEYWORDS);

    // Keyword counts in <meta> tag text only
    const metaText = extractMetaText(body);
    v.meta_error_keyword_count    = countDistinctKeywords(metaText, ERROR_KEYWORDS);
    v.meta_positive_keyword_count = countDistinctKeywords(metaText, POSITIVE_KEYWORDS);

    // Section hint counts (class/id/data-attr style hits in raw HTML)
    v.profile_section_count = countSectionHits(body, PROFILE_SECTION_HINTS);
    v.error_section_count   = countSectionHits(body, ERROR_SECTION_HINTS);

    // Tag counts — static regex, not parameterised
    v.img_count   = (body.match(RE_IMG)   || []).length;
    v.input_count = (body.match(RE_INPUT) || []).length;
    v.form_count  = (body.match(RE_FORM)  || []).length;
    v.link_count  = (body.match(RE_LINK)  || []).length;

    // Plain-text length
    v.text_length = bodyText.length;

    // fingerprint_match_found / fingerprint_match_not_found: OMITTED
    // heuristic_score: OMITTED (added by scorer/interpret layer)
  }

  return v;
}
