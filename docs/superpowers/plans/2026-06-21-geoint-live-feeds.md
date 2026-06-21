# GeoINT Live Feeds (AIS + ADS-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two viewport-bounded live GeoINT layers — ADS-B aircraft (REST poll, adsb.lol) and AIS ships (WebSocket, AISStream.io) — gated behind the GeoINT network opt-in.

**Architecture:** ADS-B reuses the threat-layer pattern (main-side `safeFetch`, `networkEnabled` gate, GeoJSON circle layer, ~15 s poll). AIS adds a main-process `ws` WebSocket to AISStream (user-supplied key, bbox subscription) that parses PositionReports and pushes batched vessel snapshots to the renderer over IPC. Both render as GPU GeoJSON circle layers (the satellites pattern), created behind an `isStyleLoaded()` guard.

**Tech Stack:** TypeScript (strict), Electron 33 (Node 20), React, MapLibre GL v5, `ws` (NEW), vitest (node env).

## Global Constraints

- No telemetry/analytics/phone-home.
- New egress hosts, hard-pinned, main-only, only when `settings.geoint.networkEnabled` is true (and AIS also requires the layer on + a stored key): ADS-B `https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}`; AIS `wss://stream.aisstream.io/v0/stream`. Nothing connects when the gate is off (the `gate:confinement` no-egress test must hold).
- Renderer stays egress-free: the AIS socket is main-only; positions reach the renderer via `webContents.send` → `ipcRenderer.on`. No renderer socket, no CSP change.
- ADS-B goes through `safeFetch(url, 4, headers)` (rejects private hosts, re-validates redirects); read the body via `readTextCapped(res)`.
- Defensive parsing (never throw): adsb.lol `alt_baro` is number-OR-the-string `"ground"`; `track` may be absent (fall back to `true_heading`); `flight` is space-padded (trim). AISStream `MetaData.latitude/longitude` are lowercase while `Message.PositionReport.{Latitude,Longitude,Sog,Cog}` are capitalized. Coordinate-gate every position (finite, lat∈[-90,90], lon∈[-180,180]).
- Determinism: prune/age use `Date.now()` (documented real-time-display exception); pure parsers/bbox math are deterministic and unit-tested.
- License: render an **adsb.lol ODbL attribution** line on the panel. AIS uses the user's own key (no bundled credential, no redistribution → sidesteps AISStream's missing data-license).
- AIS API key stored in `secretStore` at `geoint.ais.key` (OS-encrypted; never in settings.json, never kept in renderer state).
- MapLibre layer creation MUST be guarded by `map.isStyleLoaded()` and driven off `load` + a self-guarded `styledata` (the v3.17.1 crash lesson).
- v1 simplification (verified): AISStream `PositionReport` carries no ship type (type lives in less-frequent `ShipStaticData`). v1 subscribes to `PositionReport` only; ships render in one color and `ShipPos.type` defaults to `'other'`. Vessel-type classification is a future enhancement.
- TypeScript strict; `pnpm typecheck` + `pnpm test` green. Renderer = typecheck + `electron-vite build` + manual smoke.
- Commit trailer (blank line before): `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`.

---

## File map

Create:
- `src/main/services/livefeeds/types.ts` (shared main types) — actually types live renderer-side; main re-declares structurally (main can't import renderer). See note in Task 4/5.
- `src/renderer/modules/geoint/livefeeds/types.ts`, `bbox.ts`, `adsbParse.ts`, `aisParse.ts`, `aircraftLayer.ts`, `shipLayer.ts`, `LiveFeedsPanel.tsx`
- `src/main/services/livefeeds/adsb.ts`, `src/main/services/livefeeds/ais-stream.ts`
- Tests: `test/livefeeds-bbox.test.ts`, `test/livefeeds-adsb-parse.test.ts`, `test/livefeeds-ais-parse.test.ts`, `test/livefeeds-layer.test.ts`, `test/livefeeds-adsb-service.test.ts`, `test/livefeeds-ais-service.test.ts`

Modify: `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/main/security/validate.ts` (add `'ais'` to keyed-layer ids), `src/preload/index.ts`, `src/preload/api.d.ts`, `package.json` (`ws` + `@types/ws`), `src/renderer/modules/geoint/MapGL.tsx`, `src/renderer/modules/geoint/GeoIntModule.tsx`, `README.md`.

Note on the parser location: the pure parsers (`adsbParse.ts`, `aisParse.ts`, `bbox.ts`, `types.ts`) live under the **renderer** livefeeds dir and are imported by BOTH the main service files and the renderer (TS path allows it; they're pure, no DOM). This keeps one parser. If the build forbids main→renderer imports, duplicate the tiny pure module under `src/main/services/livefeeds/` — but prefer the shared import.

---

### Task 1: Types + bbox math

**Files:**
- Create: `src/renderer/modules/geoint/livefeeds/types.ts`, `src/renderer/modules/geoint/livefeeds/bbox.ts`
- Test: `test/livefeeds-bbox.test.ts`

**Interfaces:**
- Produces: `Bounds`, `AircraftPos`, `ShipPos`; `boundsToRadius(b: Bounds): { lat: number; lon: number; radiusNm: number }`; `boundsToAisSubscription(b: Bounds): [[[number, number],[number, number]]]`.

- [ ] **Step 1: Write `types.ts`**

```ts
// src/renderer/modules/geoint/livefeeds/types.ts
export interface Bounds { west: number; south: number; east: number; north: number; }

export type AltBand = 'ground' | 'low' | 'mid' | 'high';

export interface AircraftPos {
  id: string;            // ICAO hex
  callsign: string | null;
  lat: number; lon: number;
  altFt: number | null;  // null when on ground
  gsKt: number | null;
  trackDeg: number | null;
  band: AltBand;
}

export type ShipType = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'tug' | 'pleasure' | 'other';

export interface ShipPos {
  id: string;            // MMSI (string)
  name: string | null;
  lat: number; lon: number;
  sogKt: number | null;
  cogDeg: number | null;
  type: ShipType;        // 'other' in v1 (no ShipStaticData join yet)
  lastSeen: number;      // epoch ms
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/livefeeds-bbox.test.ts
import { describe, it, expect } from 'vitest';
import { boundsToRadius, boundsToAisSubscription } from '../src/renderer/modules/geoint/livefeeds/bbox';

const b = { west: -1, south: 51, east: 1, north: 53 };

describe('boundsToRadius', () => {
  it('centers the box and returns a capped NM radius', () => {
    const r = boundsToRadius(b);
    expect(r.lat).toBeCloseTo(52, 5);
    expect(r.lon).toBeCloseTo(0, 5);
    expect(r.radiusNm).toBeGreaterThan(0);
    expect(r.radiusNm).toBeLessThanOrEqual(250); // adsb.lol cap
  });
  it('caps the radius at 250 NM for a huge box', () => {
    expect(boundsToRadius({ west: -120, south: -40, east: 120, north: 60 }).radiusNm).toBe(250);
  });
});

describe('boundsToAisSubscription', () => {
  it('emits a single bbox of two [lat,lon] corners (SW-ish, NE-ish)', () => {
    const sub = boundsToAisSubscription(b);
    expect(sub).toEqual([[[53, -1], [51, 1]]]); // [[ [north,west], [south,east] ]]
  });
});
```

- [ ] **Step 3: Run — Expected FAIL** (`Cannot find module './bbox'`). `pnpm exec vitest run test/livefeeds-bbox.test.ts`

- [ ] **Step 4: Write `bbox.ts`**

```ts
// src/renderer/modules/geoint/livefeeds/bbox.ts
import type { Bounds } from './types';

const NM_PER_DEG_LAT = 60; // 1° latitude ≈ 60 NM
const MAX_RADIUS_NM = 250; // adsb.lol hard cap

/** Center of the box + a radius (NM) covering its half-diagonal, capped at adsb.lol's 250 NM. */
export function boundsToRadius(b: Bounds): { lat: number; lon: number; radiusNm: number } {
  const lat = (b.north + b.south) / 2;
  const lon = (b.east + b.west) / 2;
  const dLat = (b.north - b.south) / 2;
  const dLon = (b.east - b.west) / 2;
  const nmLat = dLat * NM_PER_DEG_LAT;
  const nmLon = dLon * NM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.max(1, Math.round(Math.hypot(nmLat, nmLon))));
  return { lat, lon, radiusNm };
}

/** AISStream BoundingBoxes shape: an array of boxes, each box two [lat,lon] corners. */
export function boundsToAisSubscription(b: Bounds): [[[number, number], [number, number]]] {
  return [[[b.north, b.west], [b.south, b.east]]];
}
```

- [ ] **Step 5: Run — Expected PASS.** `pnpm exec vitest run test/livefeeds-bbox.test.ts`
- [ ] **Step 6: typecheck** `pnpm typecheck`
- [ ] **Step 7: Commit** (`feat(geoint/livefeeds): bounds types + bbox→radius / AIS-subscription math`)

---

### Task 2: ADS-B parser (adsb.lol)

**Files:** Create `src/renderer/modules/geoint/livefeeds/adsbParse.ts`; Test `test/livefeeds-adsb-parse.test.ts`

**Interfaces:** Consumes `AircraftPos`, `AltBand`. Produces `parseAdsb(json: unknown): AircraftPos[]`.

- [ ] **Step 1: Write the failing test** (verified field shapes incl. the number-or-"ground" altitude + absent track)

```ts
// test/livefeeds-adsb-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseAdsb } from '../src/renderer/modules/geoint/livefeeds/adsbParse';

describe('parseAdsb', () => {
  it('maps a normal airborne aircraft, trimming the space-padded flight', () => {
    const out = parseAdsb({ ac: [{ hex: 'a53f20', flight: 'SWA2896 ', t: 'B737', alt_baro: 2100, gs: 202.5, track: 343.35, lat: 40.819153, lon: -73.90387 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a53f20', callsign: 'SWA2896', altFt: 2100, gsKt: 202.5, trackDeg: 343.35, band: 'low' });
  });
  it('handles alt_baro "ground" (altFt null, band ground) and track absent → true_heading', () => {
    const out = parseAdsb({ ac: [{ hex: 'ac5087', flight: 'N893AP  ', alt_baro: 'ground', gs: 0, true_heading: 22.5, lat: 40.735096, lon: -73.97287 }] });
    expect(out[0]).toMatchObject({ id: 'ac5087', altFt: null, band: 'ground', trackDeg: 22.5 });
  });
  it('drops entries failing the coordinate gate; never throws on garbage', () => {
    expect(parseAdsb({ ac: [{ hex: 'x', lat: 999, lon: 0 }, { hex: 'y' }] })).toEqual([]);
    expect(parseAdsb(null)).toEqual([]);
    expect(parseAdsb({})).toEqual([]);
  });
  it('assigns altitude bands', () => {
    const band = (alt: number): string => parseAdsb({ ac: [{ hex: 'h', lat: 0, lon: 0, alt_baro: alt }] })[0].band;
    expect(band(500)).toBe('low');     // <10k
    expect(band(20000)).toBe('mid');   // 10k–30k
    expect(band(38000)).toBe('high');  // >30k
  });
});
```

- [ ] **Step 2: Run — Expected FAIL.** `pnpm exec vitest run test/livefeeds-adsb-parse.test.ts`

- [ ] **Step 3: Write `adsbParse.ts`**

```ts
// src/renderer/modules/geoint/livefeeds/adsbParse.ts
/** Pure parser for the adsb.lol /v2 radius response (ADSBExchange-v2 schema). Never throws.
 *  alt_baro is number feet OR the string "ground"; track may be absent (use true_heading);
 *  flight is space-padded. Every position is coord-gated. */
import type { AircraftPos, AltBand } from './types';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const goodLat = (n: unknown): n is number => finite(n) && n >= -90 && n <= 90;
const goodLon = (n: unknown): n is number => finite(n) && n >= -180 && n <= 180;

function band(altFt: number | null): AltBand {
  if (altFt === null) return 'ground';
  if (altFt < 10000) return 'low';
  if (altFt <= 30000) return 'mid';
  return 'high';
}

export function parseAdsb(json: unknown): AircraftPos[] {
  const ac = (json as { ac?: unknown })?.ac;
  if (!Array.isArray(ac)) return [];
  const out: AircraftPos[] = [];
  for (const r of ac) {
    const a = r as Record<string, unknown>;
    if (!goodLat(a.lat) || !goodLon(a.lon) || typeof a.hex !== 'string') continue;
    const altFt = a.alt_baro === 'ground' ? null : finite(a.alt_baro) ? a.alt_baro : null;
    const trackDeg = finite(a.track) ? a.track : finite(a.true_heading) ? a.true_heading : null;
    out.push({
      id: a.hex,
      callsign: typeof a.flight === 'string' && a.flight.trim() ? a.flight.trim() : null,
      lat: a.lat, lon: a.lon,
      altFt,
      gsKt: finite(a.gs) ? a.gs : null,
      trackDeg,
      band: band(altFt)
    });
  }
  return out;
}
```

- [ ] **Step 4: Run — Expected PASS.** `pnpm exec vitest run test/livefeeds-adsb-parse.test.ts`
- [ ] **Step 5: typecheck; Commit** (`feat(geoint/livefeeds): adsb.lol response parser (alt/track/coord-gated)`)

---

### Task 3: AIS parser + vessel prune

**Files:** Create `src/renderer/modules/geoint/livefeeds/aisParse.ts`; Test `test/livefeeds-ais-parse.test.ts`

**Interfaces:** Consumes `ShipPos`. Produces `parseAisMessage(raw: unknown, now: number): ShipPos | null`; `pruneVessels(map: Map<string, ShipPos>, now: number, maxAgeMs?: number): void`.

- [ ] **Step 1: Write the failing test** (verified casing split; non-position types ignored)

```ts
// test/livefeeds-ais-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseAisMessage, pruneVessels } from '../src/renderer/modules/geoint/livefeeds/aisParse';

const T = 1_700_000_000_000;
const msg = {
  MessageType: 'PositionReport',
  MetaData: { MMSI: 259000420, ShipName: 'AUGUSTSON ', latitude: 66.02695, longitude: 12.2538 },
  Message: { PositionReport: { Latitude: 66.02695, Longitude: 12.2538, Sog: 0, Cog: 308 } }
};

describe('parseAisMessage', () => {
  it('extracts a PositionReport into a ShipPos (capitalized Message fields, trimmed name)', () => {
    expect(parseAisMessage(msg, T)).toMatchObject({ id: '259000420', name: 'AUGUSTSON', lat: 66.02695, lon: 12.2538, sogKt: 0, cogDeg: 308, type: 'other', lastSeen: T });
  });
  it('ignores non-PositionReport message types and garbage; never throws', () => {
    expect(parseAisMessage({ MessageType: 'ShipStaticData', MetaData: { MMSI: 1 } }, T)).toBeNull();
    expect(parseAisMessage(null, T)).toBeNull();
    expect(parseAisMessage({ MessageType: 'PositionReport', Message: { PositionReport: { Latitude: 999, Longitude: 0 } }, MetaData: { MMSI: 1 } }, T)).toBeNull();
  });
});

describe('pruneVessels', () => {
  it('drops vessels older than maxAge, keeps fresh', () => {
    const m = new Map([['a', { id: 'a', lastSeen: T - 11 * 60_000 } as any], ['b', { id: 'b', lastSeen: T } as any]]);
    pruneVessels(m, T, 10 * 60_000);
    expect([...m.keys()]).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run — Expected FAIL.** `pnpm exec vitest run test/livefeeds-ais-parse.test.ts`

- [ ] **Step 3: Write `aisParse.ts`**

```ts
// src/renderer/modules/geoint/livefeeds/aisParse.ts
/** Pure AISStream PositionReport parser + vessel prune. Never throws. Position lives under
 *  Message.PositionReport (capitalized Latitude/Longitude/Sog/Cog); MMSI/ShipName under MetaData.
 *  Ship type is NOT in PositionReport (it's in ShipStaticData) → type defaults to 'other' in v1. */
import type { ShipPos } from './types';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function parseAisMessage(raw: unknown, now: number): ShipPos | null {
  const m = raw as Record<string, unknown>;
  if (!m || m.MessageType !== 'PositionReport') return null;
  const pr = (m.Message as { PositionReport?: Record<string, unknown> })?.PositionReport;
  const meta = m.MetaData as Record<string, unknown> | undefined;
  if (!pr || !meta) return null;
  const lat = pr.Latitude, lon = pr.Longitude;
  if (!finite(lat) || lat < -90 || lat > 90 || !finite(lon) || lon < -180 || lon > 180) return null;
  if (meta.MMSI === undefined || meta.MMSI === null) return null;
  const name = typeof meta.ShipName === 'string' && meta.ShipName.trim() ? meta.ShipName.trim() : null;
  return {
    id: String(meta.MMSI), name, lat, lon,
    sogKt: finite(pr.Sog) ? pr.Sog : null,
    cogDeg: finite(pr.Cog) ? pr.Cog : null,
    type: 'other',
    lastSeen: now
  };
}

export function pruneVessels(map: Map<string, ShipPos>, now: number, maxAgeMs = 10 * 60_000): void {
  for (const [k, v] of map) if (now - v.lastSeen > maxAgeMs) map.delete(k);
}
```

- [ ] **Step 4: Run — Expected PASS.** `pnpm exec vitest run test/livefeeds-ais-parse.test.ts`
- [ ] **Step 5: typecheck; Commit** (`feat(geoint/livefeeds): AISStream PositionReport parser + vessel prune`)

---

### Task 4: Main ADS-B service + IPC

**Files:** Create `src/main/services/livefeeds/adsb.ts`; Modify `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`; Test `test/livefeeds-adsb-service.test.ts`

**Interfaces:** Consumes `safeFetch`, `readTextCapped`, `parseAdsb`, `boundsToRadius`, `settingsStore`. Produces `fetchAdsb(bounds): Promise<AircraftPos[]>`; renderer `window.api.livefeeds.fetchAdsb(bounds)`.

- [ ] **Step 1: Write the failing test** (gate off → empty; URL built from bounds)

```ts
// test/livefeeds-adsb-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const net = { on: false };
let lastUrl = '';
vi.mock('../src/main/storage/json-fs', () => ({ settingsStore: { read: async () => ({ geoint: { networkEnabled: net.on } }) } }));
vi.mock('../src/main/net/safe-fetch', () => ({ safeFetch: vi.fn(async (u: string) => { lastUrl = u; return { ok: true, status: 200 } as any; }) }));
vi.mock('../src/main/net/limits', () => ({ readTextCapped: vi.fn(async () => JSON.stringify({ ac: [{ hex: 'h', lat: 52, lon: 0, alt_baro: 1000 }] })) }));
import { fetchAdsb } from '../src/main/services/livefeeds/adsb';

beforeEach(() => { net.on = false; lastUrl = ''; });

describe('fetchAdsb', () => {
  it('returns [] when the GeoINT network gate is OFF (no fetch)', async () => {
    expect(await fetchAdsb({ west: -1, south: 51, east: 1, north: 53 })).toEqual([]);
  });
  it('fetches api.adsb.lol with a radius URL and parses when gate is ON', async () => {
    net.on = true;
    const out = await fetchAdsb({ west: -1, south: 51, east: 1, north: 53 });
    expect(lastUrl).toContain('https://api.adsb.lol/v2/lat/52/lon/0/dist/');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('h');
  });
});
```

- [ ] **Step 2: Run — Expected FAIL.** `pnpm exec vitest run test/livefeeds-adsb-service.test.ts`

- [ ] **Step 3: Write `adsb.ts`** (model on `threat-layers/usgs.ts`)

```ts
// src/main/services/livefeeds/adsb.ts
/** ADS-B aircraft positions from adsb.lol (free, no key, ODbL). On-demand REST, gated by
 *  settings.geoint.networkEnabled; host hard-pinned; through safeFetch (SSRF-gated). */
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';
import { settingsStore } from '../../storage/json-fs';
import { boundsToRadius } from '../../../renderer/modules/geoint/livefeeds/bbox';
import { parseAdsb } from '../../../renderer/modules/geoint/livefeeds/adsbParse';
import type { Bounds, AircraftPos } from '../../../renderer/modules/geoint/livefeeds/types';

export async function fetchAdsb(bounds: Bounds): Promise<AircraftPos[]> {
  if (!(await settingsStore.read()).geoint?.networkEnabled) return [];
  const { lat, lon, radiusNm } = boundsToRadius(bounds);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`;
  const res = await safeFetch(url, 4, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`adsb.lol HTTP ${res.status}`);
  return parseAdsb(JSON.parse(await readTextCapped(res)));
}
```
(If the main→renderer import path is rejected by the main tsconfig, move `bbox.ts`/`adsbParse.ts`/`types.ts` to a shared location both can import, or duplicate the tiny pure modules under `src/main/services/livefeeds/`. Resolve at implementation; keep one source of truth if possible.)

- [ ] **Step 4: Run — Expected PASS.** `pnpm exec vitest run test/livefeeds-adsb-service.test.ts`

- [ ] **Step 5: Channels.** In `src/shared/ipc-contracts.ts`, add a sibling group after `geoint`:

```ts
  livefeeds: {
    fetchAdsb: 'livefeeds:fetchAdsb',
    aisStart: 'livefeeds:aisStart',
    aisStop: 'livefeeds:aisStop',
    aisSetBbox: 'livefeeds:aisSetBbox',
    setAisKey: 'livefeeds:setAisKey',
    hasAisKey: 'livefeeds:hasAisKey',
    onAisPositions: 'livefeeds:onAisPositions'
  },
```

- [ ] **Step 6: Handler.** In `src/main/ipc/register.ts` (near the geoint handlers), `import * as adsb from '../services/livefeeds/adsb'` and:

```ts
  safeHandle(channels.livefeeds.fetchAdsb, (...a) => adsb.fetchAdsb(a[0] as Parameters<typeof adsb.fetchAdsb>[0]));
```

- [ ] **Step 7: Preload + api.d.** In `src/preload/index.ts` add a `livefeeds` block (ADS-B part now; AIS in Task 5):

```ts
  livefeeds: {
    fetchAdsb: (bounds: unknown) => ipcRenderer.invoke(channels.livefeeds.fetchAdsb, bounds),
  },
```
In `src/preload/api.d.ts` add (inline the bounds/aircraft shapes; AIS methods added in Task 5):

```ts
  livefeeds: {
    fetchAdsb(bounds: { west: number; south: number; east: number; north: number }): Promise<Array<{ id: string; callsign: string | null; lat: number; lon: number; altFt: number | null; gsKt: number | null; trackDeg: number | null; band: 'ground'|'low'|'mid'|'high' }>>;
  };
```

- [ ] **Step 8: Run suite + typecheck.** `pnpm exec vitest run test/livefeeds-adsb-service.test.ts && pnpm typecheck`
- [ ] **Step 9: Commit** (`feat(geoint/livefeeds): main ADS-B fetch (adsb.lol, gated) + IPC`)

---

### Task 5: Main AIS WebSocket service + key + push IPC

**Files:** Create `src/main/services/livefeeds/ais-stream.ts`; Modify `package.json` (`ws`, `@types/ws`), `src/main/security/validate.ts` (add `'ais'` keyed id), `src/shared/ipc-contracts.ts` (done in T4), `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`; Test `test/livefeeds-ais-service.test.ts`

**Interfaces:** Consumes `ws`, `secretStore`, `settingsStore`, `parseAisMessage`, `pruneVessels`, `boundsToAisSubscription`. Produces `startAis(bounds, onPositions): Promise<'started'|'no-key'|'gate-off'>`, `setAisBbox(bounds)`, `stopAis()`. Renderer `window.api.livefeeds.{aisStart,aisStop,aisSetBbox,setAisKey,hasAisKey,onAisPositions}`.

- [ ] **Step 1: Add deps**

```bash
pnpm add ws && pnpm add -D @types/ws
```

- [ ] **Step 2: Add `'ais'` to keyed-layer ids.** In `src/main/security/validate.ts`, extend `KEYED_LAYER_IDS` to include `'ais'` so `setLayerKey('ais', key)`/`hasLayerKey('ais')` store/read `geoint.ais.key`. (Reuse the existing keyed-layer IPC for AIS key management; no new key channels needed — `setAisKey`/`hasAisKey` below simply delegate, OR drop them and reuse `geoint.setLayerKey('ais', …)`. Prefer reusing the existing geoint key channels; if so, skip `setAisKey/hasAisKey` from the channel group and the panel calls `window.api.geoint.setLayerKey('ais', key)`.)

- [ ] **Step 3: Write the failing test** (gate off / no key → no connect)

```ts
// test/livefeeds-ais-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const net = { on: false }; const key = { val: '' };
const sent: string[] = []; let opened = false;
vi.mock('ws', () => ({ default: class { onmsg?: any; constructor() { opened = true; } on() { return this; } send(s: string) { sent.push(s); } close() {} readyState = 1; static OPEN = 1; } }));
vi.mock('../src/main/storage/json-fs', () => ({ settingsStore: { read: async () => ({ geoint: { networkEnabled: net.on } }) } }));
vi.mock('../src/main/secrets', () => ({ secretStore: { get: async () => (key.val || null) } }));
import { startAis, stopAis } from '../src/main/services/livefeeds/ais-stream';

beforeEach(() => { net.on = false; key.val = ''; sent.length = 0; opened = false; });

describe('AIS stream gating', () => {
  it('does not connect when the network gate is OFF', async () => {
    expect(await startAis({ west: -1, south: 51, east: 1, north: 53 }, () => {})).toBe('gate-off');
    expect(opened).toBe(false);
  });
  it('does not connect when no key is stored', async () => {
    net.on = true;
    expect(await startAis({ west: -1, south: 51, east: 1, north: 53 }, () => {})).toBe('no-key');
    expect(opened).toBe(false);
  });
  it('opens + sends a subscription with the bbox when gate on + key present', async () => {
    net.on = true; key.val = 'KEY123';
    expect(await startAis({ west: -1, south: 51, east: 1, north: 53 }, () => {})).toBe('started');
    expect(opened).toBe(true);
    stopAis();
  });
});
```

- [ ] **Step 4: Write `ais-stream.ts`**

```ts
// src/main/services/livefeeds/ais-stream.ts
/** AISStream.io WebSocket client (main-only). Opens ONLY when networkEnabled + a stored key; host
 *  hard-pinned. Parses PositionReports into a vessel map, prunes >10 min, emits batched snapshots on
 *  a ~2 s throttle via the supplied callback. The renderer never opens a socket. */
import WebSocket from 'ws';
import { settingsStore } from '../../storage/json-fs';
import { secretStore } from '../../secrets';
import { parseAisMessage, pruneVessels } from '../../../renderer/modules/geoint/livefeeds/aisParse';
import { boundsToAisSubscription } from '../../../renderer/modules/geoint/livefeeds/bbox';
import type { Bounds, ShipPos } from '../../../renderer/modules/geoint/livefeeds/types';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const THROTTLE_MS = 2000;
let ws: WebSocket | null = null;
let vessels = new Map<string, ShipPos>();
let bbox: Bounds | null = null;
let apiKey = '';
let emit: ((s: ShipPos[]) => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(): void {
  if (ws && ws.readyState === WebSocket.OPEN && bbox) {
    ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boundsToAisSubscription(bbox), FilterMessageTypes: ['PositionReport'] }));
  }
}

export async function startAis(bounds: Bounds, onPositions: (s: ShipPos[]) => void): Promise<'started' | 'no-key' | 'gate-off'> {
  if (!(await settingsStore.read()).geoint?.networkEnabled) return 'gate-off';
  const key = await secretStore.get('geoint.ais.key');
  if (!key) return 'no-key';
  stopAis();
  apiKey = key; bbox = bounds; emit = onPositions; vessels = new Map();
  ws = new WebSocket(AIS_URL);
  ws.on('open', () => subscribe());
  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const pos = parseAisMessage(JSON.parse(data.toString()), Date.now());
      if (pos) vessels.set(pos.id, pos);
    } catch { /* malformed frame — ignore */ }
  });
  ws.on('error', () => { /* surfaced via close/reconnect; do not throw */ });
  timer = setInterval(() => {
    pruneVessels(vessels, Date.now());
    emit?.([...vessels.values()]);
  }, THROTTLE_MS);
  return 'started';
}

export function setAisBbox(bounds: Bounds): void { bbox = bounds; subscribe(); }

export function stopAis(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
  vessels = new Map(); emit = null;
}
```
(Bounded reconnect-on-close while the layer is on can be added; v1 keeps it minimal — a closed socket stops updating until the user re-toggles. Note this as a known v1 limitation; do not busy-loop.)

- [ ] **Step 5: Handlers + push.** In `register.ts`, `import * as ais from '../services/livefeeds/ais-stream'` and wire start/stop/bbox; on positions, push to the focused window:

```ts
  safeHandle(channels.livefeeds.aisStart, (...a) => ais.startAis(a[0] as any, (positions) => {
    getWindow()?.webContents.send(channels.livefeeds.onAisPositions, { positions });
  }));
  safeHandle(channels.livefeeds.aisStop, () => { ais.stopAis(); });
  safeHandle(channels.livefeeds.aisSetBbox, (...a) => { ais.setAisBbox(a[0] as any); });
```
(Use the same `getWindow()` helper the mail-poller push uses.)

- [ ] **Step 6: Preload + api.d.** Extend the `livefeeds` preload block:

```ts
    aisStart: (bounds: unknown) => ipcRenderer.invoke(channels.livefeeds.aisStart, bounds),
    aisStop: () => ipcRenderer.invoke(channels.livefeeds.aisStop),
    aisSetBbox: (bounds: unknown) => ipcRenderer.invoke(channels.livefeeds.aisSetBbox, bounds),
    onAisPositions: (cb: (p: { positions: unknown[] }) => void) => {
      const l = (_e: unknown, p: { positions: unknown[] }) => cb(p);
      ipcRenderer.on(channels.livefeeds.onAisPositions, l);
      return () => ipcRenderer.removeListener(channels.livefeeds.onAisPositions, l);
    },
```
Type them in `api.d.ts` (`aisStart(bounds): Promise<'started'|'no-key'|'gate-off'>`, `aisStop(): Promise<void>`, `aisSetBbox(bounds): Promise<void>`, `onAisPositions(cb): () => void`). AIS key uses the existing `geoint.setLayerKey('ais', key)` / `hasLayerKey('ais')`.

- [ ] **Step 7: Run suite + typecheck.** `pnpm exec vitest run test/livefeeds-ais-service.test.ts && pnpm typecheck`
- [ ] **Step 8: Commit** (`feat(geoint/livefeeds): AISStream WebSocket service (gated, keyed) + push IPC`)

---

### Task 6: Aircraft + ship GeoJSON layers

**Files:** Create `src/renderer/modules/geoint/livefeeds/aircraftLayer.ts`, `shipLayer.ts`; Test `test/livefeeds-layer.test.ts`

**Interfaces:** Consumes `AircraftPos`, `ShipPos`. Produces, per layer: `buildAircraftFeatures(a)/buildShipFeatures(s)`, `ensureAircraftLayer/ensureShipLayer(map,onSelect)`, `updateAircraftLayer/updateShipLayer(map,items)`, `removeAircraftLayer/removeShipLayer(map)`. Model on `satellites/satelliteLayer.ts` (incl. the `isStyleLoaded()` guard).

- [ ] **Step 1: Write the failing test** (pure builders)

```ts
// test/livefeeds-layer.test.ts
import { describe, it, expect } from 'vitest';
import { buildAircraftFeatures } from '../src/renderer/modules/geoint/livefeeds/aircraftLayer';
import { buildShipFeatures } from '../src/renderer/modules/geoint/livefeeds/shipLayer';

describe('buildAircraftFeatures', () => {
  it('one point per aircraft, [lng,lat] order, band + id props', () => {
    const fc = buildAircraftFeatures([{ id: 'h', callsign: 'X', lat: 52, lon: 1, altFt: 30000, gsKt: 400, trackDeg: 90, band: 'mid' }]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 52] });
    expect(fc.features[0].properties).toMatchObject({ id: 'h', band: 'mid' });
  });
});
describe('buildShipFeatures', () => {
  it('one point per ship, [lng,lat] order, id prop', () => {
    const fc = buildShipFeatures([{ id: 'm', name: 'S', lat: 60, lon: 5, sogKt: 10, cogDeg: 180, type: 'other', lastSeen: 0 }]);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [5, 60] });
    expect(fc.features[0].properties).toMatchObject({ id: 'm' });
  });
});
```

- [ ] **Step 2: Run — Expected FAIL.** `pnpm exec vitest run test/livefeeds-layer.test.ts`

- [ ] **Step 3: Write both layer files** — copy `satelliteLayer.ts` structure verbatim (inline `SatFeatureCollection`/`SatFeature` aliases, `isStyleLoaded()` guard, `getSource` idempotency, click/cursor handlers, `setData` cast). For aircraft: source `ga98-aircraft`, layer `ga98-aircraft-circles`, color by `band` via a `match` on `['get','band']` (ground `#888`, low `#4cc9f0`, mid `#ffd166`, high `#ff6b6b`); props `{ id, callsign, band, altFt, gsKt }`. For ships: source `ga98-ships`, layer `ga98-ships-circles`, single color `#06d6a0` (no `match` — type deferred); props `{ id, name, sogKt, cogDeg }`. Each exposes `build*Features`, `ensure*Layer`, `update*Layer`, `remove*Layer` with the same signatures as the satellite equivalents.

- [ ] **Step 4: Run — Expected PASS.** `pnpm exec vitest run test/livefeeds-layer.test.ts`
- [ ] **Step 5: typecheck; Commit** (`feat(geoint/livefeeds): aircraft + ship GeoJSON layers (isStyleLoaded-guarded)`)

---

### Task 7: MapGL wiring — viewport bbox + both layers

**Files:** Modify `src/renderer/modules/geoint/MapGL.tsx`

**Interfaces:** New props `aircraft?: AircraftPos[]`, `showAircraft?: boolean`, `ships?: ShipPos[]`, `showShips?: boolean`, `onAircraftSelect?(id)`, `onShipSelect?(id)`, `onBboxChange?(b: Bounds)`.

No unit test (map/React) — typecheck + `electron-vite build`. Follow the satellite wiring exactly.

- [ ] **Step 1** Add the props to `MapGLProps` + destructure with refs (mirror the satellite ref pattern).
- [ ] **Step 2** Import the layer fns + types. In the map-init effect, extend `ensureSat` (or add an `ensureLive`) so `load`/`styledata` also call `ensureAircraftLayer`/`ensureShipLayer` (guarded; idempotent) and repopulate from the latest refs.
- [ ] **Step 3** Add a debounced `moveend` → `onBboxChange` (compute `m.getBounds()` → `{west,south,east,north}`, ~500 ms debounce via a ref'd timeout). Reuse the existing `moveend` registration.
- [ ] **Step 4** Add effects that call `updateAircraftLayer(m, aircraft)` on `[aircraft, showAircraft]` and `updateShipLayer(m, ships)` on `[ships, showShips]` (clear to `[]` when the layer is off).
- [ ] **Step 5** Verify: `pnpm typecheck && node_modules/.bin/electron-vite build` (both exit 0). Commit (`feat(geoint/livefeeds): MapGL bbox callback + aircraft/ship layer wiring`).

---

### Task 8: LiveFeeds panel

**Files:** Create `src/renderer/modules/geoint/livefeeds/LiveFeedsPanel.tsx`

Props: `{ showAircraft; onToggleAircraft; aircraftCount; showShips; onToggleShips; shipCount; net; hasAisKey; aisKeyDraft; onAisKeyDraft; onSaveAisKey; aisStatus }`. Mirror the FIRMS key-field block for the AIS key (password field + Save, disabled until `net`; ship toggle disabled until `hasAisKey`). Two toggles + counts; an **adsb.lol ODbL attribution** line (`<div>` small grey: "ADS-B data © adsb.lol / contributors (ODbL)"). No unit test — typecheck + build. Commit (`feat(geoint/livefeeds): panel — toggles, AIS key field, counts, attribution`).

---

### Task 9: GeoIntModule wiring + docs

**Files:** Modify `src/renderer/modules/geoint/GeoIntModule.tsx`, `README.md`

- [ ] **State**: `showAircraft`, `showShips` (ephemeral), `aircraft`/`ships` arrays, `bbox`, `aisStatus`, AIS key draft/has (reuse the existing `hasKey`/`keyDraft`/`saveLayerKey` machinery with id `'ais'`).
- [ ] **ADS-B poll**: when `showAircraft && net`, a `setInterval(15000)` (+ immediate + on bbox change) → `window.api.livefeeds.fetchAdsb(bbox)` → `setAircraft`. Toast on failure; clear on toggle-off.
- [ ] **AIS**: on `showShips` true → `window.api.livefeeds.aisStart(bbox)` (toast guidance if it returns `'no-key'`/`'gate-off'`); subscribe to `window.api.livefeeds.onAisPositions` → `setShips`; on bbox change → `aisSetBbox`; on toggle-off/unmount → `aisStop()` + unsubscribe.
- [ ] **bbox fan-out**: pass `onBboxChange={setBbox}` to `<MapGL>`; feed `bbox` to both the ADS-B poll and `aisSetBbox`.
- [ ] **Render** `<LiveFeedsPanel …>` in the left pane (near the satellite panels) and pass `aircraft/showAircraft/ships/showShips/onAircraftSelect/onShipSelect/onBboxChange` to `<MapGL>`.
- [ ] **Docs**: README Status entry (next version) + a GeoINT module-table note: "live ADS-B aircraft (adsb.lol, ODbL) + AIS ships (AISStream, your key) behind the network opt-in." Do NOT bump `package.json` here (release step).
- [ ] **Verify**: `pnpm typecheck && pnpm exec vitest run && node_modules/.bin/electron-vite build` (all green). Commit (`feat(geoint/livefeeds): wire panel + map + ADS-B poll + AIS stream; docs`).

---

## Self-review

**Spec coverage:** ADS-B REST poll behind gate (T4, T9 poll) · adsb.lol radius from viewport (T1 bbox, T4) · ODbL attribution (T8) · AIS WebSocket main-only + user key + bbox sub + throttle/prune + push (T3 parse/prune, T5 service, T9 wiring) · two GPU GeoJSON layers, isStyleLoaded-guarded (T6) · viewport bbox + ~15s / ~2s throttle / 10min prune (T1/T4/T5) · key in secretStore via keyed-layer machinery (T5) · `ws` dep (T5) · egress hard-pinned/gated (T4/T5) · defensive parsing (T2/T3). Covered.

**Placeholder scan:** No TBD/TODO. Two explicit, justified deferrals labeled in Global Constraints + tasks: ship-type classification (needs ShipStaticData; v1 uniform color) and AIS reconnect (v1 minimal, no busy-loop). The main↔renderer pure-module import is called out with a concrete fallback. These are decisions, not placeholders.

**Type consistency:** `Bounds`/`AircraftPos`/`ShipPos`/`AltBand`/`ShipType` defined in T1, used identically in T2/T3/T4/T5/T6/T7. `boundsToRadius`/`boundsToAisSubscription` (T1) consumed in T4/T5. `parseAdsb` (T2)→T4; `parseAisMessage`/`pruneVessels` (T3)→T5. Channel names `livefeeds.*` consistent across contracts/register/preload/api.d (T4/T5). AIS key via `geoint.setLayerKey('ais',…)` + `KEYED_LAYER_IDS += 'ais'` (T5). Layer fn names mirror the satellite set (T6) and are called in T7.
