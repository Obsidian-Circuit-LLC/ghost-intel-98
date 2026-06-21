# GeoINT Space Satellites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toggleable GeoINT layer that propagates satellites from their TLEs and draws them — moving — on the MapLibre globe, with a sortable data table, click-to-detail, follow/center, export, type filters, and a manager to import or hand-enter your own satellites.

**Architecture:** Pure data layer (TLE parse + SGP4 propagate + type classify) feeds a GPU GeoJSON layer on the existing MapGL globe and a table in a new left-rail panel. User satellites persist via secure-fs (`dataRoot/satellites.json`) exactly like `streams.ts`; the default catalogue comes from CelesTrak, fetched only behind the existing `settings.geoint.networkEnabled` opt-in, with a build-time-bundled offline snapshot. SGP4 runs through satellite.js behind our own `propagate.ts` wrapper, verified against reference vectors.

**Tech Stack:** TypeScript (strict), React, Electron, MapLibre GL v5, satellite.js (NEW dep), vitest (node env), electron-vite + electron-builder.

## Global Constraints

- No telemetry, no analytics, no phone-home. (charter)
- Only new egress host: `celestrak.org`, fetched ONLY in main, ONLY when `settings.geoint.networkEnabled === true` (mirror the threat-layer/RSS gate). (spec)
- CelesTrak fetch uses `https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=tle` (3-line TLE — the direct SGP4 input; no OMM→TLE reconstruction in v1).
- Renderer is untrusted; CelesTrak text is remote/attacker-influenced — parse defensively, never build HTML strings (use `textContent`).
- Determinism: SGP4 position depends on current wall-clock (real-time orbital display) — a *justified, documented* `Date.now()`/`new Date()` exception. `propagateAt(records, date)` is deterministic given its args; tests pin a fixed date. No other unseeded nondeterminism.
- `pnpm typecheck` + `pnpm test` green at every task. Renderer-only changes verified by typecheck + `electron-vite build` + manual smoke (vitest is node-env, no React render harness).
- Commit identity uses the repo's existing trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: …` (match prior commits).
- Out of scope (future specs): maritime AIS, aviation ADS-B, orbit-path/ground-track lines, OMM-JSON ingest, Web-Worker propagation.

## File map

Create:
- `src/renderer/modules/geoint/satellites/types.ts`
- `src/renderer/modules/geoint/satellites/classify.ts`
- `src/renderer/modules/geoint/satellites/tle.ts`
- `src/renderer/modules/geoint/satellites/propagate.ts`
- `src/renderer/modules/geoint/satellites/satelliteLayer.ts`
- `src/renderer/modules/geoint/satellites/SpaceSatellitesPanel.tsx`
- `src/renderer/modules/geoint/satellites/SatelliteManager.tsx`
- `src/main/services/satellites.ts`
- `scripts/fetch-tle-snapshot.mjs`
- `resources/satellites/README-SATELLITES.txt` (+ generated `active-snapshot.json`)
- Tests: `test/sat-classify.test.ts`, `test/sat-tle.test.ts`, `test/sat-propagate.test.ts`, `test/sat-layer.test.ts`, `test/satellites-service.test.ts`

Modify:
- `src/shared/ipc-contracts.ts` (add `satellites` channel group)
- `src/main/ipc/register.ts` (register handlers)
- `src/preload/index.ts` + `src/preload/api.d.ts` (expose API)
- `package.json` (satellite.js dep; `fetch:tle-snapshot` script; `build.extraResources` entry)
- `src/renderer/modules/geoint/MapGL.tsx` (satellite GeoJSON layer + propagation tick + click)
- `src/renderer/modules/geoint/GeoIntModule.tsx` (state, panels, wiring)
- `README.md` (Status entry; module table row)

---

### Task 1: Types + classification

**Files:**
- Create: `src/renderer/modules/geoint/satellites/types.ts`
- Create: `src/renderer/modules/geoint/satellites/classify.ts`
- Test: `test/sat-classify.test.ts`

**Interfaces:**
- Produces: `SatelliteType`, `SatelliteRecord`, `PropagatedSat`, `SAT_GROUPS`; `classifyByName(name: string, noradId: number | null): SatelliteType`.

- [ ] **Step 1: Write `types.ts`** (no test; consumed everywhere)

```ts
// src/renderer/modules/geoint/satellites/types.ts
/** Space-satellite domain types. TLE lines are the canonical orbital input to SGP4. */
export type SatelliteType =
  | 'starlink' | 'gps' | 'weather' | 'comms' | 'earth-obs' | 'station' | 'scientific' | 'other';

export interface SatelliteRecord {
  id: string;                 // noradId when known (`sat-<norad>`), else `sat-<hash>`
  name: string;
  noradId: number | null;
  line1: string;              // TLE line 1
  line2: string;              // TLE line 2
  type: SatelliteType;
  source: 'snapshot' | 'celestrak' | 'user';
  tag?: string;
  notes?: string;
  active: boolean;            // drawn only when true (user sats default true on add)
  addedAt: string;            // ISO
}

export interface PropagatedSat {
  id: string;
  name: string;
  noradId: number | null;
  type: SatelliteType;
  lat: number;                // degrees
  lon: number;                // degrees
  altKm: number;
  velocityKmS: number;
  inclinationDeg: number;
  active: boolean;
}

/** CelesTrak GROUP ids offered in the data-source dropdown. 'active' is the default catalogue. */
export const SAT_GROUPS: { id: string; label: string }[] = [
  { id: 'active', label: 'Active Satellites' },
  { id: 'stations', label: 'Space Stations' },
  { id: 'starlink', label: 'Starlink' },
  { id: 'gps-ops', label: 'GPS Operational' },
  { id: 'weather', label: 'Weather' },
  { id: 'science', label: 'Science' }
];
```

- [ ] **Step 2: Write the failing test**

```ts
// test/sat-classify.test.ts
import { describe, it, expect } from 'vitest';
import { classifyByName } from '../src/renderer/modules/geoint/satellites/classify';

describe('classifyByName', () => {
  it('maps Starlink by name prefix', () => {
    expect(classifyByName('STARLINK-1283', 50345)).toBe('starlink');
  });
  it('maps GPS / NAVSTAR', () => {
    expect(classifyByName('NAVSTAR 81 (USA 319)', 48859)).toBe('gps');
    expect(classifyByName('GPS BIIF-7', 40730)).toBe('gps');
  });
  it('maps weather birds', () => {
    expect(classifyByName('NOAA 20', 43013)).toBe('weather');
    expect(classifyByName('METEOR-M 2', 40069)).toBe('weather');
  });
  it('maps stations', () => {
    expect(classifyByName('ISS (ZARYA)', 25544)).toBe('station');
    expect(classifyByName('CSS (TIANHE)', 48274)).toBe('station');
  });
  it('falls back to other', () => {
    expect(classifyByName('SOME RANDOM OBJECT', 99999)).toBe('other');
  });
});
```

- [ ] **Step 3: Run it — Expected: FAIL** (`Cannot find module './classify'`)

Run: `pnpm exec vitest run test/sat-classify.test.ts`

- [ ] **Step 4: Write `classify.ts`**

```ts
// src/renderer/modules/geoint/satellites/classify.ts
import type { SatelliteType } from './types';

/** Heuristic type from the satellite's catalogue name (CelesTrak names are stable, uppercase).
 *  Order matters: most specific first. NORAD id is reserved for future refinement. */
export function classifyByName(name: string, _noradId: number | null): SatelliteType {
  const n = name.toUpperCase();
  if (n.startsWith('STARLINK')) return 'starlink';
  if (n.includes('NAVSTAR') || /\bGPS\b/.test(n)) return 'gps';
  if (n.includes('NOAA') || n.includes('GOES') || n.includes('METEOR') || n.includes('METOP') || n.includes('DMSP')) return 'weather';
  if (n.includes('ISS') || n.includes('ZARYA') || n.includes('CSS') || n.includes('TIANHE') || n.includes('TIANGONG')) return 'station';
  if (n.includes('IRIDIUM') || n.includes('ONEWEB') || n.includes('INTELSAT') || n.includes('SES') || n.includes('GLOBALSTAR')) return 'comms';
  if (n.includes('LANDSAT') || n.includes('SENTINEL') || n.includes('TERRA') || n.includes('AQUA') || n.includes('WORLDVIEW')) return 'earth-obs';
  if (n.includes('HUBBLE') || n.includes('HST') || n.includes('TESS') || n.includes('SWIFT')) return 'scientific';
  return 'other';
}
```

- [ ] **Step 5: Run — Expected: PASS.** `pnpm exec vitest run test/sat-classify.test.ts`
- [ ] **Step 6: typecheck** `pnpm typecheck` (Expected: exit 0)
- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/geoint/satellites/types.ts src/renderer/modules/geoint/satellites/classify.ts test/sat-classify.test.ts
git commit -m "feat(geoint/satellites): domain types + name-based type classifier"
```

---

### Task 2: TLE parser

**Files:**
- Create: `src/renderer/modules/geoint/satellites/tle.ts`
- Test: `test/sat-tle.test.ts`

**Interfaces:**
- Consumes: `SatelliteRecord`, `classifyByName`.
- Produces: `parseTleText(text: string): SatelliteRecord[]`; `validateTlePair(name: string, line1: string, line2: string): { ok: true; record: SatelliteRecord } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/sat-tle.test.ts
import { describe, it, expect } from 'vitest';
import { parseTleText, validateTlePair } from '../src/renderer/modules/geoint/satellites/tle';

const ISS_L1 = '1 25544U 98067A   24079.07757601  .00016717  00000-0  30532-3 0  9993';
const ISS_L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815308434500';

describe('parseTleText', () => {
  it('parses a 3-line (named) TLE block into one record', () => {
    const recs = parseTleText(`ISS (ZARYA)\n${ISS_L1}\n${ISS_L2}\n`);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ name: 'ISS (ZARYA)', noradId: 25544, type: 'station', source: 'celestrak', active: true });
    expect(recs[0].line1).toBe(ISS_L1);
    expect(recs[0].id).toBe('sat-25544');
  });
  it('parses a 2-line (unnamed) block, name falls back to the catalog number', () => {
    const recs = parseTleText(`${ISS_L1}\n${ISS_L2}`);
    expect(recs).toHaveLength(1);
    expect(recs[0].noradId).toBe(25544);
    expect(recs[0].name).toBe('25544');
  });
  it('skips malformed blocks without throwing', () => {
    expect(parseTleText('garbage\nnot a tle\n')).toEqual([]);
    expect(parseTleText('')).toEqual([]);
  });
});

describe('validateTlePair', () => {
  it('accepts a well-formed pair', () => {
    const r = validateTlePair('ISS', ISS_L1, ISS_L2);
    expect(r.ok).toBe(true);
  });
  it('rejects lines that do not start with 1 / 2', () => {
    const r = validateTlePair('X', 'nope', 'nope');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('TLE') });
  });
});
```

- [ ] **Step 2: Run — Expected: FAIL** (`Cannot find module './tle'`). `pnpm exec vitest run test/sat-tle.test.ts`

- [ ] **Step 3: Write `tle.ts`**

```ts
// src/renderer/modules/geoint/satellites/tle.ts
/** Pure TLE parsing. Accepts CelesTrak FORMAT=tle text (3-line named blocks) and bare 2-line pairs.
 *  Never throws on bad input — malformed blocks are skipped (parseTleText) or reported (validateTlePair). */
import type { SatelliteRecord } from './types';
import { classifyByName } from './classify';

const isL1 = (s: string): boolean => /^1 /.test(s) && s.length >= 60;
const isL2 = (s: string): boolean => /^2 /.test(s) && s.length >= 60;

/** NORAD catalog number from TLE line 1 columns 3-7 (1-indexed). Returns null if not numeric. */
function noradFrom(line1: string): number | null {
  const n = parseInt(line1.slice(2, 7).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function makeRecord(name: string, line1: string, line2: string): SatelliteRecord {
  const noradId = noradFrom(line1);
  const cleanName = name.trim() || (noradId !== null ? String(noradId) : 'UNKNOWN');
  return {
    id: noradId !== null ? `sat-${noradId}` : `sat-${cleanName.replace(/\s+/g, '_')}`,
    name: cleanName,
    noradId,
    line1,
    line2,
    type: classifyByName(cleanName, noradId),
    source: 'celestrak',
    active: true,
    addedAt: ''
  };
}

export function parseTleText(text: string): SatelliteRecord[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const out: SatelliteRecord[] = [];
  let i = 0;
  while (i < lines.length) {
    const a = lines[i];
    if (a === '') { i++; continue; }
    // 3-line: name, L1, L2
    if (!isL1(a) && isL1(lines[i + 1] ?? '') && isL2(lines[i + 2] ?? '')) {
      out.push(makeRecord(a, lines[i + 1], lines[i + 2]));
      i += 3; continue;
    }
    // 2-line: L1, L2
    if (isL1(a) && isL2(lines[i + 1] ?? '')) {
      out.push(makeRecord('', a, lines[i + 1]));
      i += 2; continue;
    }
    i++; // unrecognized line — skip
  }
  return out;
}

export function validateTlePair(
  name: string, line1: string, line2: string
): { ok: true; record: SatelliteRecord } | { ok: false; error: string } {
  if (!isL1(line1) || !isL2(line2)) {
    return { ok: false, error: 'Invalid TLE: line 1 must start with "1 " and line 2 with "2 " (≥69 chars each).' };
  }
  return { ok: true, record: makeRecord(name, line1, line2) };
}
```

- [ ] **Step 4: Run — Expected: PASS.** `pnpm exec vitest run test/sat-tle.test.ts`
- [ ] **Step 5: typecheck** `pnpm typecheck`
- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/geoint/satellites/tle.ts test/sat-tle.test.ts
git commit -m "feat(geoint/satellites): pure TLE parser + manual-entry validator"
```

---

### Task 3: SGP4 propagation (satellite.js, vendored + verified)

**Files:**
- Modify: `package.json` (add `satellite.js` dependency)
- Create: `src/renderer/modules/geoint/satellites/propagate.ts`
- Test: `test/sat-propagate.test.ts`

**Interfaces:**
- Consumes: `SatelliteRecord`, `PropagatedSat`.
- Produces: `makePropagator(records: SatelliteRecord[]): Propagator`; `Propagator.propagateAt(date: Date): PropagatedSat[]`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add satellite.js@^5.0.0
```
Expected: `satellite.js` appears under `dependencies` in `package.json`; pure-JS, no native build.

- [ ] **Step 2: Write the failing test** (ISS reference + determinism)

```ts
// test/sat-propagate.test.ts
import { describe, it, expect } from 'vitest';
import { makePropagator } from '../src/renderer/modules/geoint/satellites/propagate';
import type { SatelliteRecord } from '../src/renderer/modules/geoint/satellites/types';

const iss: SatelliteRecord = {
  id: 'sat-25544', name: 'ISS (ZARYA)', noradId: 25544,
  line1: '1 25544U 98067A   24079.07757601  .00016717  00000-0  30532-3 0  9993',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815308434500',
  type: 'station', source: 'celestrak', active: true, addedAt: ''
};

describe('makePropagator', () => {
  const at = new Date('2024-03-19T12:00:00Z'); // fixed epoch → deterministic

  it('propagates the ISS to a plausible LEO position', () => {
    const [s] = makePropagator([iss]).propagateAt(at);
    expect(s.id).toBe('sat-25544');
    expect(s.lat).toBeGreaterThanOrEqual(-90); expect(s.lat).toBeLessThanOrEqual(90);
    expect(s.lon).toBeGreaterThanOrEqual(-180); expect(s.lon).toBeLessThanOrEqual(180);
    expect(s.altKm).toBeGreaterThan(300); expect(s.altKm).toBeLessThan(460);   // ISS ~410 km
    expect(s.velocityKmS).toBeGreaterThan(7); expect(s.velocityKmS).toBeLessThan(8); // ~7.66 km/s
    expect(s.inclinationDeg).toBeCloseTo(51.64, 1);
  });

  it('is deterministic for a fixed date', () => {
    const a = makePropagator([iss]).propagateAt(at);
    const b = makePropagator([iss]).propagateAt(at);
    expect(b).toEqual(a);
  });

  it('drops records SGP4 cannot propagate without throwing', () => {
    const bad: SatelliteRecord = { ...iss, id: 'sat-bad', line1: '1 00000U', line2: '2 00000' };
    expect(makePropagator([bad]).propagateAt(at)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run — Expected: FAIL** (`Cannot find module './propagate'`). `pnpm exec vitest run test/sat-propagate.test.ts`

- [ ] **Step 4: Write `propagate.ts`**

```ts
// src/renderer/modules/geoint/satellites/propagate.ts
/** SGP4 propagation wrapper. satellite.js (MIT) is the engine; callers never touch it directly so it
 *  could be swapped for a vendored SGP4 later. Pure given (records, date): no Date.now() inside — the
 *  caller supplies the instant (real-time motion is the caller's setInterval, a documented exception). */
import * as satellite from 'satellite.js';
import type { SatelliteRecord, PropagatedSat } from './types';

interface Prepared { rec: SatelliteRecord; satrec: satellite.SatRec; inclinationDeg: number; }
export interface Propagator { propagateAt(date: Date): PropagatedSat[]; }

const RAD2DEG = 180 / Math.PI;

export function makePropagator(records: SatelliteRecord[]): Propagator {
  const prepared: Prepared[] = [];
  for (const rec of records) {
    try {
      const satrec = satellite.twoline2satrec(rec.line1, rec.line2);
      if (satrec.error && satrec.error !== 0) continue;
      prepared.push({ rec, satrec, inclinationDeg: satrec.inclo * RAD2DEG });
    } catch { /* unparseable TLE — drop */ }
  }

  return {
    propagateAt(date: Date): PropagatedSat[] {
      const gmst = satellite.gstime(date);
      const out: PropagatedSat[] = [];
      for (const p of prepared) {
        const pv = satellite.propagate(p.satrec, date);
        const pos = pv.position;
        const vel = pv.velocity;
        if (!pos || typeof pos === 'boolean' || !vel || typeof vel === 'boolean') continue;
        if (![pos.x, pos.y, pos.z].every(Number.isFinite)) continue;
        const geo = satellite.eciToGeodetic(pos, gmst);
        out.push({
          id: p.rec.id, name: p.rec.name, noradId: p.rec.noradId, type: p.rec.type,
          lat: satellite.degreesLat(geo.latitude),
          lon: satellite.degreesLong(geo.longitude),
          altKm: geo.height,
          velocityKmS: Math.hypot(vel.x, vel.y, vel.z),
          inclinationDeg: p.inclinationDeg,
          active: p.rec.active
        });
      }
      return out;
    }
  };
}
```

- [ ] **Step 5: Run — Expected: PASS.** `pnpm exec vitest run test/sat-propagate.test.ts`
  - If `satellite.SatRec` type is unavailable in the installed version, replace `satellite.SatRec` with `ReturnType<typeof satellite.twoline2satrec>`.
- [ ] **Step 6: typecheck** `pnpm typecheck`
- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/modules/geoint/satellites/propagate.ts test/sat-propagate.test.ts
git commit -m "feat(geoint/satellites): SGP4 propagator over satellite.js (ISS reference-verified)"
```

---

### Task 4: Main persistence + gated CelesTrak fetch + snapshot + IPC

**Files:**
- Create: `src/main/services/satellites.ts`
- Modify: `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`
- Test: `test/satellites-service.test.ts`

**Interfaces:**
- Consumes: `secureReadText`/`secureWriteFile` (`src/main/storage/secure-fs`), `dataRoot` (`src/main/storage/paths`), `settingsStore` (same instance the threat-layer handler reads), `channels` / `safeHandle`.
- Produces (main module `satellites`): `list(): Promise<UserSat[]>`, `upsert(input): Promise<UserSat>`, `remove(id: string): Promise<void>`, `fetchGroup(group: string): Promise<string>` (raw TLE text; `[]`→`''` when network off), `snapshot(): Promise<string>` (bundled TLE-records JSON text).
- Produces (renderer API `window.api.satellites`): `list/upsert/remove/fetchGroup/snapshot`.

Note: the main service stores/returns `UserSat` = the persisted `SatelliteRecord` shape, declared locally in the service (main cannot import the renderer module; keep a structurally-identical interface and a shared note). Parsing of fetched/snapshot text into records happens renderer-side via `parseTleText` (Task 2) to keep one parser.

- [ ] **Step 1: Write the failing test** (persistence round-trip + network gate)

```ts
// test/satellites-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadText: vi.fn(async (p: string) => {
    if (!store.has(p)) { const e = new Error('no'); (e as NodeJS.ErrnoException).code = 'ENOENT'; throw e; }
    return store.get(p)!;
  }),
  secureWriteFile: vi.fn(async (p: string, d: string) => { store.set(p, d); })
}));
vi.mock('../src/main/storage/paths', () => ({ dataRoot: () => '/tmp/datax' }));
const netEnabled = { value: false };
vi.mock('../src/main/storage/settings-store', () => ({
  settingsStore: { read: async () => ({ geoint: { networkEnabled: netEnabled.value } }) }
}));

import * as sats from '../src/main/services/satellites';

beforeEach(() => { store.clear(); netEnabled.value = false; });

describe('satellites service', () => {
  it('upsert → list round-trips a user satellite', async () => {
    const rec = await sats.upsert({ name: 'MY SAT', noradId: null, line1: '1 x', line2: '2 x', type: 'other', tag: 't', active: true });
    expect(rec.id).toMatch(/^usat-/);
    const all = await sats.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'MY SAT', source: 'user', active: true });
  });
  it('remove deletes by id', async () => {
    const r = await sats.upsert({ name: 'X', noradId: null, line1: '1', line2: '2', type: 'other', active: true });
    await sats.remove(r.id);
    expect(await sats.list()).toEqual([]);
  });
  it('fetchGroup returns "" when the GeoINT network gate is OFF', async () => {
    netEnabled.value = false;
    expect(await sats.fetchGroup('active')).toBe('');
  });
});
```
(If the settings-store import path differs, mirror the path used by the existing threat-layer handler in `register.ts`.)

- [ ] **Step 2: Run — Expected: FAIL** (`Cannot find module '../src/main/services/satellites'`). `pnpm exec vitest run test/satellites-service.test.ts`

- [ ] **Step 3: Write `src/main/services/satellites.ts`**

```ts
// src/main/services/satellites.ts
/** Satellite storage + the gated CelesTrak fetch + bundled-snapshot loader.
 *  User satellites persist exactly like streams.ts (secure-fs, dataRoot/satellites.json).
 *  CelesTrak is fetched ONLY when settings.geoint.networkEnabled is true (the GeoINT egress gate). */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { settingsStore } from '../storage/settings-store';

export type SatType = 'starlink' | 'gps' | 'weather' | 'comms' | 'earth-obs' | 'station' | 'scientific' | 'other';
export interface UserSat {
  id: string; name: string; noradId: number | null; line1: string; line2: string;
  type: SatType; source: 'user'; tag?: string; notes?: string; active: boolean; addedAt: string;
}

function satsFile(): string { return join(dataRoot(), 'satellites.json'); }

async function readAll(): Promise<UserSat[]> {
  try { return JSON.parse(await secureReadText(satsFile())) as UserSat[]; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
}
async function writeAll(list: UserSat[]): Promise<void> {
  await secureWriteFile(satsFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<UserSat[]> { return readAll(); }

export async function upsert(
  input: Partial<UserSat> & { name: string; line1: string; line2: string; type: SatType; active: boolean }
): Promise<UserSat> {
  const all = await readAll();
  const id = input.id || `usat-${randomUUID()}`;
  const cleaned: UserSat = {
    id, name: input.name, noradId: input.noradId ?? null,
    line1: input.line1, line2: input.line2, type: input.type, source: 'user',
    tag: input.tag, notes: input.notes, active: input.active,
    addedAt: input.addedAt ?? new Date().toISOString()
  };
  const idx = all.findIndex((x) => x.id === id);
  if (idx >= 0) all[idx] = cleaned; else all.push(cleaned);
  await writeAll(all);
  return cleaned;
}

export async function remove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((x) => x.id !== id));
}

const CELESTRAK = (group: string): string =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
const ALLOWED_GROUPS = new Set(['active', 'stations', 'starlink', 'gps-ops', 'weather', 'science']);

/** Fetch a CelesTrak group as raw 3-line TLE text. Returns '' when the GeoINT network gate is off
 *  (the charter egress gate) or the group is not allowlisted. Throws on HTTP/timeout (caller toasts). */
export async function fetchGroup(group: string): Promise<string> {
  if (!ALLOWED_GROUPS.has(group)) return '';
  const enabled = (await settingsStore.read()).geoint?.networkEnabled;
  if (!enabled) return '';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(CELESTRAK(group), { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

/** Load the build-time bundled offline snapshot (TLE text). Returns '' if absent. */
export async function snapshot(): Promise<string> {
  try {
    const p = join(process.resourcesPath ?? join(process.cwd(), 'resources'), 'satellites', 'active-snapshot.tle');
    return await readFile(p, 'utf8');
  } catch { return ''; }
}
```
(If the settings-store module path/symbol differs, match exactly what `register.ts`'s threat-layer handler imports.)

- [ ] **Step 4: Run — Expected: PASS.** `pnpm exec vitest run test/satellites-service.test.ts`

- [ ] **Step 5: Add the channel group.** In `src/shared/ipc-contracts.ts`, after the `streams: { … }` block, add:

```ts
  satellites: {
    list: 'satellites:list',
    upsert: 'satellites:upsert',
    remove: 'satellites:remove',
    fetchGroup: 'satellites:fetchGroup',
    snapshot: 'satellites:snapshot'
  },
```

- [ ] **Step 6: Register handlers.** In `src/main/ipc/register.ts`, near the streams handlers, add (import the service as `import * as satellites from '../services/satellites'`):

```ts
  safeHandle(channels.satellites.list, () => satellites.list());
  safeHandle(channels.satellites.upsert, (...args) => satellites.upsert(args[0] as Parameters<typeof satellites.upsert>[0]));
  safeHandle(channels.satellites.remove, (...args) => satellites.remove(String(args[0])));
  safeHandle(channels.satellites.fetchGroup, (...args) => satellites.fetchGroup(String(args[0])));
  safeHandle(channels.satellites.snapshot, () => satellites.snapshot());
```

- [ ] **Step 7: Expose in preload.** In `src/preload/index.ts`, after the `streams` block:

```ts
  satellites: {
    list: () => ipcRenderer.invoke(channels.satellites.list),
    upsert: (input: unknown) => ipcRenderer.invoke(channels.satellites.upsert, input),
    remove: (id: string) => ipcRenderer.invoke(channels.satellites.remove, id),
    fetchGroup: (group: string) => ipcRenderer.invoke(channels.satellites.fetchGroup, group),
    snapshot: () => ipcRenderer.invoke(channels.satellites.snapshot)
  },
```

- [ ] **Step 8: Type the API.** In `src/preload/api.d.ts`, after the `streams` interface block:

```ts
  satellites: {
    list(): Promise<import('@shared/...').UserSat[]>; // use the service's UserSat type via a shared re-export, or inline the shape
    upsert(input: { id?: string; name: string; noradId: number | null; line1: string; line2: string; type: string; tag?: string; notes?: string; active: boolean }): Promise<{ id: string }>;
    remove(id: string): Promise<void>;
    fetchGroup(group: string): Promise<string>;
    snapshot(): Promise<string>;
  };
```
(Resolve the `UserSat` import to wherever the project keeps shared types; if there is no shared barrel, inline the return shape as `{ id: string; name: string; noradId: number | null; line1: string; line2: string; type: string; tag?: string; notes?: string; active: boolean; addedAt: string }[]`.)

- [ ] **Step 9: Run full suite + typecheck.** `pnpm exec vitest run test/satellites-service.test.ts && pnpm typecheck` (Expected: PASS, exit 0)
- [ ] **Step 10: Commit**

```bash
git add src/main/services/satellites.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/satellites-service.test.ts
git commit -m "feat(geoint/satellites): main persistence + gated CelesTrak fetch + snapshot + IPC"
```

---

### Task 5: Build-time snapshot + extraResources

**Files:**
- Create: `scripts/fetch-tle-snapshot.mjs`, `resources/satellites/README-SATELLITES.txt`
- Modify: `package.json` (script + extraResources)

**Interfaces:** none (build tooling).

- [ ] **Step 1: Write `scripts/fetch-tle-snapshot.mjs`** (mirrors `fetch-tor.mjs`; data, not executable — fail-soft, no SHA gate; keeps the last committed snapshot if the network is unavailable)

```js
// scripts/fetch-tle-snapshot.mjs
// Build-time: download the CelesTrak "active" group as 3-line TLE text and stage it as the bundled
// offline snapshot. Data, not an executable — if the network is unavailable, keep the existing file.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources', 'satellites');
const out = join(outDir, 'active-snapshot.tle');
const URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { get(res.headers.location).then(resolve, reject); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let buf = ''; res.setEncoding('utf8'); res.on('data', (c) => (buf += c)); res.on('end', () => resolve(buf));
    }).on('error', reject);
  });
}

mkdirSync(outDir, { recursive: true });
try {
  console.log(`[fetch-tle-snapshot] downloading ${URL}`);
  const text = await get(URL);
  if (!/^1 /m.test(text)) throw new Error('response did not look like TLE text');
  writeFileSync(out, text, 'utf8');
  console.log(`[fetch-tle-snapshot] wrote ${out} (${text.length} bytes)`);
} catch (e) {
  if (existsSync(out)) { console.warn(`[fetch-tle-snapshot] fetch failed (${e.message}); keeping existing snapshot`); }
  else { console.warn(`[fetch-tle-snapshot] fetch failed and no snapshot present (${e.message}); shipping without offline data`); }
}
```

- [ ] **Step 2: Write `resources/satellites/README-SATELLITES.txt`**

```
Bundled satellite TLE snapshot (offline default)
================================================
active-snapshot.tle is a dated CelesTrak "active" group dump (FORMAT=tle), staged by
`pnpm fetch:tle-snapshot` and shipped via electron-builder extraResources (-> resources/satellites).
It lets the Space Satellites layer show satellites with the GeoINT network OFF. Live refresh from
CelesTrak happens only when GeoINT network is enabled. This file is DATA (not executable) — fail-soft:
if the build-time fetch fails, the last committed snapshot is kept.
```

- [ ] **Step 3: Wire `package.json`.** Add to `scripts`: `"fetch:tle-snapshot": "node scripts/fetch-tle-snapshot.mjs"`. Add it to `package` and `package:win` chains (before `pnpm build`). Add to `build.extraResources`:

```json
      {
        "from": "resources/satellites",
        "to": "satellites"
      },
```

- [ ] **Step 4: Verify the script runs** (network-permitting; fail-soft otherwise): `node scripts/fetch-tle-snapshot.mjs` — Expected: writes `resources/satellites/active-snapshot.tle` or warns and keeps existing.
- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-tle-snapshot.mjs resources/satellites/README-SATELLITES.txt package.json
git commit -m "build(geoint/satellites): bundled offline TLE snapshot + extraResources"
```

---

### Task 6: GeoJSON layer + FeatureCollection builder

**Files:**
- Create: `src/renderer/modules/geoint/satellites/satelliteLayer.ts`
- Test: `test/sat-layer.test.ts`

**Interfaces:**
- Consumes: `PropagatedSat`, `SatelliteType`, `maplibregl`.
- Produces: `buildSatelliteFeatures(sats: PropagatedSat[], visibleTypes: Set<SatelliteType> | null): GeoJSON.FeatureCollection`; `SAT_SOURCE_ID`, `SAT_LAYER_ID`, `SAT_TYPE_COLORS`; `ensureSatelliteLayer(map, onSelect)`; `updateSatelliteLayer(map, sats, visibleTypes)`; `removeSatelliteLayer(map)`.

- [ ] **Step 1: Write the failing test** (pure builder)

```ts
// test/sat-layer.test.ts
import { describe, it, expect } from 'vitest';
import { buildSatelliteFeatures } from '../src/renderer/modules/geoint/satellites/satelliteLayer';
import type { PropagatedSat } from '../src/renderer/modules/geoint/satellites/types';

const mk = (id: string, type: PropagatedSat['type'], lon: number, lat: number): PropagatedSat => ({
  id, name: id, noradId: 1, type, lat, lon, altKm: 500, velocityKmS: 7.5, inclinationDeg: 53, active: true
});

describe('buildSatelliteFeatures', () => {
  it('emits one point feature per sat in [lng, lat] order with props', () => {
    const fc = buildSatelliteFeatures([mk('a', 'starlink', 10, 20)], null);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [10, 20] });
    expect(fc.features[0].properties).toMatchObject({ id: 'a', type: 'starlink' });
  });
  it('applies the type filter when a Set is given', () => {
    const fc = buildSatelliteFeatures([mk('a', 'starlink', 0, 0), mk('b', 'gps', 1, 1)], new Set(['gps'] as const));
    expect(fc.features.map((f) => f.properties!.id)).toEqual(['b']);
  });
  it('null filter passes everything', () => {
    expect(buildSatelliteFeatures([mk('a', 'gps', 0, 0), mk('b', 'weather', 1, 1)], null).features).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — Expected: FAIL.** `pnpm exec vitest run test/sat-layer.test.ts`

- [ ] **Step 3: Write `satelliteLayer.ts`**

```ts
// src/renderer/modules/geoint/satellites/satelliteLayer.ts
/** GPU GeoJSON layer for satellites — one source + one circle layer, color-coded by type. Updated
 *  imperatively each propagation tick (source.setData). Scales to ~10k points; MapLibre culls
 *  offscreen features. buildSatelliteFeatures is pure + unit-tested. */
import maplibregl from 'maplibre-gl';
import type { PropagatedSat, SatelliteType } from './types';

export const SAT_SOURCE_ID = 'ga98-satellites';
export const SAT_LAYER_ID = 'ga98-satellites-circles';

export const SAT_TYPE_COLORS: Record<SatelliteType, string> = {
  starlink: '#ffd166', gps: '#06d6a0', weather: '#4cc9f0', comms: '#b388ff',
  'earth-obs': '#90be6d', station: '#ff6b6b', scientific: '#f7b2ad', other: '#cfd8dc'
};

export function buildSatelliteFeatures(
  sats: PropagatedSat[], visibleTypes: Set<SatelliteType> | null
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of sats) {
    if (visibleTypes && !visibleTypes.has(s.type)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, type: s.type, altKm: Math.round(s.altKm), velocityKmS: +s.velocityKmS.toFixed(2) }
    });
  }
  return { type: 'FeatureCollection', features };
}

const colorExpr = (): maplibregl.ExpressionSpecification => {
  const m: (string | maplibregl.ExpressionSpecification)[] = ['match', ['get', 'type']];
  for (const [k, v] of Object.entries(SAT_TYPE_COLORS)) m.push(k, v);
  m.push(SAT_TYPE_COLORS.other);
  return m as unknown as maplibregl.ExpressionSpecification;
};

/** Create the source+layer once and wire feature clicks → onSelect(id). Idempotent. */
export function ensureSatelliteLayer(map: maplibregl.Map, onSelect: (id: string) => void): void {
  if (map.getSource(SAT_SOURCE_ID)) return;
  map.addSource(SAT_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: SAT_LAYER_ID, type: 'circle', source: SAT_SOURCE_ID,
    paint: { 'circle-radius': 3, 'circle-color': colorExpr(), 'circle-stroke-width': 0.5, 'circle-stroke-color': '#000' }
  });
  map.on('click', SAT_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === 'string') onSelect(id);
  });
  map.on('mouseenter', SAT_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', SAT_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
}

export function updateSatelliteLayer(map: maplibregl.Map, sats: PropagatedSat[], visibleTypes: Set<SatelliteType> | null): void {
  const src = map.getSource(SAT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(buildSatelliteFeatures(sats, visibleTypes));
}

export function removeSatelliteLayer(map: maplibregl.Map): void {
  if (map.getLayer(SAT_LAYER_ID)) map.removeLayer(SAT_LAYER_ID);
  if (map.getSource(SAT_SOURCE_ID)) map.removeSource(SAT_SOURCE_ID);
}
```

- [ ] **Step 4: Run — Expected: PASS.** `pnpm exec vitest run test/sat-layer.test.ts`
- [ ] **Step 5: typecheck** `pnpm typecheck` (resolve any MapLibre expression typing by casting as shown)
- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/geoint/satellites/satelliteLayer.ts test/sat-layer.test.ts
git commit -m "feat(geoint/satellites): GPU GeoJSON layer + pure FeatureCollection builder"
```

---

### Task 7: MapGL integration — propagation tick + layer + click

**Files:**
- Modify: `src/renderer/modules/geoint/MapGL.tsx`

**Interfaces:**
- Consumes: `SatelliteRecord`, `makePropagator`, `ensureSatelliteLayer`/`updateSatelliteLayer`/`removeSatelliteLayer`, `PropagatedSat`, `SatelliteType`.
- Produces (new `MapGLProps`): `satRecords?: SatelliteRecord[]`, `showSatellites?: boolean`, `satVisibleTypes?: Set<SatelliteType> | null`, `onSatelliteSelect?: (id: string) => void`, `onSatellitesPropagated?: (sats: PropagatedSat[]) => void`, `trackSatId?: string | null`, `satTickMs?: number` (default 2000).

This task has no unit test (map/React); verified by `pnpm typecheck` + `electron-vite build` + manual smoke. Keep all new logic ref-driven so the map is never re-initialized (match the CCTV pattern).

- [ ] **Step 1: Extend `MapGLProps`** (add after `onCameraOpen?`):

```ts
  /** Satellite records to propagate + draw (already merged: snapshot ∪ active user ∪ celestrak). */
  satRecords?: import('./satellites/types').SatelliteRecord[];
  showSatellites?: boolean;
  satVisibleTypes?: Set<import('./satellites/types').SatelliteType> | null;
  onSatelliteSelect?: (id: string) => void;
  /** Latest propagated set each tick — the panel table consumes this. */
  onSatellitesPropagated?: (sats: import('./satellites/types').PropagatedSat[]) => void;
  /** When set, recenter on this satellite each tick (Track/follow). */
  trackSatId?: string | null;
  /** Propagation cadence in ms (default 2000). */
  satTickMs?: number;
```

- [ ] **Step 2: Destructure + refs.** In the props destructure add `satRecords = [], showSatellites = false, satVisibleTypes = null, onSatelliteSelect, onSatellitesPropagated, trackSatId = null, satTickMs = 2000`. Add imports at top:

```ts
import { makePropagator } from './satellites/propagate';
import { ensureSatelliteLayer, updateSatelliteLayer, removeSatelliteLayer } from './satellites/satelliteLayer';
import type { PropagatedSat } from './satellites/types';
```
Add refs (next to the cctv refs):

```ts
  const satVisibleRef = useRef(satVisibleTypes); satVisibleRef.current = satVisibleTypes;
  const onSatSelectRef = useRef(onSatelliteSelect); onSatSelectRef.current = onSatelliteSelect;
  const onSatPropRef = useRef(onSatellitesPropagated); onSatPropRef.current = onSatellitesPropagated;
  const trackSatRef = useRef(trackSatId); trackSatRef.current = trackSatId;
  const propagatorRef = useRef<ReturnType<typeof makePropagator> | null>(null);
```

- [ ] **Step 3: Ensure the layer at map init.** Inside the map-init `useEffect` (after `map.current = m;` is set, but the create call returns `m`), add — right after the cctv listeners are attached:

```ts
    ensureSatelliteLayer(m, (id) => onSatSelectRef.current?.(id));
```

- [ ] **Step 4: Rebuild the propagator when records change.**

```ts
  useEffect(() => {
    propagatorRef.current = makePropagator(satRecords);
  }, [satRecords]);
```

- [ ] **Step 5: The propagation tick** (interval only while visible; uses `new Date()` — the documented real-time exception):

```ts
  useEffect(() => {
    const m = map.current;
    if (!m || !showSatellites) {
      if (m && m.getSource('ga98-satellites')) updateSatelliteLayer(m, [], satVisibleRef.current);
      return;
    }
    const tick = (): void => {
      const mm = map.current; const prop = propagatorRef.current;
      if (!mm || !prop) return;
      const sats: PropagatedSat[] = prop.propagateAt(new Date());
      updateSatelliteLayer(mm, sats, satVisibleRef.current);
      onSatPropRef.current?.(sats);
      const tid = trackSatRef.current;
      if (tid) { const s = sats.find((x) => x.id === tid); if (s) mm.easeTo({ center: [s.lon, s.lat], duration: 400 }); }
    };
    tick();
    const h = setInterval(tick, satTickMs);
    return () => clearInterval(h);
  }, [showSatellites, satRecords, satTickMs]);
```

- [ ] **Step 6: Re-filter without re-propagating** (when only the type filter toggles, the next tick applies it; to make it instant, also update on filter change is optional). Leave to the tick for v1.

- [ ] **Step 7: Verify.** `pnpm typecheck && node_modules/.bin/electron-vite build` (Expected: both succeed). Manual smoke deferred to Task 10.
- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/geoint/MapGL.tsx
git commit -m "feat(geoint/satellites): MapGL propagation tick + GeoJSON layer + click/track"
```

---

### Task 8: Space Satellites panel (toggle, table, status, filters, export)

**Files:**
- Create: `src/renderer/modules/geoint/satellites/SpaceSatellitesPanel.tsx`

**Interfaces:**
- Consumes: `PropagatedSat`, `SatelliteType`, `SAT_GROUPS`, `SAT_TYPE_COLORS`, `window.api.satellites`.
- Produces: `<SpaceSatellitesPanel>` props: `{ show: boolean; onToggle(b): void; propagated: PropagatedSat[]; total: number; visibleTypes: Set<SatelliteType> | null; onVisibleTypes(s): void; group: string; onGroup(g): void; onRefresh(): void; lastUpdate: string | null; networkEnabled: boolean; onTrack(id): void; onCenter(id): void; onDetails(id): void; }`.

No unit test (React) — typecheck + build + smoke. This is the bottom-left "SPACE SATELLITES" panel from the mock.

- [ ] **Step 1: Write `SpaceSatellitesPanel.tsx`** (sortable table of the *visible* set, capped; status "visible N / M"; Export to JSON via the save dialog; type-filter checkboxes; Refresh gated by `networkEnabled`):

```tsx
// src/renderer/modules/geoint/satellites/SpaceSatellitesPanel.tsx
import { useMemo, useState } from 'react';
import type { PropagatedSat, SatelliteType } from './types';
import { SAT_GROUPS } from './types';
import { SAT_TYPE_COLORS } from './satelliteLayer';

const TYPES = Object.keys(SAT_TYPE_COLORS) as SatelliteType[];
const ROW_CAP = 500;
type SortKey = 'name' | 'type' | 'altKm' | 'velocityKmS' | 'inclinationDeg';

export interface SpaceSatellitesPanelProps {
  show: boolean; onToggle(b: boolean): void;
  propagated: PropagatedSat[]; total: number;
  visibleTypes: Set<SatelliteType> | null; onVisibleTypes(s: Set<SatelliteType> | null): void;
  group: string; onGroup(g: string): void;
  onRefresh(): void; lastUpdate: string | null; networkEnabled: boolean;
  onTrack(id: string): void; onCenter(id: string): void; onDetails(id: string): void;
}

export function SpaceSatellitesPanel(p: SpaceSatellitesPanelProps): JSX.Element {
  const [sort, setSort] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);
  const rows = useMemo(() => {
    const filtered = p.visibleTypes ? p.propagated.filter((s) => p.visibleTypes!.has(s.type)) : p.propagated;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sort], bv = b[sort];
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return asc ? c : -c;
    });
    return sorted;
  }, [p.propagated, p.visibleTypes, sort, asc]);

  const toggleType = (t: SatelliteType): void => {
    const cur = p.visibleTypes ?? new Set(TYPES);
    const next = new Set(cur);
    next.has(t) ? next.delete(t) : next.add(t);
    p.onVisibleTypes(next.size === TYPES.length ? null : next);
  };

  const exportJson = (): void => {
    const blob = JSON.stringify(rows, null, 2);
    void window.api.system.saveTextFile?.('satellites-export.json', blob); // use the existing save-dialog IPC; if named differently, match it
  };

  const th = (k: SortKey, label: string): JSX.Element => (
    <th style={{ cursor: 'pointer' }} onClick={() => { setSort(k); setAsc(k === sort ? !asc : true); }}>{label}{sort === k ? (asc ? ' ▲' : ' ▼') : ''}</th>
  );

  return (
    <fieldset style={{ marginTop: 6 }}>
      <legend>Space Satellites</legend>
      <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={p.show} onChange={(e) => p.onToggle(e.target.checked)} />
        Show Space Satellites ({p.total})
      </label>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <select className="ga98-text" value={p.group} onChange={(e) => p.onGroup(e.target.value)}>
          {SAT_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <button onClick={p.onRefresh} disabled={!p.networkEnabled} title={p.networkEnabled ? 'Refresh from CelesTrak' : 'Enable GeoINT network to refresh'}>Refresh</button>
        <button onClick={exportJson} disabled={!rows.length}>Export…</button>
      </div>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
        Satellites visible: {rows.length} / {p.total}{p.lastUpdate ? ` · updated ${p.lastUpdate}` : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, margin: '4px 0' }}>
        {TYPES.map((t) => (
          <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <input type="checkbox" checked={!p.visibleTypes || p.visibleTypes.has(t)} onChange={() => toggleType(t)} />
            <span style={{ width: 8, height: 8, background: SAT_TYPE_COLORS[t], display: 'inline-block' }} />{t}
          </label>
        ))}
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        <table style={{ fontSize: 11, width: '100%' }}>
          <thead><tr>{th('name', 'Name')}{th('type', 'Type')}{th('altKm', 'Alt km')}{th('velocityKmS', 'Vel km/s')}{th('inclinationDeg', 'Incl')}<th></th></tr></thead>
          <tbody>
            {rows.slice(0, ROW_CAP).map((s) => (
              <tr key={s.id}>
                <td title={s.name}>{s.name}</td><td>{s.type}</td><td>{Math.round(s.altKm)}</td>
                <td>{s.velocityKmS.toFixed(2)}</td><td>{s.inclinationDeg.toFixed(1)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => p.onCenter(s.id)} title="Center">◎</button>
                  <button onClick={() => p.onTrack(s.id)} title="Track">⊙</button>
                  <button onClick={() => p.onDetails(s.id)} title="Details">ℹ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > ROW_CAP && <div style={{ fontSize: 10, opacity: 0.7 }}>Showing first {ROW_CAP} of {rows.length} (filter to narrow).</div>}
      </div>
    </fieldset>
  );
}
```
Note: if there is no `window.api.system.saveTextFile`, use the same save-dialog IPC the EyeSpy `exportCctv` uses (check `register.ts`); the implementer wires Export to that. Export is allowed to be a Minor follow-up if no generic text-save IPC exists — flag it, don't invent egress.

- [ ] **Step 2: Verify.** `pnpm typecheck` (fix any prop typing). Build verified in Task 10.
- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/geoint/satellites/SpaceSatellitesPanel.tsx
git commit -m "feat(geoint/satellites): Space Satellites panel — toggle, table, filters, export"
```

---

### Task 9: Satellite Manager (add + import)

**Files:**
- Create: `src/renderer/modules/geoint/satellites/SatelliteManager.tsx`

**Interfaces:**
- Consumes: `validateTlePair`, `parseTleText`, `window.api.satellites`, `SatelliteType`.
- Produces: `<SatelliteManager>` props `{ onAdded(): void }` (parent reloads user sats after add/import).

- [ ] **Step 1: Write `SatelliteManager.tsx`** (Add New Satellite via Name + TLE 2-line + type/tag/active; Import via pasted TLE text → `parseTleText` → bulk `upsert`):

```tsx
// src/renderer/modules/geoint/satellites/SatelliteManager.tsx
import { useState } from 'react';
import type { SatelliteType } from './types';
import { validateTlePair, parseTleText } from './tle';

const TYPES: SatelliteType[] = ['starlink', 'gps', 'weather', 'comms', 'earth-obs', 'station', 'scientific', 'other'];

export function SatelliteManager({ onAdded }: { onAdded: () => void }): JSX.Element {
  const [tab, setTab] = useState<'add' | 'import'>('add');
  const [name, setName] = useState(''); const [type, setType] = useState<SatelliteType>('other');
  const [tag, setTag] = useState(''); const [l1, setL1] = useState(''); const [l2, setL2] = useState('');
  const [active, setActive] = useState(true); const [err, setErr] = useState<string | null>(null);
  const [bulk, setBulk] = useState(''); const [msg, setMsg] = useState<string | null>(null);

  const add = async (): Promise<void> => {
    const v = validateTlePair(name, l1.trim(), l2.trim());
    if (!v.ok) { setErr(v.error); return; }
    setErr(null);
    await window.api.satellites.upsert({ name: name.trim() || String(v.record.noradId ?? 'UNKNOWN'), noradId: v.record.noradId, line1: l1.trim(), line2: l2.trim(), type, tag: tag.trim() || undefined, active });
    setName(''); setL1(''); setL2(''); setTag(''); onAdded();
  };

  const importBulk = async (): Promise<void> => {
    const recs = parseTleText(bulk);
    if (!recs.length) { setMsg('No valid TLE blocks found.'); return; }
    for (const r of recs) await window.api.satellites.upsert({ name: r.name, noradId: r.noradId, line1: r.line1, line2: r.line2, type: r.type, active: true });
    setMsg(`Imported ${recs.length} satellite(s).`); setBulk(''); onAdded();
  };

  return (
    <fieldset style={{ marginTop: 6 }}>
      <legend>Space Satellite Manager</legend>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <button data-active={tab === 'add'} onClick={() => setTab('add')}>Add New Satellite</button>
        <button data-active={tab === 'import'} onClick={() => setTab('import')}>Import (TLE)</button>
      </div>
      {tab === 'add' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          <input className="ga98-text" placeholder="Name / Designation" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="ga98-text" value={type} onChange={(e) => setType(e.target.value as SatelliteType)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <textarea className="ga98-text" rows={2} placeholder="TLE line 1 (1 …)" value={l1} onChange={(e) => setL1(e.target.value)} />
          <textarea className="ga98-text" rows={2} placeholder="TLE line 2 (2 …)" value={l2} onChange={(e) => setL2(e.target.value)} />
          <input className="ga98-text" placeholder="Optional tag / notes" value={tag} onChange={(e) => setTag(e.target.value)} />
          <label style={{ display: 'inline-flex', gap: 4 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Set active (show on globe)</label>
          {err && <div style={{ color: '#900' }}>{err}</div>}
          <button onClick={() => void add()}>Add Satellite</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          <textarea className="ga98-text" rows={6} placeholder="Paste TLE text (2- or 3-line blocks)…" value={bulk} onChange={(e) => setBulk(e.target.value)} />
          {msg && <div style={{ opacity: 0.8 }}>{msg}</div>}
          <button onClick={() => void importBulk()}>Import</button>
        </div>
      )}
    </fieldset>
  );
}
```
(File-picker import can reuse an existing file-read IPC if one exists; paste-import covers v1. If a file dialog is wanted, wire the same one EyeSpy import uses — do not add new IPC surface beyond what exists.)

- [ ] **Step 2: typecheck** `pnpm typecheck`
- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/geoint/satellites/SatelliteManager.tsx
git commit -m "feat(geoint/satellites): manager — add + paste-import TLE"
```

---

### Task 10: GeoIntModule wiring + legend + docs

**Files:**
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx`, `README.md`

**Interfaces:** consumes everything above.

- [ ] **Step 1: State + data load.** In `GeoIntModule`, near the `showCctv` state, add:

```tsx
  const [showSatellites, setShowSatellites] = useState(false);
  const [satRecords, setSatRecords] = useState<import('./satellites/types').SatelliteRecord[]>([]);
  const [satPropagated, setSatPropagated] = useState<import('./satellites/types').PropagatedSat[]>([]);
  const [satVisibleTypes, setSatVisibleTypes] = useState<Set<import('./satellites/types').SatelliteType> | null>(null);
  const [satGroup, setSatGroup] = useState('active');
  const [satLastUpdate, setSatLastUpdate] = useState<string | null>(null);
  const [trackSatId, setTrackSatId] = useState<string | null>(null);
```

Add a loader that merges snapshot + active user sats (called on first toggle-on):

```tsx
  const loadSatellites = useCallback(async () => {
    const { parseTleText } = await import('./satellites/tle');
    const snap = parseTleText(await window.api.satellites.snapshot());
    const users = (await window.api.satellites.list()).filter((u) => u.active)
      .map((u) => ({ id: u.id, name: u.name, noradId: u.noradId, line1: u.line1, line2: u.line2, type: u.type as import('./satellites/types').SatelliteType, source: 'user' as const, active: true, addedAt: u.addedAt }));
    setSatRecords([...snap, ...users]);
  }, []);
  useEffect(() => { if (showSatellites && satRecords.length === 0) void loadSatellites(); }, [showSatellites, satRecords.length, loadSatellites]);
```

Refresh from CelesTrak (gated; `net` is the existing `networkEnabled` local):

```tsx
  const refreshSatellites = useCallback(async () => {
    if (!net) { toast.warn('Enable GeoINT network to refresh satellites from CelesTrak.'); return; }
    try {
      const { parseTleText } = await import('./satellites/tle');
      const recs = parseTleText(await window.api.satellites.fetchGroup(satGroup));
      if (recs.length) { setSatRecords(recs); setSatLastUpdate(new Date().toLocaleTimeString()); }
      else toast.warn('CelesTrak returned no satellites.');
    } catch (e) { toast.error(`CelesTrak: ${(e as Error).message}`); }
  }, [net, satGroup]);
```

- [ ] **Step 2: Render the panels** in the left rail, next to the CCTV fieldset:

```tsx
        <SpaceSatellitesPanel
          show={showSatellites} onToggle={setShowSatellites}
          propagated={satPropagated} total={satRecords.length}
          visibleTypes={satVisibleTypes} onVisibleTypes={setSatVisibleTypes}
          group={satGroup} onGroup={setSatGroup}
          onRefresh={() => void refreshSatellites()} lastUpdate={satLastUpdate} networkEnabled={net}
          onTrack={setTrackSatId} onCenter={(id) => setTrackSatId(id)} onDetails={(id) => setTrackSatId(id)}
        />
        <SatelliteManager onAdded={() => void loadSatellites()} />
```
(Imports: `import { SpaceSatellitesPanel } from './satellites/SpaceSatellitesPanel'; import { SatelliteManager } from './satellites/SatelliteManager';`. For v1, Center and Details both focus/track the sat; a richer detail popup is optional follow-up — keep within scope, no fabricated UI.)

- [ ] **Step 3: Pass to MapGL** — add to the `<MapGL … />` usage:

```tsx
          satRecords={satRecords}
          showSatellites={showSatellites}
          satVisibleTypes={satVisibleTypes}
          onSatelliteSelect={(id) => setTrackSatId(id)}
          onSatellitesPropagated={setSatPropagated}
          trackSatId={trackSatId}
```

- [ ] **Step 4: Verify end-to-end.** `pnpm typecheck && pnpm exec vitest run && node_modules/.bin/electron-vite build` — Expected: typecheck clean, all tests green (existing + new), build clean.

- [ ] **Step 5: Docs.** Add a README Status entry for the next version (the version bump itself is a release step, not this plan) describing the Space Satellites layer, and a module-table row under GeoINT noting "space-satellite layer (CelesTrak default behind the network opt-in + offline snapshot; add/import your own TLEs)". Note no new egress except `celestrak.org` behind the existing GeoINT opt-in.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/geoint/GeoIntModule.tsx README.md
git commit -m "feat(geoint/satellites): wire panels + map, type-filter legend, docs"
```

---

## Self-review

**Spec coverage:** toggle (T8/T10) · CelesTrak default behind network opt-in (T4 gate, T10 refresh) · offline snapshot (T4 `snapshot`, T5 build) · add-your-own + import (T9) · GPU GeoJSON ~10k (T6/T7) · SGP4 via satellite.js vendored+verified (T3) · table/Track/Center/Details/Export/Filters (T8) · type classify + legend (T1/T8) · persistence via secure-fs (T4) · determinism note + fixed-date tests (T3) · errors (toast on net-off/fetch-fail T10, reject bad TLE T9, ENOENT→[] T4). All spec sections map to a task.

**Placeholder scan:** No TBD/TODO. Two honest "match existing IPC" notes (settings-store import path in T4; text-save IPC for Export in T8) — these are "use the established symbol, don't invent" instructions, not missing code; the implementer confirms the exact name from `register.ts`. Export is explicitly allowed to degrade to a flagged follow-up if no generic text-save IPC exists (no fabricated egress).

**Type consistency:** `SatelliteRecord`/`PropagatedSat`/`SatelliteType` defined in T1, used identically in T2/T3/T6/T7/T8/T9/T10. `makePropagator(records).propagateAt(date)` signature consistent T3↔T7. `buildSatelliteFeatures(sats, visibleTypes)` consistent T6↔(internal). Channel names `satellites.{list,upsert,remove,fetchGroup,snapshot}` consistent T4 across contracts/register/preload/api.d. Main `UserSat` is structurally aligned with renderer `SatelliteRecord` (documented divergence: main can't import renderer types).
