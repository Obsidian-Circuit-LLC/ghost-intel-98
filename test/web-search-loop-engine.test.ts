/**
 * Loop integration (Task 4): the `[SEARCH:]` handler resolves the operator-selected engine and runs
 * it, feeding its results through the SAME untrusted-data fence for every engine. These tests compose
 * the exact seam the ai.ts loop uses (getEngine → endpointForEngine → engine.run → formatWebResults +
 * planWebSearch) with an injected fetch so no network is touched, proving: SearXNG is actually invoked
 * (not silently swallowed by the DDG fallback) when selected; the operator SearXNG onion is the fetched
 * host; DDG keeps its own pinned onion (the SearXNG onion is NOT used for it); and the clearnet fallback
 * stays DDG-only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getEngine, endpointForEngine, engineDisplayName } from '../src/main/services/web-search/registry';
import { formatWebResults, planWebSearch, formatSearchAnnounce } from '../src/main/services/web-search/directive';
import { DEFAULT_SEARXNG_ONION } from '../src/main/services/web-search/searxng';
import { DDG_ONION } from '../src/main/services/web-search/ddg';

const SEARXNG_FIXTURE = readFileSync(new URL('./fixtures/search/searxng-results.json', import.meta.url), 'utf8');
const DDG_FIXTURE = readFileSync(new URL('./fixtures/search/ddg-onion-results.html', import.meta.url), 'utf8');
const FENCE = 'abadcafef00d01';
const ensure = async (): Promise<void> => {};

/** Reproduces the ai.ts loop's engine path for one query with an injected fetch. */
async function runLoopEngine(searchEngine: string, searxngOnion: string): Promise<{ fetchedUrl: string; announce: string; fenced: string; results: number; clearnetEligible: boolean }> {
  const engine = getEngine(searchEngine);
  const announce = formatSearchAnnounce(engineDisplayName(engine), 'openbsd pf firewall');
  let fetchedUrl = '';
  const { results } = await engine.run('openbsd pf firewall', {
    ensure,
    endpoint: endpointForEngine(engine, searxngOnion),
    fetch: (async (url: string) => {
      fetchedUrl = url;
      const body = engine.id === 'searxng' ? SEARXNG_FIXTURE : DDG_FIXTURE;
      return { status: 200, body, finalUrl: 'x' };
    }) as never,
  });
  const fenced = formatWebResults('openbsd pf firewall', results, FENCE);
  return { fetchedUrl, announce, fenced, results: results.length, clearnetEligible: engine.id === 'ddg' };
}

describe('[SEARCH:] loop runs the selected engine', () => {
  it('searchEngine="searxng" fetches the operator SearXNG onion and fences the mapped results', async () => {
    const custom = 'http://searxcustominstance000000000000000000000000000000000000.onion';
    const r = await runLoopEngine('searxng', custom);
    expect(r.fetchedUrl.startsWith(`${custom}/search?`)).toBe(true);
    expect(r.fetchedUrl).toContain('format=json');
    expect(r.results).toBe(11);
    // fenced behind the SAME untrusted-data fence as every engine
    expect(r.fenced).toContain(`<<<UNTRUSTED-WEB-RESULTS ${FENCE}>>>`);
    expect(r.fenced).toContain('OpenBSD');
    // transparency line names the engine
    expect(r.announce).toContain('SearXNG');
    // onion metasearch has NO clearnet fallback
    expect(r.clearnetEligible).toBe(false);
    expect(planWebSearch({ torResults: 0, clearnetOn: true, clearnetEligible: r.clearnetEligible })).toEqual({ mode: 'empty' });
  });

  it('the SearXNG onion setting is NEVER used as the DDG endpoint — DDG keeps its pinned onion + clearnet fallback', async () => {
    const r = await runLoopEngine('ddg', DEFAULT_SEARXNG_ONION);
    expect(r.fetchedUrl.startsWith(`${DDG_ONION}/html/?`)).toBe(true);
    expect(r.fetchedUrl).not.toContain(new URL(DEFAULT_SEARXNG_ONION).hostname);
    expect(r.results).toBeGreaterThan(0);
    expect(r.fenced).toContain(`<<<UNTRUSTED-WEB-RESULTS ${FENCE}>>>`);
    expect(r.announce).toContain('DuckDuckGo');
    // DDG keeps the clearnet fallback
    expect(r.clearnetEligible).toBe(true);
    expect(planWebSearch({ torResults: 0, clearnetOn: true, clearnetEligible: r.clearnetEligible })).toEqual({ mode: 'clearnet' });
  });

  it('an unknown/stale engine id falls back to DDG (never leaves the loop engine-less)', async () => {
    const r = await runLoopEngine('bing-was-removed', DEFAULT_SEARXNG_ONION);
    expect(r.fetchedUrl.startsWith(`${DDG_ONION}/html/?`)).toBe(true);
    expect(r.clearnetEligible).toBe(true);
  });
});
