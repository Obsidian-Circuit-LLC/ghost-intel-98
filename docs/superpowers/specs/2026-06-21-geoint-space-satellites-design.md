# GeoINT Space Satellites — Design

**Date:** 2026-06-21
**Status:** Approved design → implementation plan
**Module:** GeoINT (core app `/dcs98`, repo `Obsidian-Circuit-LLC/ghost-intel-98`)

## Goal

A toggleable GeoINT **Space Satellites** layer: enable it and every satellite in the active
catalogue is propagated from its TLE and drawn — moving — on the MapLibre globe, with a sortable
data table, click-to-detail, follow/center actions, export, type filters, and a manager for
importing or hand-entering your own satellites. Default catalogue comes from CelesTrak, fetched only
behind the existing GeoINT network opt-in, with a bundled offline snapshot so the layer works with
the network off. Modeled on the existing CCTV camera layer.

## Decisions (locked)

- **Data + egress:** CelesTrak (`https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=json`)
  fetched ONLY in the main process, ONLY when `settings.geoint.networkEnabled` is true — the same gate
  the threat-layer/RSS fetchers already use. A small dated TLE snapshot is bundled so the layer shows
  satellites with the network off. New egress host `celestrak.org` is operator-authorized.
- **Propagation:** SGP4 via **satellite.js** (MIT, pure-JS), used through our own `propagate.ts`
  interface, **vendored/version-pinned**, and **verified against published reference vectors** in
  tests. (Interpretation of the operator's "both": proven implementation + own/verify the critical
  path. If the operator instead wants two independent SGP4 implementations cross-checked, this section
  is revised in plan review.)
- **Rendering:** one MapLibre **GeoJSON source + circle/symbol layer**, GPU-rendered, updated each
  propagation tick. No DOM markers / manual clustering (that does not scale to ~10k moving points).
- **v1 scope:** the full mocked panel — toggle, globe icons, motion, sortable table with
  Track/Center/Details, Export, Filters, plus the Space Satellite Manager (add + TLE/file import).
- **Track vs Center:** Center = one-time `flyTo`; Track = follow (recenter on the satellite each tick
  until cleared). **Orbit-path / ground-track lines are NOT in v1** (icons only, moving); optional v1.1.
- **Out of scope (future specs):** maritime AIS and aviation ADS-B (real-time streaming feeds, keyed
  APIs, different trust model).

## Global constraints

- No telemetry, no analytics, no phone-home.
- No new network egress beyond `celestrak.org`, and that strictly behind `settings.geoint.networkEnabled`.
- Renderer is untrusted; CelesTrak content is remote/attacker-influenced — parse defensively, never
  build HTML strings (use `textContent`, mirroring `popup.ts`).
- Determinism in correctness-critical paths. SGP4 position depends on current wall-clock — a
  *justified, documented* `Date.now()` exception (real-time orbital display). `propagate()` itself is
  deterministic given `(records, date)`; tests pin a fixed date.
- TypeScript strict; `pnpm typecheck` + `pnpm test` green; renderer verified via typecheck + build +
  manual smoke (vitest is node-env, no React render harness).

## Architecture & file layout

Renderer — new dir `src/renderer/modules/geoint/satellites/`:

| File | Responsibility | Purity |
|---|---|---|
| `types.ts` | `SatelliteRecord`, `SatelliteType`, `PropagatedSat`, data-source descriptors | types only |
| `tle.ts` | parse CelesTrak OMM/GP JSON → records; parse classic 2-/3-line TLE text → records; validate one record | pure |
| `propagate.ts` | SGP4 wrapper over satellite.js: `makePropagator(records) → propagateAt(date): PropagatedSat[]`; ECI→geodetic + velocity magnitude + inclination | pure given `(records, date)` |
| `classify.ts` | derive `SatelliteType` from CelesTrak group / name / NORAD heuristics | pure |
| `satelliteLayer.ts` | ensure/update/remove the GeoJSON source+layer; build FeatureCollection from `PropagatedSat[]`; wire click→`onSelect(id)` | builder pure; map side effectful |
| `SpaceSatellitesPanel.tsx` | "Show Space Satellites" toggle, data-source dropdown, Refresh, status ("visible N / M", last update), sortable table (Name, NORAD ID, Type, Altitude, Velocity, Inclination, Status), row actions Track/Center/Details, Export, Filters | React |
| `SatelliteManager.tsx` | Add New Satellite (Name, NORAD, Type, TLE 2-line set, Optional tag/notes, Set active) + Import (TLE/file) tabs | React |

Main process:

- `src/main/services/satellites.ts` — secure-fs persistence of USER satellites
  (`dataRoot/satellites.json`: `list()`, `upsert(record)`, `remove(id)`); `fetchGroup(group)` —
  CelesTrak fetch gated by `networkEnabled` (returns `[]`/error when off); `snapshot()` — load the
  bundled `resources/satellites/active-snapshot.json`.
- IPC: `channels.satellites.{list, upsert, remove, fetchGroup, snapshot}` registered in
  `src/main/ipc/register.ts`; exposed in `src/preload/index.ts` + typed in `src/preload/api.d.ts`.

Build:

- `scripts/fetch-tle-snapshot.mjs` — pull the CelesTrak `active` group at build time, stamp the date,
  write `resources/satellites/active-snapshot.json` (mirrors the fetch-piper/fetch-tor pattern; the
  snapshot is data, not an executable — date-stamped, no SHA gate required, fail-soft if unreachable
  by reusing the last committed snapshot).
- `package.json` `build.extraResources` += `{ from: "resources/satellites", to: "satellites" }`.

Wiring:

- `GeoIntModule.tsx` — `showSatellites` toggle state (ephemeral, like `showCctv`), mount the two
  panels, pass the propagated set + `networkEnabled` down, reuse `patchGeo`/network seam for Refresh.
- `MapGL.tsx` — own the propagation `setInterval` tick (visible + focused), call
  `updateSatelliteLayer`, and wire feature click → detail popup / selection.

## Data model

```ts
type SatelliteType =
  | 'starlink' | 'gps' | 'weather' | 'comms' | 'earth-obs' | 'station' | 'scientific' | 'other';

interface SatelliteRecord {
  id: string;            // stable: noradId when known, else hash of name+line1
  name: string;
  noradId: number | null;
  line1: string;         // TLE line 1 (canonical orbital data fed to SGP4)
  line2: string;         // TLE line 2
  type: SatelliteType;
  source: 'snapshot' | 'celestrak' | 'user';
  tag?: string;
  notes?: string;
  active: boolean;       // user "Set active" flag; non-active user sats are stored but not drawn
  addedAt: string;       // ISO
}

interface PropagatedSat {
  id: string; name: string; noradId: number | null; type: SatelliteType;
  lat: number; lon: number; altKm: number; velocityKmS: number; inclinationDeg: number;
  active: boolean;
}
```

OMM/GP JSON is converted to TLE `line1`/`line2` on ingest so propagation has exactly one input shape.

## Data flow

1. Toggle ON → record set = bundled snapshot ∪ active user satellites ∪ last CelesTrak pull (if any).
2. **Refresh** (only when `networkEnabled`): main `fetchGroup(selectedGroup)` → `parseCelestrakJson`
   → replace that source's records. Network off → toast "Enable GeoINT network to refresh from
   CelesTrak"; nothing fetched.
3. **Propagation tick** (`setInterval`, default 2 s, only while the layer is visible and the GeoINT
   tab is focused): `propagateAt(new Date())` over all records → `PropagatedSat[]` → update the
   GeoJSON source so icons move.
4. Map: circle/symbol layer, color data-driven by `type`; click a feature → detail popup (name,
   NORAD, altitude, velocity, inclination) with Center + Track buttons; Center = `flyTo`, Track =
   follow until cleared.
5. Table: the current propagated set, sortable by any column; type filters drive both table and map;
   status shows "Satellites visible: N / M" and the last CelesTrak update time; Export writes the
   current (filtered) set to JSON or CSV via the existing save dialog.

## Rendering & performance

- Single GeoJSON source + circle layer (symbol variant with a satellite glyph optional), color by
  `type` via a data-driven expression. MapLibre culls offscreen features on the GPU; no manual
  viewport clustering.
- SGP4 over ~10k records ≈ tens of ms; acceptable on the main thread at the 2 s cadence. If profiling
  shows jank, move propagation into a Web Worker (noted as a v1.1 optimization, not v1).
- The table renders only the filtered/visible subset (cap + "N / M" status) — never 10k DOM rows.

## Type classification

- Fetched via a specific CelesTrak group → `type` = that group.
- For the `active` mega-list → derive via name/NORAD heuristics: `STARLINK*`→starlink,
  `NAVSTAR`/`GPS`→gps, `NOAA`/`GOES`/`METEOR`→weather, `ISS`/`CSS`/`TIANGONG`→station,
  comms/earth-obs keyword sets, else `other`.
- GeoINT legend extended with a color per type + per-type visibility filters.

## Error handling

- Malformed TLE / OMM (manual entry or import): inline validation error in the manager; the record is
  rejected, never stored. `tle.ts` never throws on bad input — it returns a typed parse result.
- CelesTrak fetch failure (timeout/non-200/garbage): toast the error, keep the snapshot/last data.
- Network off + Refresh attempted: toast guidance, no silent failure (charter honesty).
- Vault locked on `upsert`: surfaces `EVAULTLOCKED` exactly like `streams.upsert`.
- Missing/empty snapshot: the layer still works with user satellites; status shows source + counts.

## Testing

Pure units (vitest, node env):

- `tle.ts`: parse CelesTrak OMM JSON; parse 2-line and 3-line TLE text; malformed/partial input →
  typed rejection (no throw); JSON↔TLE round-trip stability.
- `propagate.ts`: ISS (known TLE) at a fixed epoch → lat/lon/alt/velocity/inclination within tolerance
  of a published reference vector; determinism — identical `(records, date)` → identical output.
- `classify.ts`: representative name/NORAD → `SatelliteType` mapping table.
- `satelliteLayer.ts`: FeatureCollection builder — correct properties, `[lng, lat]` order, filter
  application produces the expected feature subset.
- `src/main/services/satellites.ts`: secure-fs round-trip through a mocked fs; `fetchGroup` returns
  empty/error when `networkEnabled` is false (gate test); snapshot loader parse.

Renderer panels + map wiring: `pnpm typecheck` + `electron-vite build` + manual smoke.

## Decomposition (for the plan)

1. Data layer — `types.ts`, `tle.ts`, `classify.ts`, `propagate.ts` (+ satellite.js vendored/pinned) + tests.
2. Main — `satellites.ts` (persistence + gated fetch + snapshot), IPC, preload, `api.d.ts`, build snapshot script + extraResources + tests.
3. Map — `satelliteLayer.ts` GeoJSON layer + builder tests, propagation tick + click wiring in `MapGL.tsx`.
4. Panel — `SpaceSatellitesPanel.tsx` (toggle, table, status, filters, export, Track/Center/Details).
5. Manager — `SatelliteManager.tsx` (add + TLE/file import), persistence wiring.
6. Integration — `GeoIntModule.tsx` wiring, legend, end-to-end smoke; README/Status copy.
