# GeoINT geo-XML formats + Mail actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add KML / GPX / generic-XML GeoINT feed formats, and Mail Delete(→Trash) / Forward / Star / Print actions, shipping as v3.14.0-beta.9.

**Architecture:** Workstream A adds three pure parsers to the existing `feeds.ts` (reusing its `XMLParser` instance, helpers, and coordinate guards) plus a dot-path `getPath` helper, with a per-source `xmlMap` config for the generic case; the renderer dropdown and validator widen to match. Workstream B adds one IMAP write path (`setFlag`) and two more service functions (`deleteMessage` → Trash via special-use, `printMessage` via the offscreen-render `renderCasePdf` pattern), a pure `buildMailPrintHtml` builder, two IPC channels, and a preview-header action row. The two workstreams touch disjoint files and can be implemented in either order.

**Tech Stack:** TypeScript, React, Electron, `fast-xml-parser`, `imapflow`, `vitest`. Test runner: `pnpm test`. Typecheck: `pnpm typecheck`.

**Branch:** Create `feat/mail-geoint-beta9` off `main` before Task 0 — the current checkout is on `feat/confinement-win-t5t6-ts` (unrelated Windows-confinement work). See Task 0.

**Spec:** `docs/superpowers/specs/2026-06-14-geoint-xml-mail-actions-design.md`

---

## Task 0: Branch off main

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch from origin/main**

The spec commits (`86c8493`, `91680d1`) live on `feat/confinement-win-t5t6-ts`. Branch beta.9 work off `main` and cherry-pick the two spec commits so the plan/spec travel with the branch.

```bash
cd /dcs98
git fetch origin
git switch -c feat/mail-geoint-beta9 origin/main
git cherry-pick 86c8493 91680d1
```

Expected: branch `feat/mail-geoint-beta9` created; two spec/plan-doc commits replayed cleanly. (If the plan file itself isn't yet committed on the source branch, commit it on the new branch instead — see Task 14.)

- [ ] **Step 2: Verify a clean baseline**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; full suite green (this is the pre-change baseline).

---

# Workstream A — GeoINT: KML, GPX, generic XML

## Task 1: Widen the GeoINT source types

**Files:**
- Modify: `src/shared/post-mvp-types.ts` (the `GeoSourceType` line ~176 and `GeoSource` interface ~178)

- [ ] **Step 1: Widen `GeoSourceType` and add `GeoXmlMap` + `GeoSource.xmlMap`**

Replace the existing `export type GeoSourceType = 'rss' | 'atom' | 'geojson';` line with the widened union, and add the `GeoXmlMap` interface immediately before `export interface GeoSource`. Then add the `xmlMap?` field to `GeoSource`.

```ts
export type GeoSourceType = 'rss' | 'atom' | 'geojson' | 'kml' | 'gpx' | 'xml';

/** Dot-path field map for the generic 'xml' source type. Each value is a dot path into the
 *  fast-xml-parser object tree; attributes are addressed with the '@_' prefix (e.g. 'point.@_lat').
 *  itemsPath resolves to the repeated element (array, or a single object treated as one item). */
export interface GeoXmlMap {
  itemsPath: string;
  lat: string;
  lon: string;
  title?: string;
  summary?: string;
  link?: string;
  date?: string;
}
```

In `GeoSource`, add after the `type: GeoSourceType;` field:

```ts
  /** Present only when type === 'xml': the dot-path field map used by parseXmlMapped. */
  xmlMap?: GeoXmlMap;
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS. (Widening a union and adding an optional field is backward-compatible; `ensureGeoSource`'s narrower return type is fixed in Task 6, but it does not break typecheck yet because its literal return type is assignable to the wider `GeoSourceType`.)

- [ ] **Step 3: Commit**

```bash
git add src/shared/post-mvp-types.ts
git commit -m "feat(geoint): widen GeoSourceType for kml/gpx/xml + GeoXmlMap"
```

---

## Task 2: `getPath` dot-path helper

**Files:**
- Modify: `src/main/geoint/feeds.ts` (add helper near the top, after `txt`)
- Test: `test/geoint-feeds-xml.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/geoint-feeds-xml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getPath } from '../src/main/geoint/feeds';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test geoint-feeds-xml`
Expected: FAIL — `getPath` is not exported from `feeds.ts`.

- [ ] **Step 3: Implement `getPath` in `feeds.ts`**

Add this exported function in `src/main/geoint/feeds.ts`, immediately after the `txt` helper (around line 22):

```ts
/** Walk a dot-path into a fast-xml-parser object tree. Attributes are addressed with the
 *  '@_' prefix. When a node is an array (repeated XML element), index into [0] before applying
 *  the next key. Rejects prototype-polluting segments so a hostile map can't traverse the
 *  prototype chain. Returns undefined on any missing link. */
const PROTO_BLOCKLIST = new Set(['__proto__', 'constructor', 'prototype']);
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (PROTO_BLOCKLIST.has(seg)) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test geoint-feeds-xml`
Expected: PASS (all 5 `getPath` cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/geoint/feeds.ts test/geoint-feeds-xml.test.ts
git commit -m "feat(geoint): getPath dot-path helper with prototype guard"
```

---

## Task 3: `parseKml`

**Files:**
- Modify: `src/main/geoint/feeds.ts`
- Test: `test/geoint-feeds-xml.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/geoint-feeds-xml.test.ts`:

```ts
import { parseKml } from '../src/main/geoint/feeds';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test geoint-feeds-xml`
Expected: FAIL — `parseKml` is not exported.

- [ ] **Step 3: Implement `parseKml`**

Add to `src/main/geoint/feeds.ts` after `parseGeoJson`. It reuses `xml`, `arr`, `txt`, `clip`, `MAX_FEED_ITEMS`, `classify`, and the `Geocoder` type.

```ts
/** True iff lat/lon are finite and on-globe — the same guard parseGeoJson applies, so a
 *  garbage coordinate never becomes a silently-mislocated 'geo' pin. */
function inRange(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function parseKml(body: string, sourceId: string, _geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  const root = doc?.kml?.Document ?? doc?.kml?.Folder ?? doc?.kml ?? {};
  // Placemarks can sit directly under the root or one level down inside Folder(s).
  const direct = arr(root.Placemark);
  const nested = arr(root.Folder).flatMap((f: Record<string, unknown>) => arr(f.Placemark));
  const placemarks = [...direct, ...nested] as Record<string, any>[];
  const out: GeoItem[] = [];
  for (const pm of placemarks.slice(0, MAX_FEED_ITEMS)) {
    const coordStr = pm?.Point?.coordinates;
    if (coordStr == null) continue; // LineString/Polygon placemarks: no single pin in v1
    const [lonS, latS] = String(coordStr).trim().split(',');
    const lon = Number(lonS);
    const lat = Number(latS);
    if (!inRange(lat, lon)) continue;
    const title = txt(pm.name) || 'Untitled';
    const summary = txt(pm.description);
    out.push({
      id: randomUUID(),
      sourceId,
      title,
      summary: summary || undefined,
      lat,
      lon,
      located: 'geo',
      ...classify(title, summary)
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test geoint-feeds-xml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/geoint/feeds.ts test/geoint-feeds-xml.test.ts
git commit -m "feat(geoint): parseKml (Point placemarks, range-guarded)"
```

---

## Task 4: `parseGpx`

**Files:**
- Modify: `src/main/geoint/feeds.ts`
- Test: `test/geoint-feeds-xml.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/geoint-feeds-xml.test.ts`:

```ts
import { parseGpx } from '../src/main/geoint/feeds';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test geoint-feeds-xml`
Expected: FAIL — `parseGpx` is not exported.

- [ ] **Step 3: Implement `parseGpx`**

Add to `src/main/geoint/feeds.ts` after `parseKml`:

```ts
export function parseGpx(body: string, sourceId: string, _geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  // Waypoints only in v1. Tracks (trk/trkseg/trkpt) and routes (rte/rtept) are paths, not pins.
  const wpts = arr(doc?.gpx?.wpt) as Record<string, any>[];
  const out: GeoItem[] = [];
  for (const w of wpts.slice(0, MAX_FEED_ITEMS)) {
    const lat = Number(w['@_lat']);
    const lon = Number(w['@_lon']);
    if (!inRange(lat, lon)) continue;
    const title = txt(w.name) || 'Waypoint';
    const summary = txt(w.desc);
    out.push({
      id: randomUUID(),
      sourceId,
      title,
      summary: summary || undefined,
      lat,
      lon,
      located: 'geo',
      ...classify(title, summary)
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test geoint-feeds-xml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/geoint/feeds.ts test/geoint-feeds-xml.test.ts
git commit -m "feat(geoint): parseGpx (waypoints, range-guarded)"
```

---

## Task 5: `parseXmlMapped`

**Files:**
- Modify: `src/main/geoint/feeds.ts`
- Test: `test/geoint-feeds-xml.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/geoint-feeds-xml.test.ts`:

```ts
import { parseXmlMapped } from '../src/main/geoint/feeds';
import type { GeoXmlMap } from '@shared/post-mvp-types';

const CUSTOM = `<?xml version="1.0"?>
<root><records>
  <record><label>Cam A</label><pos lat="40.0" lon="-3.0"/></record>
  <record><label>Mali office</label><pos/></record>
</records></root>`;

const MAP: GeoXmlMap = { itemsPath: 'root.records.record', lat: 'pos.@_lat', lon: 'pos.@_lon', title: 'label' };
const mali = (t: string) => (t.includes('Mali') ? { lat: 17, lon: -4, name: 'Mali' } : null);

describe('parseXmlMapped', () => {
  it('locates items with mapped coordinates', () => {
    const items = parseXmlMapped(CUSTOM, 's3', MAP, mali);
    const a = items.find((i) => i.title === 'Cam A')!;
    expect(a).toMatchObject({ lat: 40, lon: -3, located: 'geo' });
  });
  it('falls back to the gazetteer when coords are absent', () => {
    const items = parseXmlMapped(CUSTOM, 's3', MAP, mali);
    const m = items.find((i) => i.title === 'Mali office')!;
    expect(m).toMatchObject({ lat: 17, lon: -4, located: 'gazetteer', place: 'Mali' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test geoint-feeds-xml`
Expected: FAIL — `parseXmlMapped` is not exported.

- [ ] **Step 3: Implement `parseXmlMapped`**

Add to `src/main/geoint/feeds.ts` after `parseGpx`. It reuses `getPath`, `arr`, `txt`, `locate`, `classify`, `MAX_FEED_ITEMS`, `inRange`, and `GeoXmlMap`. Add `GeoXmlMap` to the existing type import at the top of the file.

At the top of `feeds.ts`, change the type import to include `GeoXmlMap`:

```ts
import type { GeoItem, GeoSourceType, GeoXmlMap } from '@shared/post-mvp-types';
```

Then add the parser:

```ts
export function parseXmlMapped(body: string, sourceId: string, map: GeoXmlMap, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, unknown>;
  const items = arr(getPath(doc, map.itemsPath)) as Record<string, unknown>[];
  return items.slice(0, MAX_FEED_ITEMS).map((it) => {
    const title = map.title ? txt(getPath(it, map.title)) : 'Untitled';
    const summary = map.summary ? txt(getPath(it, map.summary)) : '';
    const lat = Number(getPath(it, map.lat));
    const lon = Number(getPath(it, map.lon));
    const geo = inRange(lat, lon) ? { lat, lon } : null;
    return {
      id: randomUUID(),
      sourceId,
      title: title || 'Untitled',
      link: map.link ? txt(getPath(it, map.link)) || undefined : undefined,
      summary: summary || undefined,
      published: map.date ? txt(getPath(it, map.date)) || undefined : undefined,
      ...locate(title, summary, geo, geocode),
      ...classify(title, summary)
    };
  });
}
```

Note: `locate` already returns `{lat, lon, located:'geo'}` for a non-null `geo`, or runs the gazetteer otherwise — identical to the RSS path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test geoint-feeds-xml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/geoint/feeds.ts test/geoint-feeds-xml.test.ts
git commit -m "feat(geoint): parseXmlMapped (dot-path generic XML)"
```

---

## Task 6: `detectType` kml/gpx + `fetchSource` dispatch + validator

**Files:**
- Modify: `src/main/geoint/feeds.ts` (`detectType`)
- Modify: `src/main/geoint/sources.ts` (`fetchSource`, `addSource`)
- Modify: `src/main/security/validate.ts` (`ensureGeoSource`)
- Test: `test/geoint-feeds-xml.test.ts` (append) and `test/geoint-feeds.test.ts` is unaffected

- [ ] **Step 1: Write the failing test**

Append to `test/geoint-feeds-xml.test.ts`:

```ts
import { detectType } from '../src/main/geoint/feeds';

describe('detectType (kml/gpx)', () => {
  it('detects kml and gpx by extension', () => {
    expect(detectType('http://x/places.kml', '')).toBe('kml');
    expect(detectType('http://x/track.gpx', '')).toBe('gpx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test geoint-feeds-xml`
Expected: FAIL — `detectType` returns `'rss'` for `.kml`/`.gpx`.

- [ ] **Step 3: Update `detectType`**

In `src/main/geoint/feeds.ts`, modify `detectType` — add the two extension checks at the top of the function body, before the `.geojson/.json` check:

```ts
export function detectType(url: string, body: string): GeoSourceType {
  const u = url.toLowerCase();
  if (u.endsWith('.kml')) return 'kml';
  if (u.endsWith('.gpx')) return 'gpx';
  if (u.endsWith('.geojson') || u.endsWith('.json')) return 'geojson';
  const head = body.slice(0, 512).toLowerCase();
  if (head.includes('<feed') && head.includes('atom')) return 'atom';
  if (head.trimStart().startsWith('{') || head.includes('"featurecollection"')) return 'geojson';
  return 'rss';
}
```

- [ ] **Step 4: Update `fetchSource` dispatch in `sources.ts`**

In `src/main/geoint/sources.ts`, update the import line and the parser dispatch. Change the import:

```ts
import { parseRss, parseAtom, parseGeoJson, parseKml, parseGpx, parseXmlMapped, detectType } from './feeds';
```

Replace the `const items = …` dispatch in `fetchSource` with:

```ts
    const items =
      type === 'geojson' ? parseGeoJson(body, id)
      : type === 'kml' ? parseKml(body, id, geo)
      : type === 'gpx' ? parseGpx(body, id, geo)
      : type === 'xml' ? (s.xmlMap ? parseXmlMapped(body, id, s.xmlMap, geo) : [])
      : type === 'atom' ? parseAtom(body, id, geo)
      : detectType(s.url, body) === 'atom' ? parseAtom(body, id, geo)
      : parseRss(body, id, geo);
```

- [ ] **Step 5: Thread `xmlMap` through `addSource`/`importSources`**

In `src/main/geoint/sources.ts`, widen `addSource`'s input type and pass `xmlMap`:

```ts
export async function addSource(input: { label: string; url: string; type: GeoSourceType; xmlMap?: GeoSource['xmlMap'] }): Promise<GeoSource> {
  const list = await readSources();
  const s: GeoSource = { id: randomUUID(), label: input.label, url: input.url, type: input.type, enabled: true, xmlMap: input.xmlMap };
  list.push(s);
  await writeSources(list);
  return s;
}
```

(`importSources` is OPML-only and never carries `xmlMap`, so it is unchanged.)

- [ ] **Step 6: Widen `ensureGeoSource` in `validate.ts`**

Replace `ensureGeoSource` (around line 517) with:

```ts
const GEO_SOURCE_TYPES = ['rss', 'atom', 'geojson', 'kml', 'gpx', 'xml'] as const;
type GeoSourceTypeLit = (typeof GEO_SOURCE_TYPES)[number];

function ensureXmlMap(v: unknown): import('@shared/post-mvp-types').GeoXmlMap {
  if (!v || typeof v !== 'object') throw new ValidationError('xml source requires an xmlMap object');
  const o = v as Record<string, unknown>;
  const reqStr = (k: string): string => {
    const x = o[k];
    if (typeof x !== 'string' || x.trim().length === 0 || x.length > 200) {
      throw new ValidationError(`xmlMap.${k} must be a 1-200 char string`);
    }
    return x.trim();
  };
  const optStr = (k: string): string | undefined => {
    const x = o[k];
    if (x === undefined) return undefined;
    if (typeof x !== 'string' || x.length > 200) throw new ValidationError(`xmlMap.${k} must be a string up to 200 chars`);
    return x.trim() || undefined;
  };
  return {
    itemsPath: reqStr('itemsPath'),
    lat: reqStr('lat'),
    lon: reqStr('lon'),
    title: optStr('title'),
    summary: optStr('summary'),
    link: optStr('link'),
    date: optStr('date')
  };
}

export function ensureGeoSource(v: unknown): { label: string; url: string; type: GeoSourceTypeLit; xmlMap?: import('@shared/post-mvp-types').GeoXmlMap } {
  if (!v || typeof v !== 'object') throw new ValidationError('source must be an object');
  const o = v as { label?: unknown; url?: unknown; type?: unknown; xmlMap?: unknown };
  if (typeof o.label !== 'string' || o.label.trim().length === 0 || o.label.length > 200) {
    throw new ValidationError('source.label must be a 1-200 char string');
  }
  if (typeof o.url !== 'string') throw new ValidationError('source.url must be a string');
  const url = validateExternalUrl(o.url);
  if (!isPublicHttpUrl(url)) throw new ValidationError('source.url must be a public http(s) URL (not loopback/private)');
  if (typeof o.type !== 'string' || !GEO_SOURCE_TYPES.includes(o.type as GeoSourceTypeLit)) {
    throw new ValidationError('source.type invalid');
  }
  const type = o.type as GeoSourceTypeLit;
  if (type === 'xml') return { label: o.label.trim(), url, type, xmlMap: ensureXmlMap(o.xmlMap) };
  return { label: o.label.trim(), url, type };
}
```

- [ ] **Step 7: Write a validator test**

Append to `test/geoint-feeds-xml.test.ts`:

```ts
import { ensureGeoSource } from '../src/main/security/validate';

describe('ensureGeoSource (xml)', () => {
  it('accepts an xml source with a valid xmlMap', () => {
    const r = ensureGeoSource({ label: 'X', url: 'https://example.com/d.xml', type: 'xml', xmlMap: { itemsPath: 'a.b', lat: 'la', lon: 'lo' } });
    expect(r.type).toBe('xml');
    expect(r.xmlMap).toMatchObject({ itemsPath: 'a.b', lat: 'la', lon: 'lo' });
  });
  it('rejects an xml source missing xmlMap', () => {
    expect(() => ensureGeoSource({ label: 'X', url: 'https://example.com/d.xml', type: 'xml' })).toThrow();
  });
  it('accepts kml/gpx without an xmlMap', () => {
    expect(ensureGeoSource({ label: 'K', url: 'https://example.com/p.kml', type: 'kml' }).type).toBe('kml');
  });
});
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm test geoint-feeds-xml && pnpm typecheck`
Expected: PASS (detectType, validator cases) and clean typecheck.

- [ ] **Step 9: Commit**

```bash
git add src/main/geoint/feeds.ts src/main/geoint/sources.ts src/main/security/validate.ts test/geoint-feeds-xml.test.ts
git commit -m "feat(geoint): detectType kml/gpx, fetch dispatch, xmlMap validation"
```

---

## Task 7: GeoINT renderer — dropdown + XML map inputs

**Files:**
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx` (draft state ~line 77, dropdown ~line 358, add handler ~line 115)

- [ ] **Step 1: Widen the `draft` state shape**

Find the `const [draft, setDraft] = useState<{ label: string; url: string; type: GeoSourceType }>(...)` (around line 77) and add `xmlMap`:

```ts
  const [draft, setDraft] = useState<{ label: string; url: string; type: GeoSourceType; xmlMap?: import('@shared/post-mvp-types').GeoXmlMap }>({ label: '', url: '', type: 'rss' });
```

- [ ] **Step 2: Add KML/GPX/XML options and the conditional map inputs**

Find the `<select>` for source type (the line containing `<option value="rss">RSS</option>...`). Replace its option list to add the three new entries:

```tsx
              <option value="rss">RSS</option><option value="atom">Atom</option><option value="geojson">GeoJSON</option>
              <option value="kml">KML</option><option value="gpx">GPX</option><option value="xml">XML (custom)</option>
```

Immediately after the row that contains this `<select>` (after the add-source form row), add the conditional mapping block. Use the same `ga98-text` input style already used by the label/url inputs in this component:

```tsx
            {draft.type === 'xml' && (
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 2, marginTop: 4 }}>
                {(['itemsPath', 'lat', 'lon', 'title', 'summary', 'link', 'date'] as const).map((k) => (
                  <Fragment key={k}>
                    <label style={{ fontSize: 11 }}>{k}{(k === 'itemsPath' || k === 'lat' || k === 'lon') ? ' *' : ''}</label>
                    <input
                      className="ga98-text"
                      value={draft.xmlMap?.[k] ?? ''}
                      placeholder={k === 'itemsPath' ? 'root.records.record' : k === 'lat' ? 'pos.@_lat' : ''}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        xmlMap: { itemsPath: '', lat: '', lon: '', ...d.xmlMap, [k]: e.target.value }
                      }))}
                    />
                  </Fragment>
                ))}
              </div>
            )}
```

`Fragment` must be imported. Add it to the existing `react` import at the top of the file (e.g. `import { Fragment, useState, useEffect } from 'react';` — merge with whatever is already imported).

- [ ] **Step 3: Gate the Add button and send `xmlMap` only for xml**

Find the add-source handler (around line 115, `try { await window.api.geoint.addSource(draft); ... }`). Replace the `addSource` call so an `xml` source without the three required fields is blocked and non-xml sources don't carry a stray `xmlMap`:

```ts
    const isXml = draft.type === 'xml';
    if (isXml && !(draft.xmlMap?.itemsPath && draft.xmlMap?.lat && draft.xmlMap?.lon)) {
      toast.error('XML source needs itemsPath, lat and lon paths.');
      return;
    }
    try {
      await window.api.geoint.addSource(isXml ? draft : { label: draft.label, url: draft.url, type: draft.type });
      setDraft({ label: '', url: '', type: 'rss' });
      await load();
    }
```

(If `toast` is not already imported in this file, import it: `import { toast } from '../../state/toasts';` — check the existing imports first; GeoIntModule already surfaces errors, so it likely is.)

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS. If the inline `import('@shared/...')` type is awkward, hoist `GeoXmlMap` into the file's existing top-of-file type import from `@shared/post-mvp-types` and use the bare name.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/GeoIntModule.tsx
git commit -m "feat(geoint): KML/GPX/XML dropdown + xml dot-path map inputs"
```

---

# Workstream B — Mail: Delete, Forward, Star, Print

## Task 8: `MailMessageSummary.flagged` + `fetchInbox`

**Files:**
- Modify: `src/shared/post-mvp-types.ts` (`MailMessageSummary` ~line 24)
- Modify: `src/main/services/mail.ts` (`fetchInbox` ~line 160)
- Test: `test/mail-actions.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/mail-actions.test.ts` (mirrors the imapflow-mock style of `test/mail-fetch-inbox.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { method: string; args: unknown[] }[] = [];
let MBOX_EXISTS = 0;
let MESSAGES: Array<{ uid: number; seq: number; subject: string; flags: Set<string>; date: Date }> = [];
let MAILBOXES: Array<{ path: string; specialUse?: string }> = [];

function rec(method: string) {
  return vi.fn((...args: unknown[]) => { calls.push({ method, args }); return Promise.resolve(undefined); });
}

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    mailboxOpen: vi.fn().mockResolvedValue({ exists: MBOX_EXISTS }),
    list: vi.fn(() => Promise.resolve(MAILBOXES)),
    messageFlagsAdd: rec('messageFlagsAdd'),
    messageFlagsRemove: rec('messageFlagsRemove'),
    messageMove: rec('messageMove'),
    fetch: vi.fn(() => (async function* () {
      for (const m of MESSAGES) yield { uid: m.uid, seq: m.seq, envelope: { subject: m.subject, from: [], to: [] }, internalDate: m.date, flags: m.flags };
    })())
  }))
}));

import * as accountStore from '../src/main/storage/accounts';
import { secretStore } from '../src/main/secrets';
import { fetchInbox } from '../src/main/services/mail';

const ACCT = { id: 'a1', label: 'T', imapHost: 'h', imapPort: 993, imapSecure: true, smtpHost: 's', smtpPort: 465, smtpSecure: true, user: 'me@example.com', passwordRef: 'ref' };

beforeEach(() => {
  calls.length = 0;
  MAILBOXES = [];
  vi.spyOn(accountStore, 'listAccounts').mockResolvedValue([ACCT] as never);
  vi.spyOn(secretStore, 'get').mockResolvedValue('pw');
});

describe('fetchInbox flagged', () => {
  it('sets flagged from the \\Flagged flag', async () => {
    MBOX_EXISTS = 1;
    MESSAGES = [{ uid: 7, seq: 1, subject: 's', flags: new Set(['\\Flagged']), date: new Date('2026-06-14T00:00:00Z') }];
    const out = await fetchInbox('a1', 30);
    expect(out[0].flagged).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mail-actions`
Expected: FAIL — `setFlag`/`deleteMessage` are not exported and `flagged` is undefined.

- [ ] **Step 3: Add `flagged` to the type and `fetchInbox`**

In `src/shared/post-mvp-types.ts`, add to `MailMessageSummary` (after `unseen: boolean;`):

```ts
  /** Whether the message carries the IMAP \Flagged flag (the ★ star). */
  flagged: boolean;
```

In `src/main/services/mail.ts` `fetchInbox`, add `flagged` to the pushed summary object (after the `unseen:` line):

```ts
        unseen: !(msg.flags?.has('\\Seen') ?? false),
        flagged: msg.flags?.has('\\Flagged') ?? false
```

Also, the two fallback returns in `fetchMessage` construct `MailMessage` objects without `flagged`; add `flagged: false` to each of the three `MailMessage` returns in `fetchMessage` (the aborted/oversize return ~line 209, the parse-failed return ~line 232, and the success return ~line 261) to satisfy the type.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test mail-actions && pnpm typecheck`
Expected: the `fetchInbox flagged` test PASSES (it's the only describe block so far; `setFlag`/`deleteMessage` describe blocks and their imports arrive in Tasks 9–10). Typecheck PASSES — the test imports only `fetchInbox`, and all three `MailMessage` returns in `fetchMessage` now carry `flagged`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/post-mvp-types.ts src/main/services/mail.ts test/mail-actions.test.ts
git commit -m "feat(mail): MailMessageSummary.flagged from \\Flagged"
```

---

## Task 9: `setFlag` service

**Files:**
- Modify: `src/main/services/mail.ts`
- Test: `test/mail-actions.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/mail-actions.test.ts` (the `import` adds `setFlag` now that it will exist):

```ts
import { setFlag } from '../src/main/services/mail';

describe('setFlag', () => {
  it('adds the flag when value is true', async () => {
    await setFlag('a1', 7, '\\Flagged', true);
    const c = calls.find((x) => x.method === 'messageFlagsAdd')!;
    expect(c.args[0]).toBe('7');
    expect(c.args[1]).toEqual(['\\Flagged']);
  });
  it('removes the flag when value is false', async () => {
    await setFlag('a1', 7, '\\Flagged', false);
    expect(calls.some((x) => x.method === 'messageFlagsRemove')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mail-actions`
Expected: FAIL — `setFlag` not exported.

- [ ] **Step 3: Implement `setFlag`**

Add to `src/main/services/mail.ts` (after `fetchMessage`, before `sendMail`):

```ts
export async function setFlag(id: string, uid: number, flag: string, value: boolean): Promise<void> {
  const { acct, password } = await loadAccountWithPassword(id);
  const client = makeImapClient({
    host: acct.imapHost, port: acct.imapPort, secure: acct.imapSecure, user: acct.user, pass: password
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const range = String(uid);
    if (value) await client.messageFlagsAdd(range, [flag], { uid: true });
    else await client.messageFlagsRemove(range, [flag], { uid: true });
  } finally {
    await safeLogout(client);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mail-actions`
Expected: PASS (both setFlag cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mail.ts test/mail-actions.test.ts
git commit -m "feat(mail): setFlag service (star via \\Flagged)"
```

---

## Task 10: `deleteMessage` → Trash

**Files:**
- Modify: `src/main/services/mail.ts`
- Test: `test/mail-actions.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/mail-actions.test.ts` (the `import` adds `deleteMessage` now that it will exist):

```ts
import { deleteMessage } from '../src/main/services/mail';

describe('deleteMessage', () => {
  it('moves to the special-use \\Trash mailbox', async () => {
    MAILBOXES = [{ path: 'INBOX' }, { path: 'Bin', specialUse: '\\Trash' }];
    await deleteMessage('a1', 7);
    const c = calls.find((x) => x.method === 'messageMove')!;
    expect(c.args[0]).toBe('7');
    expect(c.args[1]).toBe('Bin');
  });
  it('falls back to a common Trash name when no special-use is set', async () => {
    MAILBOXES = [{ path: 'INBOX' }, { path: '[Gmail]/Trash' }];
    await deleteMessage('a1', 7);
    expect(calls.find((x) => x.method === 'messageMove')!.args[1]).toBe('[Gmail]/Trash');
  });
  it('throws and moves nothing when no Trash folder exists', async () => {
    MAILBOXES = [{ path: 'INBOX' }];
    await expect(deleteMessage('a1', 7)).rejects.toThrow(/Trash/);
    expect(calls.some((x) => x.method === 'messageMove')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mail-actions`
Expected: FAIL — `deleteMessage` not exported.

- [ ] **Step 3: Implement `deleteMessage`**

Add to `src/main/services/mail.ts` after `setFlag`:

```ts
/** Common Trash mailbox names, in priority order, for servers that don't advertise a
 *  \Trash special-use. */
const TRASH_NAMES = ['Trash', '[Gmail]/Trash', 'Deleted Items', 'Deleted Messages', 'Deleted'];

export async function deleteMessage(id: string, uid: number): Promise<void> {
  const { acct, password } = await loadAccountWithPassword(id);
  const client = makeImapClient({
    host: acct.imapHost, port: acct.imapPort, secure: acct.imapSecure, user: acct.user, pass: password
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const boxes = await client.list();
    const bySpecial = boxes.find((b) => b.specialUse === '\\Trash');
    const byName = boxes.find((b) => TRASH_NAMES.includes(b.path));
    const trash = bySpecial?.path ?? byName?.path;
    if (!trash) throw new Error('No Trash folder found on this account — delete from webmail.');
    await client.messageMove(String(uid), trash, { uid: true });
  } finally {
    await safeLogout(client);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mail-actions`
Expected: PASS (all three deleteMessage cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mail.ts test/mail-actions.test.ts
git commit -m "feat(mail): deleteMessage moves to Trash (special-use + name fallback)"
```

---

## Task 11: `buildMailPrintHtml` pure builder

**Files:**
- Create: `src/main/services/mail-html.ts`
- Test: `test/mail-html.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/mail-html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMailPrintHtml } from '../src/main/services/mail-html';
import type { MailMessage } from '@shared/post-mvp-types';

const base: MailMessage = {
  uid: 1, from: 'a@x.com', to: 'b@y.com', subject: 'Hello', date: '2026-06-14T00:00:00Z',
  preview: '', unseen: false, flagged: false, body: 'plain body text', attachments: []
};

describe('buildMailPrintHtml', () => {
  it('includes From, Subject and body', () => {
    const html = buildMailPrintHtml(base);
    expect(html).toContain('a@x.com');
    expect(html).toContain('Hello');
    expect(html).toContain('plain body text');
  });
  it('escapes a <script> in subject or body (XSS guard)', () => {
    const html = buildMailPrintHtml({ ...base, subject: '<script>alert(1)</script>', body: '<script>evil()</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('lists attachment filenames with a not-printed note', () => {
    const html = buildMailPrintHtml({ ...base, attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', size: 10 }] });
    expect(html).toContain('a.pdf');
    expect(html).toContain('not printed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mail-html`
Expected: FAIL — module `mail-html.ts` does not exist.

- [ ] **Step 3: Implement `buildMailPrintHtml`**

Create `src/main/services/mail-html.ts`:

```ts
/**
 * Pure HTML builder for printing a single mail message. No Electron import → unit-testable,
 * mirroring report-html.ts. EVERY field is HTML-escaped: the body is untrusted email content,
 * so this escaping is the XSS guard for the offscreen print window (which also runs with
 * javascript:false as defense in depth). The plaintext body is rendered — never msg.html.
 */
import type { MailMessage } from '@shared/post-mvp-types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildMailPrintHtml(msg: MailMessage): string {
  const date = (() => { try { return new Date(msg.date).toLocaleString(); } catch { return msg.date; } })();
  const atts = msg.attachments.length
    ? `<div class="att"><b>Attachments (not printed):</b> ${msg.attachments.map((a) => esc(a.filename)).join(', ')}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(msg.subject)}</title>
<style>
  body { font-family: 'Times New Roman', serif; margin: 24px; color: #000; }
  .hdr { border-bottom: 1px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .hdr div { margin: 2px 0; }
  .att { margin-top: 8px; font-size: 12px; }
  pre { white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px; }
</style></head><body>
<div class="hdr">
  <div><b>From:</b> ${esc(msg.from)}</div>
  <div><b>To:</b> ${esc(msg.to)}</div>
  <div><b>Subject:</b> ${esc(msg.subject)}</div>
  <div><b>Date:</b> ${esc(date)}</div>
</div>
<pre>${esc(msg.body)}</pre>
${atts}
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mail-html`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mail-html.ts test/mail-html.test.ts
git commit -m "feat(mail): buildMailPrintHtml pure builder (escaped, plaintext body)"
```

---

## Task 12: `printMessage` service (Electron)

**Files:**
- Modify: `src/main/services/mail.ts`

No unit test (the Electron print path is not unit-testable, matching `renderCasePdf`). The builder it depends on is covered by Task 11.

- [ ] **Step 1: Add imports to `mail.ts`**

At the top of `src/main/services/mail.ts`, add:

```ts
import { BrowserWindow, app } from 'electron';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMailPrintHtml } from './mail-html';
```

(`randomUUID` and `basename` are already imported from `node:crypto`/`node:path`; only add what's missing — `writeFile`/`rm` from `node:fs/promises`, `join` from `node:path`, and the electron + builder imports.)

- [ ] **Step 2: Implement `printMessage`**

Add to `src/main/services/mail.ts` after `deleteMessage`:

```ts
/** Print one message via the native print dialog. Re-fetches the message (so we print the real
 *  server content, with fetchMessage's size caps), renders the pure HTML into a short-lived
 *  offscreen sandboxed window, and calls webContents.print. Mirrors renderCasePdf in export.ts.
 *  A user-cancelled dialog is NOT an error. */
export async function printMessage(id: string, uid: number): Promise<void> {
  const msg = await fetchMessage(id, uid);
  const html = buildMailPrintHtml(msg);
  // Plaintext HTML must live OFF the encrypted-vault surface (same rationale as renderCasePdf):
  // a crash before the finally-rm must not strand mail content inside dataRoot.
  const tmp = join(app.getPath('temp'), `ga98-mailprint-${randomUUID().slice(0, 8)}.html`);
  await writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  });
  const watchdog = setTimeout(() => { try { win.destroy(); } catch { /* gone */ } }, 60_000);
  try {
    await win.loadFile(tmp);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ printBackground: true }, (ok, reason) => {
        if (ok || reason === 'cancelled') resolve();
        else reject(new Error(reason || 'print failed'));
      });
    });
  } finally {
    clearTimeout(watchdog);
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* gone */ }
    await rm(tmp, { force: true });
  }
}
```

- [ ] **Step 3: Verify typecheck + existing tests**

Run: `pnpm typecheck && pnpm test mail-actions mail-html`
Expected: typecheck clean; the mail test suites still pass (importing `mail.ts`, which now pulls `electron` — vitest does not execute `printMessage`, so the electron import is fine at module load as long as it isn't invoked; if vitest errors on the `electron` import at module-eval time, the test files only import named functions and tree-shaking does not apply — see note). 

NOTE on the electron import: `test/mail-actions.test.ts` imports `mail.ts`, which now `import { BrowserWindow, app } from 'electron'`. Electron is available as a dependency; importing the names does not instantiate anything. If the test runner cannot resolve `electron` in the node test environment, add to `test/mail-actions.test.ts` and `test/mail-fetch-inbox.test.ts` a top-level `vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { getPath: () => '/tmp' } }));`. Apply this mock only if the suite errors on the electron import.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/mail.ts
git commit -m "feat(mail): printMessage via offscreen webContents.print"
```

---

## Task 13: Mail IPC wiring + validators + renderer

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (mail channels ~line 119)
- Modify: `src/preload/index.ts` (mail API ~line 148) and `src/preload/api.d.ts`
- Modify: `src/main/security/validate.ts` (add `ensureUid`, `ensureMailFlag`)
- Modify: `src/main/ipc/register.ts` (mail handlers ~line 701; import `ensureUid`, `ensureMailFlag`)
- Modify: `src/renderer/modules/mail/MailModule.tsx`
- Test: `test/mail-actions.test.ts` (append validator tests)

- [ ] **Step 1: Add channels**

In `src/shared/ipc-contracts.ts`, inside the `mail: { … }` block, after `saveAttachment: 'mail:saveAttachment'`, add (mind the trailing comma on the previous line):

```ts
    deleteMessage: 'mail:deleteMessage',
    setFlag: 'mail:setFlag',
    printMessage: 'mail:printMessage'
```

- [ ] **Step 2: Add preload bindings**

In `src/preload/index.ts`, inside the `mail: { … }` object, after the `saveAttachment` binding, add:

```ts
    deleteMessage: (id: string, uid: number) => ipcRenderer.invoke(channels.mail.deleteMessage, id, uid),
    setFlag: (id: string, uid: number, flag: string, value: boolean) => ipcRenderer.invoke(channels.mail.setFlag, id, uid, flag, value),
    printMessage: (id: string, uid: number) => ipcRenderer.invoke(channels.mail.printMessage, id, uid)
```

In `src/preload/api.d.ts`, add matching type signatures to the `mail` interface:

```ts
    deleteMessage(id: string, uid: number): Promise<void>;
    setFlag(id: string, uid: number, flag: string, value: boolean): Promise<void>;
    printMessage(id: string, uid: number): Promise<void>;
```

- [ ] **Step 3: Add validators (failing test first)**

Append to `test/mail-actions.test.ts`:

```ts
import { ensureUid, ensureMailFlag } from '../src/main/security/validate';

describe('mail validators', () => {
  it('ensureUid accepts a non-negative integer', () => {
    expect(ensureUid(7)).toBe(7);
  });
  it('ensureUid rejects negatives and non-integers', () => {
    expect(() => ensureUid(-1)).toThrow();
    expect(() => ensureUid(1.5)).toThrow();
    expect(() => ensureUid('7')).toThrow();
  });
  it('ensureMailFlag accepts \\Flagged and rejects arbitrary strings', () => {
    expect(ensureMailFlag('\\Flagged')).toBe('\\Flagged');
    expect(() => ensureMailFlag('\\Deleted')).toThrow();
    expect(() => ensureMailFlag('anything')).toThrow();
  });
});
```

Run: `pnpm test mail-actions`
Expected: FAIL — validators not exported.

- [ ] **Step 4: Implement the validators**

In `src/main/security/validate.ts`, add (near the other `ensure*` helpers):

```ts
/** A mail message UID as it crosses IPC: a safe non-negative integer. Guards the destructive
 *  delete/print paths against a malformed renderer arg. */
export function ensureUid(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ValidationError('Invalid mail uid');
  return v;
}

/** The only IMAP flags the renderer is allowed to toggle. */
const ALLOWED_MAIL_FLAGS = ['\\Flagged', '\\Seen'];
export function ensureMailFlag(v: unknown): string {
  if (typeof v !== 'string' || !ALLOWED_MAIL_FLAGS.includes(v)) throw new ValidationError('Invalid mail flag');
  return v;
}
```

Run: `pnpm test mail-actions`
Expected: PASS (validator cases).

- [ ] **Step 5: Register the IPC handlers**

In `src/main/ipc/register.ts`, add `ensureUid, ensureMailFlag` to the existing import from `../security/validate` (line 53). Then after the `channels.mail.saveAttachment` handler (around line 719+), add:

```ts
  safeHandle(channels.mail.deleteMessage, (...a) => mail.deleteMessage(a[0] as string, ensureUid(a[1])));
  safeHandle(channels.mail.setFlag, (...a) => mail.setFlag(a[0] as string, ensureUid(a[1]), ensureMailFlag(a[2]), a[3] === true));
  safeHandle(channels.mail.printMessage, (...a) => mail.printMessage(a[0] as string, ensureUid(a[1])));
```

- [ ] **Step 6: Renderer — list star + preview action row**

In `src/renderer/modules/mail/MailModule.tsx`:

(a) In the inbox list item, show the star. Replace the unseen-dot span (the `<span style={{ width: 8 }}>{m.unseen ? '●' : ''}</span>` line) with:

```tsx
                  <span style={{ width: 16 }}>{m.unseen ? '●' : ''}{m.flagged ? <span style={{ color: '#d4a017' }}>★</span> : ''}</span>
```

(b) Add an action handler set and the action row. Inside the `MailModule` component, add these handlers (near `openMessage`):

```ts
  async function toggleStar(): Promise<void> {
    if (!activeId || !selected) return;
    const next = !selected.flagged;
    try {
      await window.api.mail.setFlag(activeId, selected.uid, '\\Flagged', next);
      setSelected((s) => (s ? { ...s, flagged: next } : s));
      setInbox((list) => list.map((m) => (m.uid === selected.uid ? { ...m, flagged: next } : m)));
    } catch (err) {
      toast.error(`Could not update star: ${(err as Error).message}`);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!activeId || !selected) return;
    const ok = await confirmDialog('Move this message to Trash?', 'Delete message');
    if (!ok) return;
    const uid = selected.uid;
    try {
      await window.api.mail.deleteMessage(activeId, uid);
      setSelected(null);
      setInbox((list) => list.filter((m) => m.uid !== uid));
      toast.success('Moved to Trash.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  function forwardSelected(): void {
    if (!activeId || !selected) return;
    const subj = selected.subject.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject}`;
    const attNote = selected.attachments.length
      ? `\n[Note: ${selected.attachments.length} original attachment(s) not carried over — open the source message to retrieve them.]`
      : '';
    const body = `\n\n---------- Forwarded message ----------\nFrom: ${selected.from}\nDate: ${new Date(selected.date).toLocaleString()}\nSubject: ${selected.subject}\n\n${selected.body}${attNote}`;
    openCompose({
      id: `dr-${crypto.randomUUID()}`,
      accountId: activeId,
      to: '',
      subject: subj,
      body,
      attachments: [],
      savedAt: new Date().toISOString()
    });
  }

  async function printSelected(): Promise<void> {
    if (!activeId || !selected) return;
    try {
      await window.api.mail.printMessage(activeId, selected.uid);
    } catch (err) {
      toast.error(`Print failed: ${(err as Error).message}`);
    }
  }
```

(c) Render the action row inside the message-preview block, immediately after the opening `<>` of the `selected ?` branch and before the header `<div>`:

```tsx
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <button onClick={() => void toggleStar()}>{selected.flagged ? 'Unstar' : 'Star'}</button>
                <button onClick={() => forwardSelected()}>Forward</button>
                <button onClick={() => void printSelected()}>Print</button>
                <button onClick={() => void deleteSelected()}>Delete</button>
              </div>
```

- [ ] **Step 7: Run full test suite + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; full suite green (geoint-feeds-xml, mail-actions, mail-html, plus all prior suites).

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/main/security/validate.ts src/main/ipc/register.ts src/renderer/modules/mail/MailModule.tsx test/mail-actions.test.ts
git commit -m "feat(mail): wire delete/star/print IPC + preview action row (forward/print/star/delete)"
```

---

## Task 14: Release — version, docs, sound-asset note

**Files:**
- Modify: `package.json` (version)
- Modify: `README.md` (Status line, changelog, version strings, test count)
- Create: `RELEASE_NOTES_v3.14.0-beta.9.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "3.14.0-beta.8"` to `"version": "3.14.0-beta.9"`.

- [ ] **Step 2: Update README**

In `README.md`, update the version/status strings to `3.14.0-beta.9`, add a changelog entry summarizing: GeoINT KML/GPX/generic-XML feed formats; Mail Delete(→Trash)/Forward/Star/Print. Update the test count to the new total (run `pnpm test` and read the final passed-count, then set it).

- [ ] **Step 3: Write the release notes**

Create `RELEASE_NOTES_v3.14.0-beta.9.md` covering:
- GeoINT: KML and GPX feed sources; a generic XML source with a dot-path field map (itemsPath/lat/lon + optional title/summary/link/date).
- Mail: Star (★), Forward (quoted body), Delete (→ Trash, recoverable), Print (native print dialog).
- v1 limits: GPX parses waypoints only (not tracks/routes); Forward carries body text only (server-side attachments are not re-attached); Print renders the plaintext body only (XSS-safe).
- **Manual step:** to use a custom "You've got mail" chime, replace `src/renderer/assets/mail-notify.wav` with your own `.wav` before building. (The chime already fires on newly-arrived unseen mail when Settings → sound is enabled.)

- [ ] **Step 4: Verify the build is releasable**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; full suite green. Record the final test count and confirm it matches the README.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md RELEASE_NOTES_v3.14.0-beta.9.md docs/superpowers/plans/2026-06-14-geoint-xml-mail-actions.md
git commit -m "chore(release): v3.14.0-beta.9 — GeoINT geo-XML + Mail actions"
```

---

## Final verification (whole branch)

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test` green; new suites present: `geoint-feeds-xml`, `mail-actions`, `mail-html`.
- [ ] Manual smoke (operator, on a built/dev run):
  - GeoINT: add a `.kml` and a `.gpx` source → pins appear; add an `xml` source with a dot-path map → pins appear.
  - Mail: star/unstar (★ shows in list, survives Get-mail); Delete → message moves to Trash and survives in webmail; Forward opens Compose with `Fwd:` + quoted body; Print opens the native dialog, cancel shows no error.
- [ ] Charter: no new egress (GeoINT fetch still gated on `settings.geoint.networkEnabled`; mail unchanged), no telemetry.
