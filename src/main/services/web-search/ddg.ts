/**
 * Tor-routed web search via DuckDuckGo's onion service. Onion-to-onion — the request never leaves
 * the Tor network (no exit node, no clearnet, no API key), routed through the dedicated, compartmented
 * plugin-egress Tor (`torFetch`). Results are parsed from DDG's no-JS `/html/` endpoint and are treated
 * as UNTRUSTED downstream (neutralized before they reach the model — see ai.ts).
 *
 * NOTE: DDG_ONION is DuckDuckGo's v3 onion (live since Jul 2021), VERIFIED 2026-07-04 as an exact
 * byte-for-byte match against Wikipedia's DuckDuckGo article and independent Tor link directories.
 * `searchWeb` enforces `.onion` on the endpoint host, so any endpoint (default or override) that is
 * not an onion fails closed to [] — a clearnet host can never route through a Tor exit node. The
 * search is fail-closed throughout: a blocked/non-200 fetch yields no results, never a clearnet fallback.
 */
import { torFetch, ensurePluginTor } from '../../plugins/tor-egress';
import type { SearchEngine, EngineRunDeps } from './registry';

export const DDG_ONION = 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion';
export const MAX_RESULTS = 6;

export interface WebResult { title: string; url: string; snippet: string }

/** Strip HTML tags + decode the handful of entities DDG emits, collapse whitespace. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DDG wraps every outbound href as `/l/?uddg=<urlencoded real url>&rut=…`. Recover the real target.
 *  The decoded value is attacker-controlled (anyone can rank a page), so strip control chars/newlines
 *  and cap length — a decoded URL must never be able to forge a new line or smuggle a readable
 *  instruction block into the model prompt. */
function realUrl(href: string): string {
  let raw = href;
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { raw = decodeURIComponent(m[1]); } catch { raw = href; } }
  else if (href.startsWith('//')) raw = `https:${href}`;
  return raw.replace(/\s/g, "").slice(0, 300);
}

/**
 * Pure parser for DDG's `/html/` result markup (stable for years): each result is an
 * `<a class="result__a" href="…">title</a>` followed by an `<a class="result__snippet">snippet</a>`.
 * Tolerant of attribute order and extra classes; caps at MAX_RESULTS. Pure so it is unit-tested
 * against a fixture with no network.
 */
export function parseDdgResults(html: string): WebResult[] {
  const out: WebResult[] = [];
  const linkRe = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));
  let lm: RegExpExecArray | null; let i = 0;
  while ((lm = linkRe.exec(html)) !== null && out.length < MAX_RESULTS) {
    const title = stripTags(lm[2]);
    const url = realUrl(lm[1]);
    if (title && url) out.push({ title, url, snippet: snippets[i] ?? '' });
    i += 1;
  }
  return out;
}

export interface SearchDeps { fetch: typeof torFetch; ensure: typeof ensurePluginTor; endpoint: string }

/** Why a Tor search produced the result it did — so the UI can tell a Tor-down from an unreachable
 *  onion from a genuinely-empty query, instead of collapsing every zero into the same "(0 results)".
 *  Diagnosability for GhostExodus's "can't search anything over Tor" (which works from our test box,
 *  so his zero is environmental — this makes WHICH environmental cause visible in one screenshot). */
export type SearchReason = 'ok' | 'no-results' | 'tor-unavailable' | 'blocked' | 'bad-endpoint' | 'empty-query';

/**
 * Run a Tor-routed DDG search. Fail-closed: any blocked/non-200 fetch (Tor down, onion unreachable,
 * refusal) returns [] — never a clearnet fallback. `deps` is injectable for tests. `onReason` (when
 * supplied) is called exactly once with the outcome reason before returning — the results array is
 * unchanged, so existing callers/tests are unaffected.
 */
export async function searchWeb(
  query: string,
  opts: { caseId?: string; onReason?: (r: SearchReason) => void } & Partial<SearchDeps> = {}
): Promise<WebResult[]> {
  const report = (r: SearchReason): void => opts.onReason?.(r);
  const q = query.trim();
  if (!q) { report('empty-query'); return []; }
  const ensure = opts.ensure ?? ensurePluginTor;
  const doFetch = opts.fetch ?? torFetch;
  const endpoint = opts.endpoint ?? DDG_ONION;
  // Charter: onion-to-onion ONLY. Enforce it here (not by convention) so no override — present or
  // future — can ever route a clearnet host through a Tor exit node. Fail-closed on a bad/non-onion URL.
  let host: string;
  try { host = new URL(endpoint).hostname; } catch { report('bad-endpoint'); return []; }
  if (!host.endsWith('.onion')) { report('bad-endpoint'); return []; }
  try {
    await ensure();
  } catch {
    report('tor-unavailable'); // Tor couldn't start/bootstrap → no results, no fallback
    return [];
  }
  const url = `${endpoint.replace(/\/$/, '')}/html/?q=${encodeURIComponent(q)}`;
  const res = await doFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, caseId: opts.caseId });
  if (res.blocked || res.status !== 200 || !res.body) { report('blocked'); return []; }
  const results = parseDdgResults(res.body);
  report(results.length ? 'ok' : 'no-results');
  return results;
}

/**
 * DuckDuckGo onion engine descriptor for the search registry. This is a thin wrapping of the existing
 * `searchWeb` (onion enforcement, parsing, and fail-closed posture UNCHANGED) that adapts its
 * `onReason` callback into the registry's `{ results, reason }` return shape. `egress:'tor'` — the loop
 * runs it under the Tor gate; the endpoint stays `.onion`-enforced inside `searchWeb`.
 */
export const ddgEngine: SearchEngine = {
  id: 'ddg',
  label: 'DuckDuckGo · Tor',
  egress: 'tor',
  async run(query: string, deps: EngineRunDeps = {}): Promise<{ results: WebResult[]; reason: SearchReason }> {
    let reason: SearchReason = 'no-results';
    const results = await searchWeb(query, {
      caseId: deps.caseId,
      endpoint: deps.endpoint,
      fetch: deps.fetch,
      ensure: deps.ensure,
      onReason: (r) => { reason = r; },
    });
    return { results, reason };
  },
};

export const DDG_CLEARNET = 'https://html.duckduckgo.com';

/**
 * Opt-in, non-Tor, plain-https DDG search. This is the ONLY new clearnet egress in this change and
 * is deliberately a separate function from `searchWeb` so the Tor onion path above stays untouched
 * and `.onion`-enforced. Policy (whether this may run at all) is decided by the caller (ai.ts) — this
 * function does not check any setting. Fail-closed: a non-200 response or a throwing fetch yields [],
 * never an exception. Results are still untrusted downstream (fenced by the caller like Tor results).
 */
export async function searchWebClearnet(
  query: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<WebResult[]> {
  const q = query.trim();
  if (!q) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${DDG_CLEARNET}/html/?q=${encodeURIComponent(q)}`;
  try {
    const res = await doFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } } as never);
    if (!res || res.status !== 200) return [];
    const body = await res.text();
    return parseDdgResults(body);
  } catch {
    return [];
  }
}
