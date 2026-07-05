/**
 * Tor-routed metasearch via a SearXNG onion instance. Onion-to-onion — the request never leaves the
 * Tor network (no exit node, no clearnet, no API key), routed through the dedicated, compartmented
 * plugin-egress Tor (`torFetch`). SearXNG aggregates Google/Bing/DDG/Brave/etc. SERVER-SIDE and returns
 * a clean JSON API (`?format=json`), so the app scrapes nothing and the user's IP is fully hidden while
 * still getting big-engine coverage. Results are treated as UNTRUSTED downstream (neutralized before
 * they reach the model — see ai.ts), exactly like DDG's.
 *
 * `DEFAULT_SEARXNG_ONION` is the operator's verified onion instance (2026-07-05). The engine enforces
 * `.onion` on the endpoint host, so any endpoint (default or operator override) that is not an onion
 * fails closed to [] — a clearnet host can never route through a Tor exit node. Fail-closed throughout:
 * a blocked/non-200 fetch, or malformed JSON, yields no results, never a clearnet fallback.
 */
import { torFetch, ensurePluginTor } from '../../plugins/tor-egress';
import type { WebResult, SearchReason } from './ddg';
import type { SearchEngine, EngineRunDeps } from './registry';

/** Operator's verified default SearXNG onion instance (editable via settings; `.onion`-enforced). */
export const DEFAULT_SEARXNG_ONION = 'http://searxokthnxmo7ndis35jpts2tawcwvbovuy47qtavwo7oq4jgcm5gqd.onion';

/**
 * Pure parser for SearXNG's `?format=json` body. Maps `results[]` → `{ title, url, snippet }` using
 * `content` as the snippet (empty string when absent), skipping any entry with no `url`. Any malformed
 * JSON, a missing/non-array `results`, or a non-object body yields [] — never throws. Pure (no clock/
 * RNG) so it is unit-tested against the real committed fixture with no network.
 */
export function parseSearxngJson(body: string): WebResult[] {
  let data: unknown;
  try { data = JSON.parse(body); } catch { return []; }
  if (!data || typeof data !== 'object') return [];
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: WebResult[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const url = (r as { url?: unknown }).url;
    if (typeof url !== 'string' || !url) continue;
    const title = (r as { title?: unknown }).title;
    const content = (r as { content?: unknown }).content;
    out.push({
      title: typeof title === 'string' ? title : '',
      url,
      snippet: typeof content === 'string' ? content : '',
    });
  }
  return out;
}

/**
 * SearXNG onion engine descriptor for the search registry. `egress:'tor'` — the loop runs it under the
 * Tor gate. `run` fetches `${endpoint}/search?q=<enc>&format=json` via `torFetch`, with the endpoint
 * `.onion`-enforced (fail-closed → `bad-endpoint`/[], never fetching a clearnet host), maps the body via
 * the pure `parseSearxngJson`, and reports a `SearchReason` (ok/no-results/tor-unavailable/blocked/
 * bad-endpoint/empty-query) — mirroring DDG's diagnosability so a zero is never an ambiguous "(0)".
 */
export const searxngEngine: SearchEngine = {
  id: 'searxng',
  label: 'SearXNG · Tor',
  egress: 'tor',
  async run(query: string, deps: EngineRunDeps = {}): Promise<{ results: WebResult[]; reason: SearchReason }> {
    const q = query.trim();
    if (!q) return { results: [], reason: 'empty-query' };
    const ensure = deps.ensure ?? ensurePluginTor;
    const doFetch = deps.fetch ?? torFetch;
    const endpoint = deps.endpoint ?? DEFAULT_SEARXNG_ONION;
    // Charter: onion-to-onion ONLY. Enforce it here (not by convention) so no override — present or
    // future — can ever route a clearnet host through a Tor exit node. Fail-closed on a bad/non-onion URL.
    let host: string;
    try { host = new URL(endpoint).hostname; } catch { return { results: [], reason: 'bad-endpoint' }; }
    if (!host.endsWith('.onion')) return { results: [], reason: 'bad-endpoint' };
    try {
      await ensure();
    } catch {
      return { results: [], reason: 'tor-unavailable' };
    }
    const url = `${endpoint.replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json`;
    const res = await doFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      caseId: deps.caseId,
    });
    if (res.blocked || res.status !== 200 || !res.body) return { results: [], reason: 'blocked' };
    const results = parseSearxngJson(res.body);
    return { results, reason: results.length ? 'ok' : 'no-results' };
  },
};
