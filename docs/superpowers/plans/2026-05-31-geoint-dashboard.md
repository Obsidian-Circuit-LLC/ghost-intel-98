# GeoINT Dashboard (cycle 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable, offline-first geopolitical-monitoring module ("GeoINT") to Ghost Access 98 — user-curated RSS/Atom/GeoJSON sources (+ OPML import), main-process fetch/parse, offline-gazetteer geocoding, and a Leaflet map with user-configured online tiles, all behind an app-layer egress gate that is off by default.

**Architecture:** Feeds are fetched and parsed in the main process (renderer never calls out); a master `geoint.networkEnabled` flag (default false) gates every fetch and the map's tile layer. Sources + cached items persist as JSON under `dataRoot` via secure-fs. RSS/Atom/OPML parse with `fast-xml-parser`; GeoJSON via `JSON.parse`. Items without coordinates are geocoded against a bundled, real-data gazetteer (no geocoding-service egress) or pinned manually. The renderer is a split view: sources + reading list on the left, a Leaflet map (markers, manual-pin, tile placeholder when disabled) on the right.

**Tech Stack:** Electron 33, React 18, TS 5.7 strict, `fast-xml-parser` (pure-JS, main, external — verify Stage 0), `leaflet` + `@types/leaflet` (renderer, Vite-bundled), vitest, secure-fs.

**Spec:** `docs/superpowers/specs/2026-05-31-geoint-dashboard-design.md`

---

## File structure

**Create:**
- `src/main/geoint/geocode.ts` — `geocode(text)` longest-name gazetteer match (deterministic).
- `src/main/geoint/feeds.ts` — `parseRss`, `parseAtom`, `parseGeoJson`, `parseOpml`, `detectType`, `fetchSource` (egress-gated).
- `src/main/geoint/sources.ts` — source store (CRUD) + per-source item cache.
- `resources/geoint/gazetteer.json` — generated place→coords table (real data; provenance recorded).
- `scripts/gen-gazetteer.mjs` — one-shot generator from a license-clean dataset.
- `src/renderer/modules/geoint/GeoIntModule.tsx` — split view + controls.
- `src/renderer/modules/geoint/MapPane.tsx` — Leaflet map wrapper.
- `test/geoint-geocode.test.ts`, `test/geoint-feeds.test.ts`, `test/geoint-sources.test.ts`, `test/geoint-egress.test.ts`.
- `test/fixtures/geoint/{rss.xml,atom.xml,points.geojson,sources.opml}`.

**Modify:**
- `src/shared/post-mvp-types.ts` — `GeoSourceType`, `GeoSource`, `GeoItem`, `GeoSnapshot`.
- `src/shared/types.ts` — `AppSettings.geoint` + default.
- `src/main/storage/json-fs.ts` — `mergeSettings` deep-merge for `geoint`.
- `src/shared/ipc-contracts.ts` — `channels.geoint.*` + `ApiContracts`.
- `src/main/security/validate.ts` — `ensureGeoSource`, `ensureLatLon`.
- `src/main/ipc/register.ts` — `geoint.*` handlers.
- `src/preload/index.ts`, `src/preload/api.d.ts` — `window.api.geoint.*`.
- `src/renderer/state/store.ts`, `shell/ModuleHost.tsx`, `shell/Icon.tsx`, `shell/Desktop.tsx` — register `geoint`.
- `package.json` — deps; `electron.vite.config` externalize note for `fast-xml-parser`.

---

## Stage 0 — Dependencies + gazetteer (gating; NEVER fabricate coordinates)

### Task 0.1: Verify + add `fast-xml-parser` (main, pure-JS)

- [ ] **Step 1: Inspect**

Run:
```bash
npm view fast-xml-parser version dependencies
npm pack fast-xml-parser --dry-run 2>/dev/null | grep -iE '\.node$|binding\.gyp|prebuild' || echo "no native artifacts"
```
Expected: pure-JS, "no native artifacts".

- [ ] **Step 2: Add** — `pnpm add fast-xml-parser` (production dep; it's CJS/UMD so a static `import { XMLParser } from 'fast-xml-parser'` survives externalization, unlike the ESM-only music-metadata).

- [ ] **Step 3: Verify load** — `node -e "console.log(typeof require('fast-xml-parser').XMLParser)"` → `function` (write to a file + read it back if the shell display glitches).

- [ ] **Step 4: Commit** — `git add package.json pnpm-lock.yaml && git commit -m "chore(geoint): add fast-xml-parser"`.

### Task 0.2: Verify + add `leaflet` (renderer)

- [ ] **Step 1:** `pnpm add leaflet && pnpm add -D @types/leaflet`. Confirm no native artifacts (`npm pack leaflet --dry-run | grep -iE '\.node$' || echo ok`).
- [ ] **Step 2: Commit** — `git add package.json pnpm-lock.yaml && git commit -m "chore(geoint): add leaflet + types"`.

### Task 0.3: Generate the gazetteer from real data (provenance recorded)

- [ ] **Step 1: Verify a license-clean source.** Run `npm view world-countries version license` and confirm it exposes per-country `name.common`, `cca2`, `capital`, and `latlng` (`node -e "const c=require('world-countries'); console.log(c.length, c[0].name.common, c[0].latlng, c[0].capital)"`). `world-countries` is MIT/ODbL-clean. **If it lacks `latlng`/`capital` or is unavailable, STOP and source an equivalent license-clean dataset — do NOT hand-write coordinates.**

- [ ] **Step 2: Add as devDependency** — `pnpm add -D world-countries`.

- [ ] **Step 3: Write the generator** `scripts/gen-gazetteer.mjs`:

```js
// Generates resources/geoint/gazetteer.json from world-countries (MIT).
// Provenance: world-countries npm package (country name/cca2/latlng/capital).
import countries from 'world-countries' assert { type: 'json' };
import { writeFileSync, mkdirSync } from 'node:fs';

const entries = [];
for (const c of countries) {
  if (Array.isArray(c.latlng) && c.latlng.length === 2) {
    entries.push({ name: c.name.common, lat: c.latlng[0], lon: c.latlng[1] });
    if (c.cca2) entries.push({ name: c.cca2, lat: c.latlng[0], lon: c.latlng[1] });
  }
  // Capital city → use the country centroid as a coarse stand-in ONLY if no capital
  // coordinate is available. world-countries has capitalInfo.latlng for many countries:
  const cap = Array.isArray(c.capital) ? c.capital[0] : undefined;
  const capll = c.capitalInfo?.latlng;
  if (cap && Array.isArray(capll) && capll.length === 2) {
    entries.push({ name: cap, lat: capll[0], lon: capll[1] });
  }
}
mkdirSync('resources/geoint', { recursive: true });
writeFileSync('resources/geoint/gazetteer.json', JSON.stringify(entries, null, 0));
console.log(`wrote ${entries.length} gazetteer entries`);
```

- [ ] **Step 4: Generate** — `node scripts/gen-gazetteer.mjs` → expect "wrote N gazetteer entries" (N a few hundred). Verify `resources/geoint/gazetteer.json` exists and a spot-check entry is plausible (`node -e "const g=require('./resources/geoint/gazetteer.json'); console.log(g.find(e=>e.name==='France'))"`).

- [ ] **Step 5: Ensure it ships** — confirm `extraResources` or `files` includes `resources/geoint/**`; add to `package.json` build `extraResources` if not covered. The main process reads it via `process.resourcesPath` in prod / repo path in dev (see Task 2).

- [ ] **Step 6: Create a tiny test fixture** `test/fixtures/geoint/gazetteer.sample.json`:
```json
[{"name":"France","lat":46,"lon":2},{"name":"Paris","lat":48.8566,"lon":2.3522},{"name":"Mali","lat":17,"lon":-4}]
```

- [ ] **Step 7: Commit** — `git add package.json pnpm-lock.yaml scripts/gen-gazetteer.mjs resources/geoint/gazetteer.json test/fixtures/geoint/gazetteer.sample.json && git commit -m "chore(geoint): generate gazetteer from world-countries (provenance: world-countries MIT)"`.

---

## Stage 1 — Shared types + settings

### Task 1.1: Types + settings

**Files:** `src/shared/post-mvp-types.ts`, `src/shared/types.ts`, `src/main/storage/json-fs.ts`

- [ ] **Step 1: Add to `post-mvp-types.ts`**

```ts
// ---------- GeoINT ----------
export type GeoSourceType = 'rss' | 'atom' | 'geojson';
export interface GeoSource {
  id: string;
  label: string;
  url: string;
  type: GeoSourceType;
  enabled: boolean;
  lastFetched?: string;
  lastError?: string;
}
export interface GeoItem {
  id: string;
  sourceId: string;
  title: string;
  link?: string;
  summary?: string;
  published?: string;
  lat?: number;
  lon?: number;
  located: 'geo' | 'gazetteer' | 'manual' | 'none';
}
export interface GeoSnapshot { sources: GeoSource[]; items: GeoItem[] }
```

- [ ] **Step 2: Add `geoint` to `AppSettings`** (after `media`):
```ts
  geoint: {
    networkEnabled: boolean;
    tileServerUrl: string;
    tileAttribution: string;
  };
```
and to `defaultSettings`:
```ts
  geoint: { networkEnabled: false, tileServerUrl: '', tileAttribution: '' },
```

- [ ] **Step 3: Deep-merge in `mergeSettings`** (`json-fs.ts`), beside the `media` line:
```ts
    geoint: { ...base.geoint, ...(patch.geoint ?? {}) },
```

- [ ] **Step 4: Typecheck** — `pnpm typecheck` → exit 0 (fix any literal AppSettings construction).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(geoint): shared types + geoint settings (network off by default)"`.

---

## Stage 2 — Geocoder

### Task 2.1: `geocode.ts` + tests

**Files:** Create `src/main/geoint/geocode.ts`; Test `test/geoint-geocode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeGeocoder } from '../src/main/geoint/geocode';

const gaz = [
  { name: 'France', lat: 46, lon: 2 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'Mali', lat: 17, lon: -4 }
];
const geocode = makeGeocoder(gaz);

describe('geocode (gazetteer match)', () => {
  it('matches a place name in free text', () => {
    expect(geocode('Protests erupt in Paris today')).toEqual({ lat: 48.8566, lon: 2.3522 });
  });
  it('prefers the longest name match (Paris over France when both present)', () => {
    // "Paris, France" — longest token match wins deterministically
    expect(geocode('Paris, France')).toEqual({ lat: 48.8566, lon: 2.3522 });
  });
  it('is case-insensitive and word-bounded (no substring false hits)', () => {
    expect(geocode('the malimba festival')).toBeNull(); // "Mali" must not match inside "malimba"
    expect(geocode('news from MALI')).toEqual({ lat: 17, lon: -4 });
  });
  it('returns null when nothing matches', () => {
    expect(geocode('local weather update')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/main/geoint/geocode.ts
export interface GazEntry { name: string; lat: number; lon: number }
export type Geocoder = (text: string) => { lat: number; lon: number } | null;

/** Build a geocoder from a gazetteer. Matches the LONGEST place name that occurs as a
 *  whole word (case-insensitive) in `text`. Deterministic: entries are pre-sorted by
 *  descending name length, ties broken by name to keep output stable. */
export function makeGeocoder(entries: GazEntry[]): Geocoder {
  const sorted = [...entries].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  const prepared = sorted.map((e) => ({
    e,
    re: new RegExp(`(?:^|[^\\p{L}])${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu')
  }));
  return (text: string) => {
    if (!text) return null;
    for (const { e, re } of prepared) {
      if (re.test(text)) return { lat: e.lat, lon: e.lon };
    }
    return null;
  };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git add src/main/geoint/geocode.ts test/geoint-geocode.test.ts && git commit -m "feat(geoint): offline gazetteer geocoder + tests"`.

---

## Stage 3 — Feed parsers

### Task 3.1: `feeds.ts` parsers + tests

**Files:** Create `src/main/geoint/feeds.ts`; fixtures; Test `test/geoint-feeds.test.ts`

- [ ] **Step 1: Create fixtures** `test/fixtures/geoint/`:

`rss.xml`:
```xml
<?xml version="1.0"?>
<rss xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" version="2.0"><channel>
<item><title>Quake near Tokyo</title><link>http://x/1</link><description>m5</description>
<pubDate>Sat, 31 May 2026 00:00:00 GMT</pubDate><geo:lat>35.68</geo:lat><geo:long>139.69</geo:long></item>
<item><title>Unrest in Mali</title><link>http://x/2</link><description>report</description></item>
</channel></rss>
```
`atom.xml`:
```xml
<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Border tension</title><link href="http://y/1"/><summary>brief</summary><updated>2026-05-31T00:00:00Z</updated></entry>
</feed>
```
`points.geojson`:
```json
{"type":"FeatureCollection","features":[
{"type":"Feature","geometry":{"type":"Point","coordinates":[2.3522,48.8566]},"properties":{"title":"Paris event","date":"2026-05-31"}}]}
```
`sources.opml`:
```xml
<?xml version="1.0"?>
<opml version="2.0"><body>
<outline text="Wire" type="rss" xmlUrl="http://feeds/wire.xml"/>
<outline text="Quakes" xmlUrl="http://feeds/quakes.geojson"/>
</body></opml>
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRss, parseAtom, parseGeoJson, parseOpml, detectType } from '../src/main/geoint/feeds';

const fx = (n: string): string => readFileSync(resolve(__dirname, 'fixtures/geoint', n), 'utf8');
const geo = () => ({ lat: 17, lon: -4 }); // stub geocoder: everything → Mali

describe('feed parsers', () => {
  it('parses RSS incl GeoRSS coords, geocodes the rest', () => {
    const items = parseRss(fx('rss.xml'), 's1', (t) => (t.includes('Mali') ? geo() : null));
    expect(items[0]).toMatchObject({ title: 'Quake near Tokyo', lat: 35.68, lon: 139.69, located: 'geo' });
    expect(items[1]).toMatchObject({ title: 'Unrest in Mali', lat: 17, lon: -4, located: 'gazetteer' });
  });
  it('parses Atom entries', () => {
    const items = parseAtom(fx('atom.xml'), 's2', () => null);
    expect(items[0]).toMatchObject({ title: 'Border tension', link: 'http://y/1', located: 'none' });
  });
  it('parses GeoJSON point features', () => {
    const items = parseGeoJson(fx('points.geojson'), 's3');
    expect(items[0]).toMatchObject({ title: 'Paris event', lat: 48.8566, lon: 2.3522, located: 'geo' });
  });
  it('parses OPML to sources', () => {
    const srcs = parseOpml(fx('sources.opml'));
    expect(srcs).toEqual([
      { label: 'Wire', url: 'http://feeds/wire.xml', type: 'rss' },
      { label: 'Quakes', url: 'http://feeds/quakes.geojson', type: 'geojson' }
    ]);
  });
  it('detects type from URL/body', () => {
    expect(detectType('http://x/feed.geojson', '')).toBe('geojson');
    expect(detectType('http://x/feed', '<feed xmlns="http://www.w3.org/2005/Atom">')).toBe('atom');
    expect(detectType('http://x/feed', '<rss>')).toBe('rss');
  });
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** `src/main/geoint/feeds.ts`

```ts
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import type { GeoItem, GeoSourceType } from '@shared/post-mvp-types';

type Geocoder = (text: string) => { lat: number; lon: number } | null;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v));

function locate(title: string, summary: string, geo?: { lat: number; lon: number } | null, geocode?: Geocoder): Pick<GeoItem, 'lat' | 'lon' | 'located'> {
  if (geo) return { lat: geo.lat, lon: geo.lon, located: 'geo' };
  const g = geocode?.(`${title} ${summary}`);
  return g ? { lat: g.lat, lon: g.lon, located: 'gazetteer' } : { located: 'none' };
}

export function parseRss(body: string, sourceId: string, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body);
  const items = arr(doc?.rss?.channel?.item);
  return items.map((it: Record<string, unknown>) => {
    const title = txt(it['title']); const summary = txt(it['description']);
    const lat = it['geo:lat'] != null ? Number(it['geo:lat']) : undefined;
    const lon = it['geo:long'] != null ? Number(it['geo:long']) : undefined;
    const geo = lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon) ? { lat, lon } : null;
    return { id: randomUUID(), sourceId, title, link: txt(it['link']) || undefined, summary: summary || undefined,
             published: txt(it['pubDate']) || undefined, ...locate(title, summary, geo, geocode) };
  });
}

export function parseAtom(body: string, sourceId: string, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body);
  const entries = arr(doc?.feed?.entry);
  return entries.map((e: Record<string, unknown>) => {
    const title = txt(e['title']); const summary = txt(e['summary']);
    const linkEl = arr(e['link'])[0] as Record<string, unknown> | undefined;
    const link = linkEl ? String(linkEl['@_href'] ?? '') : undefined;
    return { id: randomUUID(), sourceId, title, link: link || undefined, summary: summary || undefined,
             published: txt(e['updated']) || undefined, ...locate(title, summary, null, geocode) };
  });
}

export function parseGeoJson(body: string, sourceId: string): GeoItem[] {
  const fc = JSON.parse(body) as { features?: { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[] };
  return arr(fc.features).filter((f) => f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)).map((f) => {
    const [lon, lat] = f.geometry!.coordinates as number[]; // GeoJSON is [lon,lat]
    const p = f.properties ?? {};
    return { id: randomUUID(), sourceId, title: String(p['title'] ?? p['name'] ?? 'Untitled'),
             link: typeof p['link'] === 'string' ? p['link'] : undefined,
             summary: typeof p['description'] === 'string' ? p['description'] : undefined,
             published: typeof p['date'] === 'string' ? p['date'] : undefined,
             lat, lon, located: 'geo' as const };
  });
}

export function parseOpml(body: string): { label: string; url: string; type: GeoSourceType }[] {
  const doc = xml.parse(body);
  const out: { label: string; url: string; type: GeoSourceType }[] = [];
  const walk = (nodes: unknown): void => {
    for (const n of arr(nodes) as Record<string, unknown>[]) {
      const url = n['@_xmlUrl'] as string | undefined;
      if (url) out.push({ label: String(n['@_text'] ?? n['@_title'] ?? url), url, type: detectType(url, '') });
      if (n['outline']) walk(n['outline']);
    }
  };
  walk(doc?.opml?.body?.outline);
  return out;
}

export function detectType(url: string, body: string): GeoSourceType {
  const u = url.toLowerCase();
  if (u.endsWith('.geojson') || u.endsWith('.json')) return 'geojson';
  const head = body.slice(0, 512).toLowerCase();
  if (head.includes('<feed') && head.includes('atom')) return 'atom';
  if (head.trimStart().startsWith('{') || head.includes('"featurecollection"')) return 'geojson';
  return 'rss';
}
```

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** — `git add src/main/geoint/feeds.ts test/fixtures/geoint test/geoint-feeds.test.ts && git commit -m "feat(geoint): RSS/Atom/GeoJSON/OPML parsers + tests"`.

---

## Stage 4 — Source store + gated fetch

### Task 4.1: `sources.ts` (CRUD + cache + fetchSource)

**Files:** Create `src/main/geoint/sources.ts`; Test `test/geoint-sources.test.ts`

- [ ] **Step 1: Write the failing test** (CRUD + cache round-trip; mirrors media-library test mocking)

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DATA = mkdtempSync(join(tmpdir(), 'ga98-geo-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));
import * as store from '../src/main/geoint/sources';

beforeEach(async () => { await store._resetForTest(); });

describe('geoint source store', () => {
  it('adds, lists, updates, removes sources', async () => {
    const s = await store.addSource({ label: 'Wire', url: 'https://w/feed.xml', type: 'rss' });
    expect(s.enabled).toBe(true);
    await store.updateSource(s.id, { enabled: false });
    expect((await store.listSources())[0].enabled).toBe(false);
    await store.removeSource(s.id);
    expect(await store.listSources()).toHaveLength(0);
  });
  it('caches + returns items per source', async () => {
    const s = await store.addSource({ label: 'X', url: 'https://x', type: 'rss' });
    await store.cacheItems(s.id, [{ id: 'i1', sourceId: s.id, title: 'T', located: 'none' }]);
    expect((await store.snapshot()).items).toHaveLength(1);
  });
  it('importOpml bulk-adds', async () => {
    const n = await store.importSources([
      { label: 'A', url: 'http://a', type: 'rss' },
      { label: 'B', url: 'http://b', type: 'geojson' }
    ]);
    expect(n).toBe(2);
    expect(await store.listSources()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/main/geoint/sources.ts` (mirror `streams.ts` secure-fs pattern)

```ts
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { GeoItem, GeoSource, GeoSnapshot, GeoSourceType } from '@shared/post-mvp-types';

const sourcesFile = (): string => join(dataRoot(), 'geoint-sources.json');
const cacheFile = (id: string): string => join(dataRoot(), 'geoint-cache', `${id}.json`);

async function readSources(): Promise<GeoSource[]> {
  try { return JSON.parse(await secureReadText(sourcesFile())) as GeoSource[]; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; return []; }
}
async function writeSources(list: GeoSource[]): Promise<void> { await secureWriteFile(sourcesFile(), JSON.stringify(list, null, 2)); }

export async function _resetForTest(): Promise<void> { await writeSources([]); }
export async function listSources(): Promise<GeoSource[]> { return readSources(); }

export async function addSource(input: { label: string; url: string; type: GeoSourceType }): Promise<GeoSource> {
  const list = await readSources();
  const s: GeoSource = { id: randomUUID(), label: input.label, url: input.url, type: input.type, enabled: true };
  list.push(s); await writeSources(list); return s;
}
export async function updateSource(id: string, patch: Partial<GeoSource>): Promise<void> {
  const list = await readSources();
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) { list[i] = { ...list[i], ...patch, id: list[i].id }; await writeSources(list); }
}
export async function removeSource(id: string): Promise<void> {
  await writeSources((await readSources()).filter((x) => x.id !== id));
}
export async function importSources(items: { label: string; url: string; type: GeoSourceType }[]): Promise<number> {
  const list = await readSources();
  const seen = new Set(list.map((s) => s.url.toLowerCase()));
  let added = 0;
  for (const it of items) {
    if (seen.has(it.url.toLowerCase())) continue;
    list.push({ id: randomUUID(), label: it.label, url: it.url, type: it.type, enabled: true });
    seen.add(it.url.toLowerCase()); added++;
  }
  await writeSources(list); return added;
}
export async function cacheItems(sourceId: string, items: GeoItem[]): Promise<void> {
  await secureWriteFile(cacheFile(sourceId), JSON.stringify(items, null, 2));
}
async function readCache(sourceId: string): Promise<GeoItem[]> {
  try { return JSON.parse(await secureReadText(cacheFile(sourceId))) as GeoItem[]; } catch { return []; }
}
export async function snapshot(): Promise<GeoSnapshot> {
  const sources = await readSources();
  const items: GeoItem[] = [];
  for (const s of sources) items.push(...await readCache(s.id));
  return { sources, items };
}
export async function setItemLocation(itemId: string, loc: { lat: number; lon: number } | null): Promise<void> {
  const sources = await readSources();
  for (const s of sources) {
    const items = await readCache(s.id);
    const i = items.findIndex((it) => it.id === itemId);
    if (i >= 0) {
      items[i] = loc ? { ...items[i], lat: loc.lat, lon: loc.lon, located: 'manual' } : { ...items[i], lat: undefined, lon: undefined, located: 'none' };
      await cacheItems(s.id, items); return;
    }
  }
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git add src/main/geoint/sources.ts test/geoint-sources.test.ts && git commit -m "feat(geoint): source store (CRUD + per-source item cache)"`.

### Task 4.2: gazetteer loader + `fetchSource` (egress-gated)

**Files:** Modify `src/main/geoint/sources.ts` (add `fetchSource`); create `src/main/geoint/gazetteer.ts`

- [ ] **Step 1: gazetteer loader** `src/main/geoint/gazetteer.ts`:
```ts
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { app } from 'electron';
import { makeGeocoder, type GazEntry, type Geocoder } from './geocode';

let cached: Geocoder | null = null;
function gazPath(): string {
  // Dev: repo resources/; prod: process.resourcesPath/geoint/gazetteer.json (extraResources).
  const dev = join(app.getAppPath(), 'resources', 'geoint', 'gazetteer.json');
  const prod = join(process.resourcesPath, 'geoint', 'gazetteer.json');
  try { readFileSync(dev); return dev; } catch { return prod; }
}
export function geocoder(): Geocoder {
  if (!cached) {
    try { cached = makeGeocoder(JSON.parse(readFileSync(gazPath(), 'utf8')) as GazEntry[]); }
    catch { cached = () => null; } // missing gazetteer → geocode disabled, not a crash
  }
  return cached;
}
```

- [ ] **Step 2: Add `fetchSource` to `sources.ts`** (gated by the caller; also a hard internal guard):
```ts
import { parseRss, parseAtom, parseGeoJson, detectType } from './feeds';
import { geocoder } from './gazetteer';

/** Fetch + parse + cache one source. Caller MUST pass networkEnabled; false = no-op
 *  (defense in depth — the IPC handler also checks). Never throws past here. */
export async function fetchSource(id: string, networkEnabled: boolean): Promise<{ ok: boolean; count: number }> {
  if (!networkEnabled) return { ok: false, count: 0 };
  const list = await readSources();
  const s = list.find((x) => x.id === id);
  if (!s || !s.enabled) return { ok: false, count: 0 };
  try {
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const type = s.type ?? detectType(s.url, body);
    const geo = geocoder();
    const items = type === 'geojson' ? parseGeoJson(body, id)
      : type === 'atom' ? parseAtom(body, id, geo)
      : detectType(s.url, body) === 'atom' ? parseAtom(body, id, geo)
      : parseRss(body, id, geo);
    await cacheItems(id, items);
    s.lastFetched = new Date().toISOString(); s.lastError = undefined;
    await writeSources(list);
    return { ok: true, count: items.length };
  } catch (err) {
    s.lastError = (err as Error).message; await writeSources(list);
    return { ok: false, count: 0 };
  }
}
```
(Note: `new Date().toISOString()` here is display metadata only — not correctness-critical; acceptable.)

- [ ] **Step 3: Typecheck** — `pnpm typecheck` → exit 0.
- [ ] **Step 4: Commit** — `git add src/main/geoint/gazetteer.ts src/main/geoint/sources.ts && git commit -m "feat(geoint): gazetteer loader + egress-gated fetchSource"`.

---

## Stage 5 — IPC + validators + egress-gate test

### Task 5.1: Validators

**Files:** `src/main/security/validate.ts`; covered by 5.3 test

- [ ] **Step 1: Implement** (after `ensureFeedUrl`)
```ts
export function ensureGeoSource(v: unknown): { label: string; url: string; type: 'rss' | 'atom' | 'geojson' } {
  if (!v || typeof v !== 'object') throw new ValidationError('source must be an object');
  const o = v as { label?: unknown; url?: unknown; type?: unknown };
  if (typeof o.label !== 'string' || o.label.trim().length === 0 || o.label.length > 200) throw new ValidationError('source.label must be 1-200 chars');
  if (typeof o.url !== 'string') throw new ValidationError('source.url must be a string');
  const url = validateExternalUrl(o.url);
  if (!/^https?:\/\//i.test(url)) throw new ValidationError('source.url must be http or https');
  const type = o.type;
  if (type !== 'rss' && type !== 'atom' && type !== 'geojson') throw new ValidationError('source.type invalid');
  return { label: o.label.trim(), url, type };
}
export function ensureLatLon(v: unknown): { lat: number; lon: number } | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') throw new ValidationError('location must be {lat,lon} or null');
  const o = v as { lat?: unknown; lon?: unknown };
  const lat = Number(o.lat); const lon = Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new ValidationError('lat/lon out of range');
  return { lat, lon };
}
```
- [ ] **Step 2: Commit** with 5.3.

### Task 5.2: IPC contracts + handlers + preload + api.d.ts

**Files:** `ipc-contracts.ts`, `register.ts`, `preload/index.ts`, `preload/api.d.ts`

- [ ] **Step 1: Channels** (`ipc-contracts.ts`, after `media`):
```ts
  geoint: {
    snapshot: 'geoint:snapshot',
    addSource: 'geoint:addSource',
    updateSource: 'geoint:updateSource',
    removeSource: 'geoint:removeSource',
    importOpml: 'geoint:importOpml',
    refresh: 'geoint:refresh',
    setItemLocation: 'geoint:setItemLocation'
  },
```
Import `GeoSnapshot, GeoSource` from `./post-mvp-types`; add `ApiContracts`:
```ts
  [channels.geoint.snapshot]: { args: []; returns: GeoSnapshot };
  [channels.geoint.addSource]: { args: [{ label: string; url: string; type: 'rss' | 'atom' | 'geojson' }]; returns: GeoSource };
  [channels.geoint.updateSource]: { args: [string, Partial<GeoSource>]; returns: void };
  [channels.geoint.removeSource]: { args: [string]; returns: void };
  [channels.geoint.importOpml]: { args: []; returns: number };
  [channels.geoint.refresh]: { args: [string | undefined]; returns: { fetched: number; failed: number } };
  [channels.geoint.setItemLocation]: { args: [string, { lat: number; lon: number } | null]; returns: void };
```

- [ ] **Step 2: Handlers** (`register.ts`; import `* as geoint from '../geoint/sources'`, `parseOpml from '../geoint/feeds'`, `ensureGeoSource, ensureLatLon`):
```ts
  // ---- GeoINT (vault-gated; network is app-layer gated by settings.geoint.networkEnabled) ----
  safeHandle(channels.geoint.snapshot, () => geoint.snapshot());
  safeHandle(channels.geoint.addSource, (...a) => geoint.addSource(ensureGeoSource(a[0])));
  safeHandle(channels.geoint.updateSource, (...a) => geoint.updateSource(ensureUuid(a[0], 'sourceId'), a[1] as object));
  safeHandle(channels.geoint.removeSource, (...a) => geoint.removeSource(ensureUuid(a[0], 'sourceId')));
  safeHandle(channels.geoint.setItemLocation, (...a) => geoint.setItemLocation(ensureUuid(a[0], 'itemId'), ensureLatLon(a[1])));
  safeHandle(channels.geoint.importOpml, async () => {
    const win = getWindow();
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }] })
                  : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return 0;
    return geoint.importSources(parseOpml(await readFile(r.filePaths[0], 'utf8')));
  });
  safeHandle(channels.geoint.refresh, async (...a) => {
    const enabled = settingsStore.read ? (await settingsStore.read()).geoint.networkEnabled : false;
    if (!enabled) return { fetched: 0, failed: 0 }; // EGRESS GATE
    const targetId = a[0] as string | undefined;
    const sources = (await geoint.listSources()).filter((s) => s.enabled && (!targetId || s.id === targetId));
    let fetched = 0; let failed = 0;
    for (const s of sources) { const r = await geoint.fetchSource(s.id, true); if (r.ok) fetched++; else failed++; }
    return { fetched, failed };
  });
```
(Confirm `settingsStore` exposes a read returning `AppSettings`; the existing `channels.settings.read` handler shows the accessor — reuse it.)

- [ ] **Step 3: preload** (`index.ts`):
```ts
  geoint: {
    snapshot: () => ipcRenderer.invoke(channels.geoint.snapshot),
    addSource: (s: unknown) => ipcRenderer.invoke(channels.geoint.addSource, s),
    updateSource: (id: string, patch: unknown) => ipcRenderer.invoke(channels.geoint.updateSource, id, patch),
    removeSource: (id: string) => ipcRenderer.invoke(channels.geoint.removeSource, id),
    importOpml: () => ipcRenderer.invoke(channels.geoint.importOpml),
    refresh: (id?: string) => ipcRenderer.invoke(channels.geoint.refresh, id),
    setItemLocation: (id: string, loc: unknown) => ipcRenderer.invoke(channels.geoint.setItemLocation, id, loc)
  },
```

- [ ] **Step 4: api.d.ts** — mirror the shapes (import `GeoSnapshot, GeoSource` from post-mvp-types).

- [ ] **Step 5: Typecheck** → exit 0.

### Task 5.3: Egress-gate unit test (the security assertion)

**Files:** Test `test/geoint-egress.test.ts`

- [ ] **Step 1: Write the test** — `fetchSource(id, false)` performs no fetch (stub global.fetch to throw if called) and returns `{ok:false,count:0}`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const DATA = mkdtempSync(join(tmpdir(), 'ga98-geo-eg-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));
import * as store from '../src/main/geoint/sources';

beforeEach(async () => { await store._resetForTest(); });

describe('geoint egress gate', () => {
  it('fetchSource is a no-op (no network) when networkEnabled is false', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be called'));
    const s = await store.addSource({ label: 'X', url: 'https://x/feed.xml', type: 'rss' });
    const r = await store.fetchSource(s.id, false);
    expect(r).toEqual({ ok: false, count: 0 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run** → PASS.
- [ ] **Step 3: Commit** — `git add src/main/security/validate.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/geoint-egress.test.ts && git commit -m "feat(geoint): IPC + validators + egress-gate test"`.

---

## Stage 6 — Renderer (module + Leaflet map)

### Task 6.1: Register the module (4 points) + stub

- [ ] **Step 1:** add `'geoint'` to `ModuleKey`; **Step 2:** `ModuleHost` case + import; **Step 3:** `Icon.tsx` GLYPHS `'geoint': '🗺'` (or '🌐'); **Step 4:** `Desktop.tsx` `moduleTitles` `'geoint': 'GeoINT'`; **Step 5:** stub `GeoIntModule.tsx` returning `<div>GeoINT</div>`; **Step 6:** typecheck + commit.

### Task 6.2: MapPane (Leaflet)

**Files:** Create `src/renderer/modules/geoint/MapPane.tsx`

- [ ] **Step 1: Implement** — Leaflet map; mount once; tile layer added only when `networkEnabled && tileServerUrl`; markers via `L.divIcon` (avoids Leaflet's broken default-marker-asset path under bundlers); `onPick` callback for drop-pin mode; placeholder div when tiles disabled.

```tsx
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoItem } from '@shared/post-mvp-types';

const pin = L.divIcon({ className: 'ga98-geo-pin', html: '📍', iconSize: [16, 16], iconAnchor: [8, 16] });

export function MapPane({ items, tilesEnabled, tileUrl, tileAttribution, pickMode, onPick, focusId }:
  { items: GeoItem[]; tilesEnabled: boolean; tileUrl: string; tileAttribution: string;
    pickMode: boolean; onPick: (lat: number, lon: number) => void; focusId: string | null }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (!ref.current || map.current) return;
    map.current = L.map(ref.current, { center: [20, 0], zoom: 2, attributionControl: true });
    layer.current = L.layerGroup().addTo(map.current);
  }, []);

  // tiles toggle
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (tiles.current) { tiles.current.remove(); tiles.current = null; }
    if (tilesEnabled && tileUrl) tiles.current = L.tileLayer(tileUrl, { attribution: tileAttribution }).addTo(m);
  }, [tilesEnabled, tileUrl, tileAttribution]);

  // markers
  useEffect(() => {
    const lg = layer.current; if (!lg) return;
    lg.clearLayers();
    for (const it of items) {
      if (it.lat == null || it.lon == null) continue;
      const mk = L.marker([it.lat, it.lon], { icon: pin });
      mk.bindPopup(`<b>${it.title}</b>${it.link ? `<br><a href="${it.link}" target="_blank" rel="noopener">open</a>` : ''}`);
      mk.addTo(lg);
      if (it.id === focusId) { map.current?.setView([it.lat, it.lon], 6); mk.openPopup(); }
    }
  }, [items, focusId]);

  // pick mode
  useEffect(() => {
    const m = map.current; if (!m) return;
    const handler = (e: L.LeafletMouseEvent): void => { if (pickMode) onPick(e.latlng.lat, e.latlng.lng); };
    m.on('click', handler);
    return () => { m.off('click', handler); };
  }, [pickMode, onPick]);

  if (!tilesEnabled || !tileUrl) {
    return <div ref={ref} className="ga98-geo-map" style={{ position: 'relative' }}>
      <div className="ga98-geo-map-placeholder">Map tiles disabled. Enable GeoINT network + set a tile server URL to view the map.</div>
    </div>;
  }
  return <div ref={ref} className="ga98-geo-map" />;
}
```
(Placeholder caveat: when disabled we still render the div so Leaflet has a mount node; the overlay sits on top. Verify in the xvfb smoke that toggling works.)

- [ ] **Step 2: Typecheck + commit.**

### Task 6.3: GeoIntModule (sources + reading list + controls)

**Files:** `GeoIntModule.tsx`, append `.ga98-geo-*` CSS to `theme.css`

- [ ] **Step 1: Implement** — load `snapshot()` on mount; left panel: master "Allow GeoINT network" checkbox (binds `settings.geoint.networkEnabled` via the store `patch`), tile-server URL field (binds `settings.geoint.tileServerUrl`), Add source form (label/url/type), Import OPML, Refresh (calls `geoint.refresh()`), source list (toggle enabled, remove, show lastError). Reading list: items (filterable), click → set `focusId`; a "Pin on map" toggle drives `pickMode` and calls `setItemLocation`. Right: `<MapPane>`. Toasts on refresh summary / errors. Use the existing 98.css classes + `useSettings` store (live-sync already in place).
- [ ] **Step 2: CSS** — `.ga98-geo-map { height: 100%; }`, `.ga98-geo-map-placeholder { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#555; background:#c0c0c0; text-align:center; padding:16px; z-index:500; }`, list styling.
- [ ] **Step 3: Typecheck + commit.**

---

## Stage 7 — Verification

- [ ] **Step 1:** `pnpm typecheck` → exit 0.
- [ ] **Step 2:** `pnpm test` → all suites pass (prior 126 + geoint geocode/feeds/sources/egress).
- [ ] **Step 3:** `pnpm build` → exit 0 (confirms fast-xml-parser externalizes + Leaflet/CSS bundle; gazetteer in extraResources).
- [ ] **Step 4: xvfb smoke** — boot the built app, open `geoint`, confirm the map placeholder renders with network off, no `[main.uncaughtException]`. (Real tile loading + live feed fetch are operator-machine, needing network + a tile server.)
- [ ] **Step 5:** update `project_roadmap` memory + `.remember/remember.md`; commit any harness bits.

---

## Self-review (completed during authoring)

- **Spec coverage:** module reg (6.1), sources+OPML (4.1/5.2), RSS/Atom/GeoJSON parse (3.1), gazetteer geocode + GeoRSS + manual pin (2.1/4.2/6.2/setItemLocation), egress gate default-off (4.2/5.2/5.3), Leaflet online tiles + placeholder (6.2), settings (1.1), tests + xvfb (7), vault-gating (handlers not in GATE_EXEMPT — confirm 5.2). Covered.
- **Placeholder scan:** Stage-0 gazetteer sourcing is explicit (verify world-countries fields; never hand-write coords); no "TODO/handle errors" in logic steps; all code blocks concrete.
- **Type consistency:** `GeoSource`/`GeoItem`/`GeoSnapshot`/`located` enum/`GeoSourceType` identical across types, store, feeds, IPC, preload, MapPane. `fetchSource(id, networkEnabled)` signature matches caller in the refresh handler and the egress test.
- **Determinism:** `geocode` is deterministic (sorted, regex, no RNG/time). `randomUUID` for ids is fine (ids, not correctness-critical ordering). `new Date().toISOString()` only on display metadata (lastFetched) — flagged inline.
- **Egress-gate caveat:** the refresh handler reads `settingsStore` for `networkEnabled` AND `fetchSource` re-guards — defense in depth; the test asserts the function-level guard.
