import { describe, it, expect } from 'vitest';
import { parseWarTracker } from '../src/main/geoint/threat-layers/war-tracker';
import { parseGdelt, buildGdeltUrl } from '../src/main/geoint/threat-layers/gdelt';
import { ensureThreatLayerId } from '../src/main/security/validate';

// =================================================================================================
// war-tracker — per-point JSON. Fixture is the REAL live response captured 2026-06-15 from
// GET https://war-tracker.com/api/v1/events?country=UA&limit=3 (browser User-Agent; the endpoint
// 402s a Node/curl default UA but returns 200 for browser-like callers — the documented free
// tier). Per-event shape: { id, url, date, modified, event_type, location, country, country_name,
// lat (number), lng (number), has_media, is_video, source_url (often null), confidence (string),
// description }. Top-level: { events[], next_cursor, count, has_more }.
// =================================================================================================

const WT_LIVE = {
  events: [
    {
      id: 785328,
      url: 'https://war-tracker.com/share/785328/security-incident-donbas-ukraine',
      date: '2026-06-15T14:06:40',
      modified: '2026-06-15T14:06:43',
      event_type: 'Security Incident',
      location: 'Donbas, Ukraine',
      country: 'UA',
      country_name: 'Ukraine',
      lat: 48.0159,
      lng: 37.8028,
      has_media: true,
      is_video: true,
      source_url: null,
      confidence: 'LOW',
      description: 'Frames from the crash site of a Tu-22m3 aircraft in the Donbas region of Ukraine.'
    },
    {
      id: 785249,
      url: 'https://war-tracker.com/share/785249/civilian-protest-kyiv-ukraine',
      date: '2026-06-15T13:47:34',
      modified: '2026-06-15T13:47:34',
      event_type: 'Civilian Protest',
      location: 'Kyiv, Ukraine',
      country: 'UA',
      country_name: 'Ukraine',
      lat: 50.45,
      lng: 30.52,
      has_media: true,
      is_video: false,
      source_url: 'https://t.me/example/123',
      confidence: 'MEDIUM',
      description: 'Clashes erupted in Kyiv between protesters and authorities.'
    },
    {
      id: 785248,
      url: 'https://war-tracker.com/share/785248/military-offensive-slavyansk-ukraine',
      date: '2026-06-15T13:46:58',
      event_type: 'Military Offensive',
      location: 'Slavyansk, Ukraine',
      country: 'UA',
      country_name: 'Ukraine',
      lat: 48.8667,
      lng: 37.7667,
      has_media: true,
      is_video: true,
      source_url: null,
      confidence: 'HIGH',
      description: 'Russian Southern grouping claims superiority on the Slavyansk front.'
    }
  ],
  next_cursor: 'eyJmIjp7ImNvdW50cnkiOiJVQSJ9LCJvIjozfQ',
  count: 3,
  has_more: true
};

describe('parseWarTracker', () => {
  const items = parseWarTracker(WT_LIVE);

  it('maps lat/lng → lat/lon and core fields', () => {
    const inc = items.find((i) => i.id === 'wartracker:785328')!;
    expect(inc).toBeTruthy();
    expect(inc.lat).toBeCloseTo(48.0159, 4);
    expect(inc.lon).toBeCloseTo(37.8028, 4);
    expect(inc.located).toBe('geo');
    expect(inc.category).toBe('chatter');
    expect(inc.sourceId).toBe('threat:wartracker');
    // title: prefer location.
    expect(inc.title).toBe('Donbas, Ukraine');
    // link: source_url is null → fall back to canonical url.
    expect(inc.link).toBe('https://war-tracker.com/share/785328/security-incident-donbas-ukraine');
    expect(inc.published).toBe('2026-06-15T14:06:40');
  });

  it('uses source_url for link when present', () => {
    const p = items.find((i) => i.id === 'wartracker:785249')!;
    expect(p.link).toBe('https://t.me/example/123');
  });

  it('maps confidence → severity (LOW→low, MEDIUM→medium, HIGH→high)', () => {
    expect(items.find((i) => i.id === 'wartracker:785328')!.severity).toBe('low');
    expect(items.find((i) => i.id === 'wartracker:785249')!.severity).toBe('medium');
    expect(items.find((i) => i.id === 'wartracker:785248')!.severity).toBe('high');
  });

  it('falls back to low severity for unknown/missing confidence', () => {
    const out = parseWarTracker({ events: [{ id: 9, lat: 1, lng: 2, confidence: 'weird' }] });
    expect(out[0].severity).toBe('low');
  });

  it('drops events with out-of-range / NaN / missing coordinates (no silent (0,0))', () => {
    const out = parseWarTracker({
      events: [
        { id: 1, lat: 200, lng: 5, location: 'offglobe' },
        { id: 2, lat: 'x', lng: 10, location: 'nan' },
        { id: 3, location: 'nocoords' },
        { id: 4, lat: 0, lng: 0, location: 'nullisland' }, // (0,0) is technically in-range; keep
        { id: 5, lat: 10, lng: 20, location: 'ok' }
      ]
    });
    const ids = out.map((i) => i.id);
    expect(ids).toContain('wartracker:5');
    expect(ids).not.toContain('wartracker:1');
    expect(ids).not.toContain('wartracker:2');
    expect(ids).not.toContain('wartracker:3');
  });

  it('derives a title when location absent (event_type, then description slice)', () => {
    const out = parseWarTracker({
      events: [
        { id: 1, lat: 1, lng: 2, event_type: 'Airstrike' },
        { id: 2, lat: 1, lng: 2, description: 'A'.repeat(300) }
      ]
    });
    expect(out.find((i) => i.id === 'wartracker:1')!.title).toBe('Airstrike');
    expect(out.find((i) => i.id === 'wartracker:2')!.title.length).toBeLessThanOrEqual(140);
  });

  it('skips events without a stable id', () => {
    const out = parseWarTracker({ events: [{ lat: 1, lng: 2, location: 'x' }] });
    expect(out).toEqual([]);
  });

  it('tolerates malformed input', () => {
    expect(parseWarTracker(null)).toEqual([]);
    expect(parseWarTracker({})).toEqual([]);
    expect(parseWarTracker({ events: 'nope' })).toEqual([]);
  });

  it('caps the result at the max', () => {
    const events = [];
    for (let n = 0; n < 2500; n++) events.push({ id: n, lat: 10, lng: 10, location: `e${n}` });
    expect(parseWarTracker({ events }).length).toBe(2000);
  });
});

// =================================================================================================
// GDELT DOC 2.0 — artlist JSON. Fixture is the REAL live response captured 2026-06-15 from
// https://api.gdeltproject.org/api/v2/doc/doc?query=conflict&mode=artlist&format=json&timespan=24h
// Per-article shape: { url, url_mobile, title, seendate ("YYYYMMDDTHHMMSSZ"), socialimage, domain,
// language, sourcecountry (country NAME like "South Korea") }. DOC gives NO per-article lat/lon —
// geo is COUNTRY-LEVEL only, via sourcecountry resolved to a country centroid by the gazetteer.
// =================================================================================================

const GDELT_LIVE = {
  articles: [
    {
      url: 'https://biz.heraldcorp.com/article/10772072',
      url_mobile: '',
      title: '수원시 , 공공갈등관리 공직자 30명 양성',
      seendate: '20260615T074500Z',
      socialimage: 'https://example.com/a.jpg',
      domain: 'biz.heraldcorp.com',
      language: 'Korean',
      sourcecountry: 'South Korea'
    },
    {
      url: 'https://baomoi.com/trung-dong-t45367702.epi',
      url_mobile: '',
      title: 'Tin tức Trung Đông',
      seendate: '20260615T133000Z',
      socialimage: '',
      domain: 'baomoi.com',
      language: 'Vietnamese',
      sourcecountry: 'Vietnam'
    },
    {
      url: 'https://www.politika.rs/scc/clanak/763312/x',
      url_mobile: '',
      title: 'Командант Луфтвафеа',
      seendate: '20260615T111500Z',
      socialimage: '',
      domain: 'politika.rs',
      language: 'Serbian',
      sourcecountry: 'Serbia'
    },
    // No sourcecountry → must be dropped (no fake (0,0)).
    {
      url: 'https://example.org/no-country',
      title: 'No country article',
      seendate: '20260615T120000Z',
      domain: 'example.org',
      language: 'English'
    },
    // Unresolvable country → dropped.
    {
      url: 'https://example.org/atlantis',
      title: 'Atlantis news',
      seendate: '20260615T120000Z',
      domain: 'example.org',
      language: 'English',
      sourcecountry: 'Atlantis Republic'
    }
  ]
};

// Deterministic mock geocoder: only the three real countries resolve; everything else is null.
const COUNTRY_COORD: Record<string, { lat: number; lon: number; name: string }> = {
  'South Korea': { lat: 37, lon: 127.5, name: 'South Korea' },
  Vietnam: { lat: 16.1666, lon: 107.8333, name: 'Vietnam' },
  Serbia: { lat: 44, lon: 21, name: 'Serbia' }
};
const mockGeocode = (name: string): { lat: number; lon: number; name: string } | null =>
  COUNTRY_COORD[name] ?? null;

describe('parseGdelt', () => {
  const items = parseGdelt(GDELT_LIVE, mockGeocode);

  it('resolves sourcecountry → country centroid (located:geo)', () => {
    expect(items.length).toBe(3); // two undroppable were dropped
    const kr = items.find((i) => i.title.startsWith('수원시'))!;
    expect(kr).toBeTruthy();
    expect(kr.lat).toBe(37);
    expect(kr.lon).toBe(127.5);
    expect(kr.located).toBe('geo');
    expect(kr.category).toBe('chatter');
    expect(kr.severity).toBe('low');
    expect(kr.sourceId).toBe('threat:gdelt');
    expect(kr.link).toBe('https://biz.heraldcorp.com/article/10772072');
    expect(kr.published).toBe('20260615T074500Z');
  });

  it('drops articles whose country cannot be resolved (no (0,0))', () => {
    expect(items.some((i) => i.title === 'Atlantis news')).toBe(false);
    expect(items.some((i) => i.title === 'No country article')).toBe(false);
    expect(items.some((i) => i.lat === 0 && i.lon === 0)).toBe(false);
  });

  it('mints a stable id from the url hash with the gdelt: prefix', () => {
    for (const i of items) expect(i.id).toMatch(/^gdelt:[0-9a-f]+$/);
    // Same url → same id (deterministic).
    const a = parseGdelt(GDELT_LIVE, mockGeocode);
    expect(a.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('tolerates malformed input', () => {
    expect(parseGdelt(null, mockGeocode)).toEqual([]);
    expect(parseGdelt({}, mockGeocode)).toEqual([]);
    expect(parseGdelt({ articles: 'nope' }, mockGeocode)).toEqual([]);
  });

  it('caps the result at the max', () => {
    const articles = [];
    for (let n = 0; n < 2500; n++) articles.push({ url: `https://x/${n}`, title: `t${n}`, sourcecountry: 'Serbia' });
    expect(parseGdelt({ articles }, mockGeocode).length).toBe(2000);
  });
});

describe('buildGdeltUrl (query encoding + bounding)', () => {
  it('encodeURIComponents the user query', () => {
    const u = buildGdeltUrl({ query: 'kyiv & "front line"' });
    expect(u).toContain('query=' + encodeURIComponent('kyiv & "front line"'));
    expect(u).toContain('mode=artlist');
    expect(u).toContain('format=json');
  });

  it('length-bounds an over-long query', () => {
    const u = buildGdeltUrl({ query: 'a'.repeat(1000) });
    const m = u.match(/query=([^&]*)/)![1];
    // decoded query must be capped (<= the module bound)
    expect(decodeURIComponent(m).length).toBeLessThanOrEqual(256);
  });

  it('falls back to a default query when empty', () => {
    const u = buildGdeltUrl({ query: '' });
    expect(u).toMatch(/query=[^&]+/);
  });
});

describe('ensureThreatLayerId (R7 ids)', () => {
  it('accepts usgs, gdacs, wartracker, gdelt', () => {
    expect(ensureThreatLayerId('usgs')).toBe('usgs');
    expect(ensureThreatLayerId('gdacs')).toBe('gdacs');
    expect(ensureThreatLayerId('wartracker')).toBe('wartracker');
    expect(ensureThreatLayerId('gdelt')).toBe('gdelt');
  });
  it('rejects unknown ids', () => {
    expect(() => ensureThreatLayerId('nonsense')).toThrow();
    expect(() => ensureThreatLayerId('../gdelt')).toThrow();
    expect(() => ensureThreatLayerId(123)).toThrow();
  });
});
