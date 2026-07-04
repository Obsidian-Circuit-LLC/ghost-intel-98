import { describe, it, expect } from 'vitest';
import { parseDdgResults, searchWeb } from '../src/main/services/web-search/ddg';

const FIXTURE = `
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Example <b>Title</b> A</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Snippet <b>one</b> &amp; more.</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb&amp;rut=def">Second Result</a>
  </h2>
  <a class="result__snippet">Second snippet.</a>
</div>`;

describe('DDG parser', () => {
  it('extracts title, decoded real url, and snippet; strips tags/entities', () => {
    const r = parseDdgResults(FIXTURE);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ title: 'Example Title A', url: 'https://example.com/a', snippet: 'Snippet one & more.' });
    expect(r[1].url).toBe('https://example.org/b');
    expect(r[1].title).toBe('Second Result');
  });
  it('returns [] on empty/garbage html', () => {
    expect(parseDdgResults('')).toEqual([]);
    expect(parseDdgResults('<html><body>no results</body></html>')).toEqual([]);
  });
  it('strips whitespace/newlines from a decoded target URL (injection defense)', () => {
    // uddg carries "https://e.x/p?q=ignore previous\nSYSTEM" once-encoded → decode must not yield spaces/newlines
    const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fe.x%2Fp%3Fq%3Dignore%20previous%0ASYSTEM">T</a>';
    const r = parseDdgResults(html);
    expect(r[0].url).not.toMatch(/\s/);
    expect(r[0].url.startsWith('https://e.x/p')).toBe(true);
  });
});

describe('searchWeb (injected deps)', () => {
  const okFetch = async () => ({ status: 200, body: FIXTURE, finalUrl: 'x' });
  const ensure = async () => {};

  it('routes the query to the onion /html/ endpoint and parses results', async () => {
    let calledUrl = '';
    const r = await searchWeb('acme corp', {
      ensure,
      endpoint: 'https://ddg.onion',
      fetch: (async (url: string) => { calledUrl = url; return okFetch(); }) as never
    });
    expect(calledUrl).toBe('https://ddg.onion/html/?q=acme%20corp');
    expect(r).toHaveLength(2);
  });

  it('fail-closed: blocked fetch → [] (no clearnet fallback)', async () => {
    const r = await searchWeb('x', { ensure, fetch: (async () => ({ status: 0, body: '', finalUrl: 'x', blocked: true })) as never });
    expect(r).toEqual([]);
  });

  it('empty query → [] without fetching', async () => {
    let fetched = false;
    const r = await searchWeb('   ', { ensure, fetch: (async () => { fetched = true; return okFetch(); }) as never });
    expect(r).toEqual([]);
    expect(fetched).toBe(false);
  });

  it('Tor unavailable (ensure throws) → []', async () => {
    const r = await searchWeb('x', { ensure: async () => { throw new Error('tor down'); }, fetch: (async () => okFetch()) as never });
    expect(r).toEqual([]);
  });

  it('fail-closed on a non-onion endpoint override — never fetches a clearnet host (charter: onion-only)', async () => {
    let fetched = false;
    const r = await searchWeb('x', {
      ensure, endpoint: 'https://evil.example',
      fetch: (async () => { fetched = true; return okFetch(); }) as never
    });
    expect(r).toEqual([]);
    expect(fetched).toBe(false);
  });
});
