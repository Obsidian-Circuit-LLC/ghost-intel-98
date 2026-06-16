import { describe, it, expect } from 'vitest';
import { parseFirms, splitCsvLine, buildFirmsUrl, fetchFirms, isFirmsSource, DEFAULT_FIRMS_SOURCE } from '../src/main/geoint/threat-layers/firms';
import { parseGdeltCloud, buildGdeltCloudUrl, fetchGdeltCloud } from '../src/main/geoint/threat-layers/gdeltcloud';
import { parseUcdp, buildUcdpUrl, fetchUcdp } from '../src/main/geoint/threat-layers/ucdp';
import { ensureThreatLayerId, ensureKeyedLayerId, ensureLayerKey, isKeyedLayerId } from '../src/main/security/validate';

// =================================================================================================
// KEYED GeoINT threat layers — FIRMS, gdeltcloud, UCDP. Parsers are built to the PUBLISHED provider
// schemas (docs read 2026-06-15); fixtures below mirror those documented shapes. None of these were
// live-verified against a real key/token (we have no keys) — the fixtures are docs-derived, not
// captured responses. See each layer module's header for the doc URLs.
// =================================================================================================

// ---------- FIRMS (NASA active fire — CSV) ----------
// Documented VIIRS attribute header (lowercased CSV export, with the `instrument` column the live
// NRT export carries between satellite and confidence):
//   latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,
//   version,bright_ti5,frp,daynight
const FIRMS_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '35.6800,139.6900,330.1,0.4,0.4,2026-06-15,0312,N,VIIRS,h,2.0NRT,295.0,12.5,D',   // high (confidence h)
  '-33.4000,-70.5000,310.0,0.4,0.4,2026-06-15,0500,1,VIIRS,n,2.0NRT,290.0,8.0,N',    // medium (n)
  '10.0000,20.0000,300.0,0.4,0.4,2026-06-15,0600,N,VIIRS,l,2.0NRT,288.0,2.0,D',       // low (l)
  '5.0000,5.0000,400.0,0.4,0.4,2026-06-15,0700,N,VIIRS,n,2.0NRT,300.0,250.0,D',       // nominal but FRP>=100 → high
  '200.0000,5.0000,300.0,0.4,0.4,2026-06-15,0800,N,VIIRS,n,2.0NRT,288.0,1.0,D',       // out-of-range lat → DROP
  'x,5.0000,300.0,0.4,0.4,2026-06-15,0900,N,VIIRS,n,2.0NRT,288.0,1.0,D'               // NaN lat → DROP
].join('\n');

describe('splitCsvLine', () => {
  it('splits plain fields', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('honours quoted fields with embedded commas', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
  it('handles escaped quotes', () => {
    expect(splitCsvLine('"a""b",c')).toEqual(['a"b', 'c']);
  });
});

describe('parseFirms', () => {
  const items = parseFirms(FIRMS_CSV);

  it('maps latitude/longitude columns by header name (not position)', () => {
    const a = items[0];
    expect(a.lat).toBe(35.68);
    expect(a.lon).toBe(139.69);
    expect(a.located).toBe('geo');
    expect(a.category).toBe('disaster');
    expect(a.title).toBe('Active fire');
    expect(a.sourceId).toBe('threat:firms');
  });

  it('id is prefixed firms: and stable from lat,lon,date,time', () => {
    expect(items[0].id).toBe('firms:35.68,139.69,2026-06-15,0312');
    expect(items.every((i) => i.id.startsWith('firms:'))).toBe(true);
  });

  it('composes published from acq_date + acq_time (HHMM UTC)', () => {
    expect(items[0].published).toBe('2026-06-15T03:12:00Z');
  });

  it('maps confidence h/n/l → severity high/medium/low', () => {
    expect(items[0].severity).toBe('high');   // h
    expect(items[1].severity).toBe('medium'); // n
    expect(items[2].severity).toBe('low');    // l
  });

  it('escalates to high when FRP >= 100 even if confidence is nominal', () => {
    expect(items[3].severity).toBe('high');
  });

  it('drops out-of-range and NaN coordinates (no (0,0) pins)', () => {
    expect(items).toHaveLength(4);
    expect(items.some((i) => i.lat === 0 && i.lon === 0)).toBe(false);
  });

  it('returns [] on an unrecognised header (no latitude column)', () => {
    expect(parseFirms('foo,bar\n1,2')).toEqual([]);
  });

  it('caps at 2000 items', () => {
    const header = 'latitude,longitude,acq_date,acq_time,confidence,frp';
    const rows = Array.from({ length: 2100 }, (_, i) => `${(i % 80) - 40}.5,${(i % 170) - 85}.5,2026-06-15,0300,n,1.0`);
    const big = parseFirms([header, ...rows].join('\n'));
    expect(big.length).toBe(2000);
  });
});

describe('buildFirmsUrl', () => {
  it('uses the default source + world + dayRange 1, key url-encoded into the path', () => {
    expect(buildFirmsUrl('KEY123', {})).toBe(
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY123/VIIRS_SNPP_NRT/world/1'
    );
  });
  it('only allowlisted sources are interpolated (unknown → default)', () => {
    expect(isFirmsSource('VIIRS_SNPP_NRT')).toBe(true);
    expect(isFirmsSource('../../etc')).toBe(false);
    expect(buildFirmsUrl('K', { source: '../../etc' })).toContain(`/${DEFAULT_FIRMS_SOURCE}/`);
  });
  it('accepts a valid w,s,e,n bbox and rejects a malformed area (→ world)', () => {
    expect(buildFirmsUrl('K', { area: '-10,-10,10,10' })).toContain('/-10,-10,10,10/');
    expect(buildFirmsUrl('K', { area: 'world; rm -rf' })).toContain('/world/');
  });
});

describe('fetchFirms key-gate', () => {
  it('returns [] with no key (refuses egress) — never touches the network', async () => {
    await expect(fetchFirms('', {})).resolves.toEqual([]);
  });
});

// ---------- gdeltcloud (third-party events — JSON) ----------
// Documented response: { data: [ { id, event_date, family, category, subcategory, has_fatalities,
// fatalities, geo: { latitude, longitude, country, admin1 } } ] }.
const GDC_JSON = {
  data: [
    { id: 'e1', event_date: '2026-06-15', family: 'conflict', category: 'Battles', subcategory: 'Armed clash',
      has_fatalities: true, fatalities: 40, geo: { latitude: 48.0, longitude: 37.8, country: 'Ukraine' } }, // conflict, high
    { id: 'e2', event_date: '2026-06-14', family: 'conflict', category: 'Violence', subcategory: 'Attack',
      has_fatalities: true, fatalities: 3, geo: { latitude: 31.5, longitude: 34.5, country: 'Gaza' } },      // conflict, medium
    { id: 'e3', event_date: '2026-06-13', family: 'cameoplus', category: 'Protests', subcategory: 'Peaceful protest',
      has_fatalities: false, fatalities: 0, geo: { latitude: 51.5, longitude: -0.12, country: 'UK' } },      // chatter, low
    { id: 'bad', event_date: '2026-06-12', family: 'conflict', category: 'X',
      geo: { latitude: 200, longitude: 5, country: 'Nowhere' } },                                            // out-of-range → DROP
    { id: 'nogeo', event_date: '2026-06-12', family: 'conflict', category: 'X', geo: null },                 // no coords → DROP
    { event_date: '2026-06-12', family: 'conflict', geo: { latitude: 1, longitude: 1 } }                     // no id → DROP
  ]
};

describe('parseGdeltCloud', () => {
  const items = parseGdeltCloud(GDC_JSON);

  it('maps per-point geo.latitude/longitude', () => {
    expect(items[0].lat).toBe(48.0);
    expect(items[0].lon).toBe(37.8);
    expect(items[0].located).toBe('geo');
    expect(items[0].sourceId).toBe('threat:gdeltcloud');
    expect(items[0].id).toBe('gdeltcloud:e1');
  });

  it('category: conflict family/fatalities → conflict, else chatter', () => {
    expect(items[0].category).toBe('conflict');
    expect(items[1].category).toBe('conflict');
    expect(items[2].category).toBe('chatter');
  });

  it('severity from fatalities: >=25 high, >=1 medium, else low', () => {
    expect(items[0].severity).toBe('high');
    expect(items[1].severity).toBe('medium');
    expect(items[2].severity).toBe('low');
  });

  it('drops out-of-range coords, missing geo, and missing id (no (0,0))', () => {
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.id.startsWith('gdeltcloud:'))).toBe(true);
    expect(items.some((i) => i.lat === 0 && i.lon === 0)).toBe(false);
  });
});

describe('buildGdeltCloudUrl', () => {
  it('encodes query and validates ISO2 country', () => {
    expect(buildGdeltCloudUrl({ query: 'a b', country: 'ua' })).toBe(
      'https://gdeltcloud.com/api/v2/events?query=a+b&country=UA'
    );
    expect(buildGdeltCloudUrl({ country: 'XXX' })).toBe('https://gdeltcloud.com/api/v2/events');
  });
});

describe('fetchGdeltCloud key-gate', () => {
  it('returns [] with no key (refuses egress)', async () => {
    await expect(fetchGdeltCloud('', {})).resolves.toEqual([]);
  });
});

// ---------- UCDP GED (conflict events — JSON) ----------
// Documented envelope: { TotalCount, TotalPages, Result: [ { id, latitude, longitude, date_start,
// type_of_violence, best, country, side_a, side_b } ], NextPageUrl, PreviousPageUrl }.
const UCDP_JSON = {
  TotalCount: 4,
  Result: [
    { id: 1001, latitude: 33.3, longitude: 44.4, date_start: '2026-06-10', type_of_violence: 1, best: 30,
      country: 'Iraq', side_a: 'Government of Iraq', side_b: 'IS' },                                  // state-based, high
    { id: 1002, latitude: 9.0, longitude: 8.7, date_start: '2026-06-09', type_of_violence: 2, best: 5,
      country: 'Nigeria', side_a: 'Fulani', side_b: 'Farmers' },                                      // non-state, medium
    { id: 1003, latitude: 15.5, longitude: 32.5, date_start: '2026-06-08', type_of_violence: 3, best: 0,
      country: 'Sudan', side_a: 'RSF', side_b: 'Civilians' },                                          // one-sided, low
    { id: 'bad', latitude: 99, longitude: 5, date_start: '2026-06-07', type_of_violence: 1, best: 10 } // out-of-range → DROP
  ]
};

describe('parseUcdp', () => {
  const items = parseUcdp(UCDP_JSON);

  it('maps latitude/longitude and prefixes id with ucdp:', () => {
    expect(items[0].lat).toBe(33.3);
    expect(items[0].lon).toBe(44.4);
    expect(items[0].id).toBe('ucdp:1001');
    expect(items[0].located).toBe('geo');
    expect(items[0].category).toBe('conflict');
    expect(items[0].sourceId).toBe('threat:ucdp');
  });

  it('titles from type_of_violence + sides', () => {
    expect(items[0].title).toBe('State-based conflict: Government of Iraq vs IS');
    expect(items[1].title).toBe('Non-state conflict: Fulani vs Farmers');
    expect(items[2].title).toBe('One-sided violence: RSF vs Civilians');
  });

  it('severity from best (fatalities): >=25 high, >=1 medium, else low', () => {
    expect(items[0].severity).toBe('high');
    expect(items[1].severity).toBe('medium');
    expect(items[2].severity).toBe('low');
  });

  it('published from date_start; drops out-of-range coords (no (0,0))', () => {
    expect(items[0].published).toBe('2026-06-10');
    expect(items).toHaveLength(3);
    expect(items.some((i) => i.lat === 0 && i.lon === 0)).toBe(false);
  });
});

describe('buildUcdpUrl', () => {
  it('uses default version 26.1 and allowlists the version shape', () => {
    expect(buildUcdpUrl({})).toBe('https://ucdpapi.pcr.uu.se/api/gedevents/26.1?pagesize=1000&page=0');
    // path-injection attempt → falls back to default version
    expect(buildUcdpUrl({ version: '../../x' })).toContain('/gedevents/26.1?');
  });
});

describe('fetchUcdp key-gate', () => {
  it('returns [] with no token (refuses egress)', async () => {
    await expect(fetchUcdp('', {})).resolves.toEqual([]);
  });
});

// ---------- shared key-management validators ----------
describe('threat-layer id validators', () => {
  it('ensureThreatLayerId allows the new keyed ids', () => {
    expect(ensureThreatLayerId('firms')).toBe('firms');
    expect(ensureThreatLayerId('gdeltcloud')).toBe('gdeltcloud');
    expect(ensureThreatLayerId('ucdp')).toBe('ucdp');
    // and still allows the keyless ones
    expect(ensureThreatLayerId('usgs')).toBe('usgs');
  });

  it('ensureKeyedLayerId rejects keyless / unknown layer ids', () => {
    expect(ensureKeyedLayerId('firms')).toBe('firms');
    expect(() => ensureKeyedLayerId('usgs')).toThrow();
    expect(() => ensureKeyedLayerId('gdacs')).toThrow();
    expect(() => ensureKeyedLayerId('nonsense')).toThrow();
    expect(() => ensureKeyedLayerId(42)).toThrow();
  });

  it('isKeyedLayerId distinguishes keyed from keyless', () => {
    expect(isKeyedLayerId('firms')).toBe(true);
    expect(isKeyedLayerId('ucdp')).toBe(true);
    expect(isKeyedLayerId('usgs')).toBe(false);
  });

  it('ensureLayerKey rejects empty / non-string and bounds length', () => {
    expect(ensureLayerKey('  abc123  ')).toBe('abc123');
    expect(() => ensureLayerKey('')).toThrow();
    expect(() => ensureLayerKey('   ')).toThrow();
    expect(() => ensureLayerKey(123)).toThrow();
    expect(() => ensureLayerKey('x'.repeat(5000))).toThrow();
  });

  it('ensureLayerKey rejects CR/LF/control chars (header-injection defense)', () => {
    expect(() => ensureLayerKey('abc\r\nX-Evil: 1')).toThrow();
    expect(() => ensureLayerKey('abc\ndef')).toThrow();
    expect(() => ensureLayerKey('abc\tdef')).toThrow();
    expect(() => ensureLayerKey('abc\u007fdef')).toThrow();
    expect(ensureLayerKey('good-token_123.AB')).toBe('good-token_123.AB');
  });
});
