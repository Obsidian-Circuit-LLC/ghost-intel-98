import { describe, it, expect, vi } from 'vitest';
import { parseReliefWeb, buildReliefWebUrl, RELIEFWEB_APPNAME, fetchReliefWeb } from '../src/main/geoint/threat-layers/reliefweb';
import { ensureThreatLayerId } from '../src/main/security/validate';

// Mock the shared safeFetch so the appname-pending path can be unit-tested WITHOUT a real DNS
// resolve / network egress (safeFetch does an assertResolvedPublic DNS preflight). The gazetteer
// geocoder is also mocked to a no-op so the fetch path needs no bundled gazetteer file.
vi.mock('../src/main/net/safe-fetch', () => ({
  safeFetch: vi.fn()
}));
vi.mock('../src/main/geoint/gazetteer', () => ({
  geocoder: () => () => null
}));
import { safeFetch } from '../src/main/net/safe-fetch';

// =================================================================================================
// ReliefWeb (UN OCHA) disasters — v2 API. Schema confirmed from the PUBLISHED docs
// (apidoc.reliefweb.int: /, /fields-tables, /result-structure), NOT live-verified — the appname
// 'dcs98' is pending operator registration so a live fetch 403s ("not using an approved appname").
// v1 is DECOMMISSIONED (HTTP 410); v2 is the live version.
//
// Wrapper: { href, time, links, totalCount, count, data: [ { id, score, href, fields: {...} } ] }.
// disasters fields: id (int), name (string), status ('current'|'alert'|'past'), date {created,
// changed, event} (ISO 8601), country [{ id, iso3, name, shortname, primary:bool }] (ARRAY; NO
// per-point lat/lon), primary_type { id, name }, url, url_alias.
//
// Geo is COUNTRY-LEVEL only: take the PRIMARY country name → country centroid via the gazetteer.
// A disaster whose country can't be resolved is DROPPED (no fake (0,0)). LINK-OUT only (title + url).
// =================================================================================================

const RW_DOCS = {
  href: 'https://api.reliefweb.int/v2/disasters?appname=dcs98',
  time: 3,
  totalCount: 5,
  count: 5,
  data: [
    {
      id: 53291,
      score: 1,
      href: 'https://api.reliefweb.int/v2/disasters/53291',
      fields: {
        name: 'Philippines: Tropical Cyclone 2026',
        status: 'alert',
        date: { created: '2026-06-10T00:00:00+00:00', changed: '2026-06-14T00:00:00+00:00' },
        country: [
          { id: 192, iso3: 'phl', name: 'Philippines', shortname: 'Philippines', primary: true },
          { id: 50, iso3: 'idn', name: 'Indonesia', primary: false }
        ],
        primary_type: { id: 4611, name: 'Tropical Cyclone' },
        url: 'https://reliefweb.int/disaster/tc-2026-000123-phl',
        url_alias: 'https://reliefweb.int/disaster/tc-2026-000123-phl'
      }
    },
    {
      id: 53288,
      score: 1,
      fields: {
        name: 'Kenya: Drought 2026',
        status: 'current',
        date: { created: '2026-05-01T00:00:00+00:00', changed: '2026-06-01T00:00:00+00:00' },
        country: [{ id: 131, iso3: 'ken', name: 'Kenya', primary: true }],
        primary_type: { id: 4623, name: 'Drought' },
        url: 'https://reliefweb.int/disaster/dr-2026-000050-ken'
      }
    },
    {
      // No `primary` flag → fall back to the FIRST country (Peru).
      id: 53280,
      fields: {
        name: 'Peru: Floods 2026',
        status: 'past',
        date: { changed: '2026-03-20T00:00:00+00:00' }, // no created → fall back to changed
        country: [{ id: 196, iso3: 'per', name: 'Peru' }],
        primary_type: { id: 4628, name: 'Flood' },
        url: 'https://reliefweb.int/disaster/fl-2026-000010-per'
      }
    },
    {
      // Unresolvable country → DROPPED (no (0,0)).
      id: 53270,
      fields: {
        name: 'Atlantis: Sea Surge',
        status: 'alert',
        date: { created: '2026-06-01T00:00:00+00:00' },
        country: [{ name: 'Atlantis Republic', primary: true }],
        primary_type: { name: 'Flood' },
        url: 'https://reliefweb.int/disaster/atlantis'
      }
    },
    {
      // No country array at all → DROPPED.
      id: 53260,
      fields: {
        name: 'Global appeal',
        status: 'current',
        date: { created: '2026-06-01T00:00:00+00:00' },
        primary_type: { name: 'Complex Emergency' },
        url: 'https://reliefweb.int/disaster/global'
      }
    }
  ]
};

// Deterministic mock geocoder: only the three real countries resolve; everything else is null.
const COUNTRY_COORD: Record<string, { lat: number; lon: number; name: string }> = {
  Philippines: { lat: 12.75, lon: 122.73, name: 'Philippines' },
  Kenya: { lat: 1, lon: 38, name: 'Kenya' },
  Peru: { lat: -10, lon: -76, name: 'Peru' }
};
const mockGeocode = (name: string): { lat: number; lon: number; name: string } | null =>
  COUNTRY_COORD[name] ?? null;

describe('parseReliefWeb', () => {
  const items = parseReliefWeb(RW_DOCS, mockGeocode);

  it('resolves the PRIMARY country → centroid (located:geo, category:disaster)', () => {
    expect(items.length).toBe(3); // two unresolvable/no-country dropped
    const phl = items.find((i) => i.id === 'reliefweb:53291')!;
    expect(phl).toBeTruthy();
    expect(phl.lat).toBe(12.75);
    expect(phl.lon).toBe(122.73);
    expect(phl.located).toBe('geo');
    expect(phl.category).toBe('disaster');
    expect(phl.sourceId).toBe('threat:reliefweb');
    expect(phl.title).toBe('Philippines: Tropical Cyclone 2026');
    // LINK-OUT: the ReliefWeb disaster page only.
    expect(phl.link).toBe('https://reliefweb.int/disaster/tc-2026-000123-phl');
    // date.created preferred.
    expect(phl.published).toBe('2026-06-10T00:00:00+00:00');
  });

  it('picks country[].primary===true over a non-primary first entry', () => {
    // PHL has Indonesia second but primary===true on PHL — must land on PHL coords, not IDN.
    const phl = items.find((i) => i.id === 'reliefweb:53291')!;
    expect(phl.lat).toBe(12.75); // Philippines, not Indonesia (which the mock can't resolve anyway)
  });

  it('falls back to the FIRST country when no primary flag is set', () => {
    const per = items.find((i) => i.id === 'reliefweb:53280')!;
    expect(per.lat).toBe(-10);
    expect(per.lon).toBe(-76);
  });

  it('falls back to date.changed when date.created is absent', () => {
    const per = items.find((i) => i.id === 'reliefweb:53280')!;
    expect(per.published).toBe('2026-03-20T00:00:00+00:00');
  });

  it('maps status → severity (alert→high, current→medium, past→low)', () => {
    expect(items.find((i) => i.id === 'reliefweb:53291')!.severity).toBe('high');   // alert
    expect(items.find((i) => i.id === 'reliefweb:53288')!.severity).toBe('medium'); // current
    expect(items.find((i) => i.id === 'reliefweb:53280')!.severity).toBe('low');    // past
  });

  it('drops disasters whose country cannot be resolved or is absent (no (0,0))', () => {
    expect(items.some((i) => i.id === 'reliefweb:53270')).toBe(false); // Atlantis (unresolvable)
    expect(items.some((i) => i.id === 'reliefweb:53260')).toBe(false); // no country array
    expect(items.some((i) => i.lat === 0 && i.lon === 0)).toBe(false);
  });

  it('prefixes the id with reliefweb:', () => {
    for (const i of items) expect(i.id).toMatch(/^reliefweb:\d+$/);
  });

  it('tolerates malformed input', () => {
    expect(parseReliefWeb(null, mockGeocode)).toEqual([]);
    expect(parseReliefWeb({}, mockGeocode)).toEqual([]);
    expect(parseReliefWeb({ data: 'nope' }, mockGeocode)).toEqual([]);
    expect(parseReliefWeb({ data: [{ fields: { country: [{ name: 'Kenya', primary: true }] } }] }, mockGeocode)).toEqual([]); // no id → drop
  });

  it('caps the result at the max', () => {
    const data = [];
    for (let n = 0; n < 2500; n++) {
      data.push({ id: n + 1, fields: { name: `d${n}`, status: 'current', country: [{ name: 'Kenya', primary: true }] } });
    }
    expect(parseReliefWeb({ data }, mockGeocode).length).toBe(2000);
  });
});

describe('buildReliefWebUrl', () => {
  it('uses the v2 disasters endpoint with the fixed appname constant', () => {
    const u = buildReliefWebUrl();
    expect(u).toContain('https://api.reliefweb.int/v2/disasters');
    expect(u).toContain(`appname=${RELIEFWEB_APPNAME}`);
    expect(RELIEFWEB_APPNAME).toBe('dcs98');
  });

  it('requests the docs-confirmed fields and sorts by date desc', () => {
    const u = buildReliefWebUrl();
    const dec = decodeURIComponent(u);
    expect(dec).toContain('sort[]=date:desc');
    for (const f of ['name', 'country', 'date', 'url', 'status', 'primary_type']) {
      expect(dec).toContain(`fields[include][]=${f}`);
    }
  });

  it('caps limit at the ReliefWeb 1000/call ceiling', () => {
    const dec = decodeURIComponent(buildReliefWebUrl());
    const m = dec.match(/limit=(\d+)/)!;
    expect(Number(m[1])).toBeLessThanOrEqual(1000);
  });
});

describe('fetchReliefWeb — appname-pending graceful path', () => {
  it('returns [] (does not throw) on a 403 (appname not yet approved)', async () => {
    // Mimic the live 403 we observed with appname=dcs98 ("not using an approved appname").
    vi.mocked(safeFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 403, error: { message: 'not approved appname' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      })
    );
    await expect(fetchReliefWeb({})).resolves.toEqual([]);
  });

  it('returns [] (does not throw) when safeFetch itself rejects (DNS/network failure)', async () => {
    vi.mocked(safeFetch).mockRejectedValueOnce(new Error('cannot resolve api.reliefweb.int'));
    await expect(fetchReliefWeb({})).resolves.toEqual([]);
  });
});

describe('ensureThreatLayerId (R10 — reliefweb)', () => {
  it('accepts reliefweb', () => {
    expect(ensureThreatLayerId('reliefweb')).toBe('reliefweb');
  });
  it('still accepts prior ids and rejects unknown', () => {
    expect(ensureThreatLayerId('usgs')).toBe('usgs');
    expect(() => ensureThreatLayerId('relief')).toThrow();
    expect(() => ensureThreatLayerId('../reliefweb')).toThrow();
  });
});
