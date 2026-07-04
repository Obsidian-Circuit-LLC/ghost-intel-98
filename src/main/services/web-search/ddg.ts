/**
 * Tor-routed web search via DuckDuckGo's onion service. Onion-to-onion — the request never leaves
 * the Tor network (no exit node, no clearnet, no API key), routed through the dedicated, compartmented
 * plugin-egress Tor (`torFetch`). Results are parsed from DDG's no-JS `/html/` endpoint and are treated
 * as UNTRUSTED downstream (neutralized before they reach the model — see ai.ts).
 *
 * NOTE: DDG_ONION MUST be verified against DuckDuckGo's official published v3 onion before release
 * (it cannot be verified from the build box). `searchWeb` enforces `.onion` on the endpoint host, so
 * any endpoint (default or override) that is not an onion fails closed to [] — a clearnet host can
 * never route through a Tor exit node. The search is fail-closed throughout: a blocked/non-200 fetch
 * yields no results, never a clearnet fallback.
 */
import { torFetch, ensurePluginTor } from '../../plugins/tor-egress';

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

/**
 * Run a Tor-routed DDG search. Fail-closed: any blocked/non-200 fetch (Tor down, onion unreachable,
 * refusal) returns [] — never a clearnet fallback. `deps` is injectable for tests.
 */
export async function searchWeb(query: string, opts: { caseId?: string } & Partial<SearchDeps> = {}): Promise<WebResult[]> {
  const q = query.trim();
  if (!q) return [];
  const ensure = opts.ensure ?? ensurePluginTor;
  const doFetch = opts.fetch ?? torFetch;
  const endpoint = opts.endpoint ?? DDG_ONION;
  // Charter: onion-to-onion ONLY. Enforce it here (not by convention) so no override — present or
  // future — can ever route a clearnet host through a Tor exit node. Fail-closed on a bad/non-onion URL.
  let host: string;
  try { host = new URL(endpoint).hostname; } catch { return []; }
  if (!host.endsWith('.onion')) return [];
  try {
    await ensure();
  } catch {
    return []; // Tor unavailable → no results, no fallback
  }
  const url = `${endpoint.replace(/\/$/, '')}/html/?q=${encodeURIComponent(q)}`;
  const res = await doFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, caseId: opts.caseId });
  if (res.blocked || res.status !== 200 || !res.body) return [];
  return parseDdgResults(res.body);
}
