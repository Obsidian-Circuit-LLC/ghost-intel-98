import { describe, it, expect } from 'vitest';
import { getEngine, SEARCH_ENGINES, ddgEngine } from '../src/main/services/web-search/registry';

const FIXTURE = `
<div class="result results_links web-result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Example A</a>
  </h2>
  <a class="result__snippet">Snippet one.</a>
</div>`;

describe('SearchEngine registry', () => {
  it('getEngine("ddg") returns the DDG descriptor with egress:"tor"', () => {
    const e = getEngine('ddg');
    expect(e).toBe(ddgEngine);
    expect(e.id).toBe('ddg');
    expect(e.egress).toBe('tor');
    expect(typeof e.label).toBe('string');
    expect(e.label.length).toBeGreaterThan(0);
  });

  it('getEngine of an unknown id falls back to DDG', () => {
    expect(getEngine('nonexistent')).toBe(ddgEngine);
    expect(getEngine('')).toBe(ddgEngine);
  });

  it('SEARCH_ENGINES is keyed by id and contains ddg', () => {
    expect(SEARCH_ENGINES.ddg).toBe(ddgEngine);
    expect(SEARCH_ENGINES.ddg.id).toBe('ddg');
  });
});

describe('ddgEngine.run delegates to searchWeb', () => {
  const ensure = async () => {};

  it('routes to the onion /html/ endpoint, returns results + reason "ok"', async () => {
    let calledUrl = '';
    const { results, reason } = await ddgEngine.run('acme corp', {
      ensure,
      endpoint: 'https://ddg.onion',
      fetch: (async (url: string) => { calledUrl = url; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never
    });
    expect(calledUrl).toBe('https://ddg.onion/html/?q=acme%20corp');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ title: 'Example A', url: 'https://example.com/a', snippet: 'Snippet one.' });
    expect(reason).toBe('ok');
  });

  it('fail-closed on a non-onion endpoint: never fetches, returns [] + reason "bad-endpoint"', async () => {
    let fetched = false;
    const { results, reason } = await ddgEngine.run('x', {
      ensure,
      endpoint: 'https://evil.example',
      fetch: (async () => { fetched = true; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never
    });
    expect(fetched).toBe(false);
    expect(results).toEqual([]);
    expect(reason).toBe('bad-endpoint');
  });

  it('reports "no-results" on a 200 that parses to nothing', async () => {
    const { results, reason } = await ddgEngine.run('x', {
      ensure,
      endpoint: 'https://ddg.onion',
      fetch: (async () => ({ status: 200, body: '<html>none</html>', finalUrl: 'x' })) as never
    });
    expect(results).toEqual([]);
    expect(reason).toBe('no-results');
  });
});
