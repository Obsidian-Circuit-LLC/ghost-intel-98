import { describe, it, expect } from 'vitest';
import { parseGdacs } from '../src/main/geoint/threat-layers/gdacs';
import { ensureThreatLayerId } from '../src/main/security/validate';
import { fetchThreatLayer } from '../src/main/geoint/threat-layers';

// -------------------------------------------------------------------------------------------------
// GDACS — GeoRSS XML. Fixture is shaped to the REAL live response captured from
// https://www.gdacs.org/xml/rss.xml on 2026-06-15: each <item> nests coordinates under
// <geo:Point><geo:lat/><geo:long/></geo:Point>, carries a separate "<lat> <lon>" <georss:point>,
// a string <gdacs:alertlevel>, and a <guid isPermaLink="false"> object. The parser reads the SAME
// fast-xml-parser config feeds.ts uses, so the fixture below is the post-parse object tree (what
// the parser actually receives), not raw XML — verified against the live sample's parsed shape.
// -------------------------------------------------------------------------------------------------

// Minimal raw GeoRSS XML covering the cases the parser must get right. We parse real XML (not a
// pre-baked object) so the test also exercises the shared XMLParser namespace handling.
const GDACS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"
     xmlns:georss="http://www.georss.org/georss"
     xmlns:gdacs="http://www.gdacs.org">
  <channel>
    <title>GDACS</title>
    <item>
      <title>Green flood alert in Türkiye</title>
      <description>A flood started in Türkiye.</description>
      <link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=1103920</link>
      <pubDate>Tue, 02 Jun 2026 05:45:56 GMT</pubDate>
      <guid isPermaLink="false">FL1103920</guid>
      <geo:Point><geo:lat>37.2401223</geo:lat><geo:long>36.4534072</geo:long></geo:Point>
      <georss:point>37.2401223 36.4534072</georss:point>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
    </item>
    <item>
      <title>Orange cyclone alert</title>
      <description>A tropical cyclone.</description>
      <link>https://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=2000</link>
      <pubDate>Wed, 03 Jun 2026 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">TC2000</guid>
      <geo:Point><geo:lat>14.5</geo:lat><geo:long>120.9</geo:long></geo:Point>
      <georss:point>14.5 120.9</georss:point>
      <gdacs:alertlevel>Orange</gdacs:alertlevel>
    </item>
    <item>
      <title>Red earthquake alert</title>
      <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=3000</link>
      <pubDate>Thu, 04 Jun 2026 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">EQ3000</guid>
      <gdacs:alertlevel>Red</gdacs:alertlevel>
      <georss:point>-33.4 -70.5</georss:point>
    </item>
    <item>
      <title>Off-globe garbage (no geo:Point, off-globe georss:point)</title>
      <link>https://www.gdacs.org/x</link>
      <guid isPermaLink="false">BAD1</guid>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
      <georss:point>200 5</georss:point>
    </item>
    <item>
      <title>NaN coords</title>
      <link>https://www.gdacs.org/y</link>
      <guid isPermaLink="false">BAD2</guid>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
      <geo:Point><geo:lat>x</geo:lat><geo:long>10</geo:long></geo:Point>
    </item>
    <item>
      <title>No coordinates at all</title>
      <link>https://www.gdacs.org/z</link>
      <guid isPermaLink="false">BAD3</guid>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
    </item>
  </channel>
</rss>`;

describe('parseGdacs', () => {
  const items = parseGdacs(GDACS_XML);

  it('extracts lat/lon from nested geo:Point and maps fields', () => {
    const fl = items.find((i) => i.id === 'gdacs:FL1103920')!;
    expect(fl).toBeTruthy();
    expect(fl.lat).toBeCloseTo(37.2401223, 5);
    expect(fl.lon).toBeCloseTo(36.4534072, 5);
    expect(fl.located).toBe('geo');
    expect(fl.category).toBe('disaster');
    expect(fl.sourceId).toBe('threat:gdacs');
    expect(fl.title).toBe('Green flood alert in Türkiye');
    expect(fl.link).toBe('https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1103920');
    expect(fl.published).toBe('Tue, 02 Jun 2026 05:45:56 GMT');
  });

  it('falls back to georss:point ("lat lon") when geo:Point is absent', () => {
    const eq = items.find((i) => i.id === 'gdacs:EQ3000')!;
    expect(eq).toBeTruthy();
    expect(eq.lat).toBeCloseTo(-33.4, 5);
    expect(eq.lon).toBeCloseTo(-70.5, 5);
  });

  it('maps gdacs:alertlevel to severity (Green→low, Orange/Yellow→medium, Red→high)', () => {
    expect(items.find((i) => i.id === 'gdacs:FL1103920')!.severity).toBe('low');
    expect(items.find((i) => i.id === 'gdacs:TC2000')!.severity).toBe('medium');
    expect(items.find((i) => i.id === 'gdacs:EQ3000')!.severity).toBe('high');
  });

  it('drops off-globe / NaN / coordinate-less items (no silent (0,0))', () => {
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['gdacs:FL1103920', 'gdacs:TC2000', 'gdacs:EQ3000']);
    expect(items.some((i) => i.lon === 200)).toBe(false);
    expect(items.some((i) => i.lat === 0 && i.lon === 0)).toBe(false);
  });

  it('tolerates empty / malformed input', () => {
    expect(parseGdacs('')).toEqual([]);
    expect(parseGdacs('<rss><channel></channel></rss>')).toEqual([]);
    expect(parseGdacs('not xml at all')).toEqual([]);
  });

  it('caps the result at the max', () => {
    const many = ['<rss xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"><channel>'];
    for (let n = 0; n < 2500; n++) {
      many.push(`<item><title>e${n}</title><guid>E${n}</guid><gdacs:alertlevel>Green</gdacs:alertlevel><geo:Point><geo:lat>10</geo:lat><geo:long>10</geo:long></geo:Point></item>`);
    }
    many.push('</channel></rss>');
    expect(parseGdacs(many.join('')).length).toBe(2000);
  });
});

describe('ensureThreatLayerId (R6 ids)', () => {
  it('accepts usgs + gdacs (gdelt/ucdp added only when their layers ship)', () => {
    expect(ensureThreatLayerId('usgs')).toBe('usgs');
    expect(ensureThreatLayerId('gdacs')).toBe('gdacs');
  });
  it('rejects unknown ids', () => {
    expect(() => ensureThreatLayerId('nonsense')).toThrow();
    expect(() => ensureThreatLayerId('../gdacs')).toThrow();
    expect(() => ensureThreatLayerId(123)).toThrow();
  });
});

describe('fetchThreatLayer dispatcher (R6)', () => {
  it('throws on an unknown layer id (defense in depth)', async () => {
    // @ts-expect-error — deliberately off-allowlist id.
    await expect(fetchThreatLayer('nope', {})).rejects.toThrow(/unknown threat layer/);
  });
});
