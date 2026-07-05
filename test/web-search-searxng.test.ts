import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSearxngJson, searxngEngine, DEFAULT_SEARXNG_ONION } from '../src/main/services/web-search/searxng';

const FIXTURE = readFileSync(new URL('./fixtures/search/searxng-results.json', import.meta.url), 'utf8');

describe('parseSearxngJson (real captured fixture)', () => {
  it('maps results[].{url,title,content->snippet} → 11 WebResults, first = OpenBSD', () => {
    const r = parseSearxngJson(FIXTURE);
    expect(r).toHaveLength(11);
    expect(r[0].title).toBe('OpenBSD');
    expect(r[0].url).toBe('https://www.openbsd.org/');
    expect(r[0].snippet.startsWith('The OpenBSD project')).toBe(true);
  });

  it('skips a result with no url', () => {
    const body = JSON.stringify({ results: [
      { title: 'A', url: 'https://a.example', content: 'a' },
      { title: 'No URL', content: 'skip me' },
      { title: 'B', url: 'https://b.example', content: 'b' },
    ] });
    const r = parseSearxngJson(body);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.url)).toEqual(['https://a.example', 'https://b.example']);
  });

  it('missing content → empty snippet', () => {
    const body = JSON.stringify({ results: [{ title: 'A', url: 'https://a.example' }] });
    expect(parseSearxngJson(body)[0].snippet).toBe('');
  });

  it('malformed / empty → [] (never throws)', () => {
    expect(parseSearxngJson('{}')).toEqual([]);
    expect(parseSearxngJson('not json')).toEqual([]);
    expect(parseSearxngJson('')).toEqual([]);
    expect(parseSearxngJson('{"results": "nope"}')).toEqual([]);
    expect(parseSearxngJson('null')).toEqual([]);
  });
});

describe('searxngEngine', () => {
  const ensure = async () => {};

  it('is an onion (egress:"tor") engine with a pinned .onion default', () => {
    expect(searxngEngine.id).toBe('searxng');
    expect(searxngEngine.egress).toBe('tor');
    expect(new URL(DEFAULT_SEARXNG_ONION).hostname.endsWith('.onion')).toBe(true);
  });

  it('run fetches /search?q=&format=json over Tor and maps the fixture to 11 results', async () => {
    let calledUrl = '';
    const { results, reason } = await searxngEngine.run('openbsd pf firewall', {
      ensure,
      endpoint: 'http://searx.onion',
      fetch: (async (url: string) => { calledUrl = url; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never,
    });
    expect(calledUrl).toBe('http://searx.onion/search?q=openbsd%20pf%20firewall&format=json');
    expect(results).toHaveLength(11);
    expect(results[0].title).toBe('OpenBSD');
    expect(reason).toBe('ok');
  });

  it('fail-closed on a non-onion endpoint: never fetches, returns [] + reason "bad-endpoint"', async () => {
    let fetched = false;
    const { results, reason } = await searxngEngine.run('x', {
      ensure,
      endpoint: 'https://searx.example.com',
      fetch: (async () => { fetched = true; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never,
    });
    expect(fetched).toBe(false);
    expect(results).toEqual([]);
    expect(reason).toBe('bad-endpoint');
  });

  it('reports "tor-unavailable" when ensure() throws (no fetch)', async () => {
    let fetched = false;
    const { results, reason } = await searxngEngine.run('x', {
      ensure: async () => { throw new Error('tor down'); },
      endpoint: 'http://searx.onion',
      fetch: (async () => { fetched = true; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never,
    });
    expect(fetched).toBe(false);
    expect(results).toEqual([]);
    expect(reason).toBe('tor-unavailable');
  });

  it('reports "blocked" on a blocked/non-200 fetch', async () => {
    const { results, reason } = await searxngEngine.run('x', {
      ensure,
      endpoint: 'http://searx.onion',
      fetch: (async () => ({ status: 0, body: '', finalUrl: 'x', blocked: true })) as never,
    });
    expect(results).toEqual([]);
    expect(reason).toBe('blocked');
  });

  it('reports "no-results" on a 200 that maps to nothing', async () => {
    const { results, reason } = await searxngEngine.run('x', {
      ensure,
      endpoint: 'http://searx.onion',
      fetch: (async () => ({ status: 200, body: '{"results":[]}', finalUrl: 'x' })) as never,
    });
    expect(results).toEqual([]);
    expect(reason).toBe('no-results');
  });

  it('empty query → [] + "empty-query" without fetching', async () => {
    let fetched = false;
    const { results, reason } = await searxngEngine.run('   ', {
      ensure,
      endpoint: 'http://searx.onion',
      fetch: (async () => { fetched = true; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never,
    });
    expect(fetched).toBe(false);
    expect(results).toEqual([]);
    expect(reason).toBe('empty-query');
  });

  it('sends Accept: application/json + a browser UA', async () => {
    let headers: Record<string, string> = {};
    await searxngEngine.run('x', {
      ensure,
      endpoint: 'http://searx.onion',
      fetch: (async (_url: string, init: { headers: Record<string, string> }) => { headers = init.headers; return { status: 200, body: FIXTURE, finalUrl: 'x' }; }) as never,
    });
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toBe('Mozilla/5.0');
  });
});
