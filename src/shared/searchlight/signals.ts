/**
 * Pure structural signal extractor — NO Date.now / Math.random.
 * Same input → identical output (determinism invariant).
 *
 * Reconciled verbatim to Aliens_eye (© 2021 Aaron Thomas, MIT licence)
 * analyzer.py / config.py as of Task 9 — see THIRD_PARTY_LICENSES.
 *
 * Parsing rules (HARD):
 *  - STATIC regexes only — never `new RegExp(untrustedInput)` (ReDoS / main-thread freeze).
 *  - JSON-LD blocks: guarded try/catch; malformed → skip, signal stays 0.
 *  - All parsing bounded by caller's 64 KB BODY_CAP upstream.
 */

import type { MaigretSiteEntry, RawCheckResult, SignalVector } from './types';
import {
  AUTH_PATH_PATTERNS,
  ERROR_CLASS_HINTS,
  ERROR_KEYWORDS,
  META_KEYWORDS,
  POSITIVE_KEYWORDS,
  PROFILE_CLASS_HINTS,
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
const RE_META_CONTENT    = /<meta[^>]+content=["']([^"']+)["'][^>]*/gi;
const RE_IMG             = /<img\b/gi;
const RE_INPUT           = /<input\b/gi;
const RE_FORM            = /<form\b/gi;
// Upstream counts <a href=...> (anchors with href) — exclude plain <a name=...> anchors.
const RE_LINK_HREF       = /<a\b[^>]+href=/gi;
const RE_TAGS_STRIP      = /<[^>]*>/g;
// Class-attribute matching: element has a class="..." attribute containing the hint.
// These are STATIC patterns — not built from user input.
const RE_CLASS_PROFILE   = /<[^>]+class=["'][^"']*(?:profile|user|account)[^"']*["']/gi;
const RE_CLASS_ERROR     = /<[^>]+class=["'][^"']*(?:error|not-found|missing|unavailable)[^"']*["']/gi;

/** Extract all `<script type="application/ld+json">` block text values. */
function extractJsonLdBlocks(body: string): string[] {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  RE_JSON_LD_BLOCK.lastIndex = 0; // reset before use (static regex, single-threaded JS)
  while ((m = RE_JSON_LD_BLOCK.exec(body)) !== null) {
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

/**
 * Extract all `content="..."` attribute values from `<meta ...>` tags.
 * Upstream uses an HTML parser; we use a static regex on the meta tag content attributes.
 */
function extractMetaContentText(body: string): string {
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  RE_META_CONTENT.lastIndex = 0; // reset before use (static regex, single-threaded JS)
  while ((m = RE_META_CONTENT.exec(body)) !== null) {
    parts.push(m[1]);
  }
  return parts.join(' ');
}

/**
 * Count elements whose class attribute contains any hint from PROFILE_CLASS_HINTS.
 * Uses a static regex — does NOT accept dynamic input.
 */
function countProfileClassHits(body: string): number {
  // PROFILE_CLASS_HINTS = ['profile', 'user', 'account'] — baked into RE_CLASS_PROFILE.
  // Suppress unused-import warning; the constant documents intent even though
  // the regex encodes the values statically.
  void PROFILE_CLASS_HINTS;
  return (body.match(RE_CLASS_PROFILE) || []).length;
}

/**
 * Count elements whose class attribute contains any hint from ERROR_CLASS_HINTS.
 * Uses a static regex — does NOT accept dynamic input.
 */
function countErrorClassHits(body: string): number {
  void ERROR_CLASS_HINTS;
  return (body.match(RE_CLASS_ERROR) || []).length;
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
 *
 * Reconciled to Aliens_eye analyzer.py / config.py verbatim (Task 9).
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

  // is_homepage: path is "" or "/" (no real user-segment — upstream analyzer.py)
  let isHomepage = false;
  try {
    const parsedPath = new URL(targetUrl).pathname;
    isHomepage = parsedPath === '' || parsedPath === '/';
  } catch {
    isHomepage = false;
  }
  v.is_homepage = isHomepage ? 1 : 0;

  v.has_auth_pattern = (matchesAuthPattern(targetUrl) || matchesAuthPattern(redirectUrl)) ? 1 : 0;
  v.redirect_count   = redirectUrl ? 1 : 0;
  v.response_time    = elapsed / 1000; // ms → seconds: the model was trained on seconds (model.json mean≈0.58); raw ms saturates ML inference
  v.content_length   = body ? body.length : 0;

  // ---- Body (only when present) ----
  if (body) {
    // Title
    const titleMatch = RE_TITLE.exec(body);
    const titleText  = titleMatch ? titleMatch[1] : '';
    v.title_has_username = titleText && username && ci(titleText, username) ? 1 : 0;

    // Meta content text (all content="..." attribute values concatenated)
    const metaText = extractMetaContentText(body);

    // Meta og:title / twitter:title — for meta_has_username check
    const ogTitleM  = RE_OG_TITLE.exec(body);
    const twTitleM  = RE_TW_TITLE.exec(body);
    // Upstream: username in ALL meta content text (meta_text includes all meta content values)
    v.meta_has_username = username && metaText && ci(metaText, username) ? 1 : 0;

    // Also use og/twitter title match as a supplementary signal (belt-and-suspenders)
    if (!v.meta_has_username) {
      const ogTw = [ogTitleM?.[1] ?? '', twTitleM?.[1] ?? ''].join(' ');
      v.meta_has_username = username && ogTw && ci(ogTw, username) ? 1 : 0;
    }

    // Canonical URL
    const canonM = RE_CANONICAL.exec(body);
    const canonHref = canonM ? canonM[1] : '';
    v.username_in_canonical = username && canonHref && ci(canonHref, username) ? 1 : 0;

    // og:type profile
    v.og_type_profile = RE_OG_TYPE_PROFILE.test(body) ? 1 : 0;

    // JSON-LD Person
    v.has_json_ld_person = hasJsonLdPerson(body) ? 1 : 0;

    // Keyword counts in full body text (tags stripped)
    const bodyText = stripTags(body);
    v.error_keyword_count    = countDistinctKeywords(bodyText, ERROR_KEYWORDS);
    v.positive_keyword_count = countDistinctKeywords(bodyText, POSITIVE_KEYWORDS);

    // Keyword counts in meta content text only.
    // Upstream uses positive_keywords + meta_keywords for meta_positive_keyword_count.
    v.meta_error_keyword_count    = countDistinctKeywords(metaText, ERROR_KEYWORDS);
    v.meta_positive_keyword_count = countDistinctKeywords(metaText, [...POSITIVE_KEYWORDS, ...META_KEYWORDS]);

    // Section hint counts: upstream checks CSS class attribute values specifically.
    // Static regexes encode PROFILE_CLASS_HINTS and ERROR_CLASS_HINTS verbatim.
    v.profile_section_count = countProfileClassHits(body);
    v.error_section_count   = countErrorClassHits(body);

    // Tag counts — static regexes, not parameterised
    v.img_count   = (body.match(RE_IMG)       || []).length;
    v.input_count = (body.match(RE_INPUT)      || []).length;
    v.form_count  = (body.match(RE_FORM)       || []).length;
    // Upstream counts <a href=...> (anchors with href attribute)
    v.link_count  = (body.match(RE_LINK_HREF)  || []).length;

    // Plain-text length (tags stripped)
    v.text_length = bodyText.length;

    // fingerprint_match_found / fingerprint_match_not_found: OMITTED
    // (filled with model mean by ML layer → neutral contribution)
    // heuristic_score: OMITTED here (set by scorer/interpret layer before ML inference)
  }

  return v;
}
