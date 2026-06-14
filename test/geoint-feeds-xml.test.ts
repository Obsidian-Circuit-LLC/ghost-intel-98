import { describe, it, expect } from 'vitest';
import { getPath } from '../src/main/geoint/feeds';
import { parseKml } from '../src/main/geoint/feeds';
import { parseGpx } from '../src/main/geoint/feeds';

const KML = `<?xml version="1.0"?>
<kml><Document>
  <Placemark><name>Paris</name><description>event</description>
    <Point><coordinates>2.3522,48.8566,0</coordinates></Point></Placemark>
  <Placemark><name>Bad</name><Point><coordinates>200,5</coordinates></Point></Placemark>
  <Placemark><name>Line</name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>
</Document></kml>`;

describe('parseKml', () => {
  it('parses Point placemarks ([lon,lat] coordinate string)', () => {
    const items = parseKml(KML, 's1', () => null);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Paris', summary: 'event', lat: 48.8566, lon: 2.3522, located: 'geo' });
  });
  it('drops out-of-range and non-Point placemarks', () => {
    const items = parseKml(KML, 's1', () => null);
    expect(items.map((i) => i.title)).toEqual(['Paris']);
  });
});

const GPX = `<?xml version="1.0"?>
<gpx>
  <wpt lat="51.5074" lon="-0.1278"><name>London</name><desc>cam</desc></wpt>
  <wpt lat="95" lon="0"><name>Bad lat</name></wpt>
</gpx>`;

describe('parseGpx', () => {
  it('parses waypoints from @_lat/@_lon attributes', () => {
    const items = parseGpx(GPX, 's2', () => null);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'London', summary: 'cam', lat: 51.5074, lon: -0.1278, located: 'geo' });
  });
});

describe('getPath', () => {
  it('walks nested object keys', () => {
    expect(getPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5);
  });
  it('reads @_-prefixed attribute keys', () => {
    expect(getPath({ pt: { '@_lat': '17' } }, 'pt.@_lat')).toBe('17');
  });
  it('indexes into [0] when a node is an array (fast-xml-parser repeats)', () => {
    expect(getPath({ items: [{ v: 1 }, { v: 2 }] }, 'items.v')).toBe(1);
  });
  it('returns undefined for a missing link', () => {
    expect(getPath({ a: {} }, 'a.b.c')).toBeUndefined();
  });
  it('rejects prototype-polluting segments', () => {
    expect(getPath({}, '__proto__.x')).toBeUndefined();
    expect(getPath({ a: {} }, 'a.constructor')).toBeUndefined();
    expect(getPath({ a: {} }, 'a.prototype')).toBeUndefined();
  });
});
