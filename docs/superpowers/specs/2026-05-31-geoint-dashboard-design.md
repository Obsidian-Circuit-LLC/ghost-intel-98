# Ghost Access 98 — GeoINT dashboard (cycle 1 of 2) design

**Date:** 2026-05-31
**Module key:** `geoint` · **Display name:** "GeoINT"
**Status:** design approved (operator: GhostExodus), pending implementation plan.

## Decomposition (operator-approved)

GeoINT is built in **two spec→plan→build cycles**:

1. **GeoINT dashboard (THIS spec)** — the standalone monitoring tool: pluggable
   sources, fetch/parse, egress gating, Leaflet map, offline geocoding, reading/map UI.
2. **GeoINT ↔ case integration (next cycle)** — save event → case, spawn/link entities
   in the cross-case registry, emit timeline events. Depends on cycle 1; touches the
   already-shipped entities/timeline systems. **Out of scope here.**

## Purpose

A pluggable geopolitical-monitoring dashboard. The operator curates her own sources
(no baked-in providers — source sovereignty is the central requirement) and watches
events as a reading list and as pins on a map. Offline-first: all network is off by
default and gated behind explicit opt-in.

## Locked decisions

1. **Map:** real pan/zoom **Leaflet** map with **online raster tiles** from a
   **user-configured tile server**. Tiles load only when the master egress toggle is on
   AND a tile-server URL is set; otherwise the map area shows a "map disabled" placeholder.
2. **Feeds:** **RSS, Atom, GeoJSON**, plus **OPML import** for bulk source lists.
3. **Geocoding:** explicit coords (GeoRSS / GeoJSON geometry) when present; otherwise
   match place names against a **bundled offline gazetteer** (countries + major cities);
   **manual pin** as fallback. No geocoding-service egress.
4. **Egress:** one master `settings.geoint.networkEnabled` (default **false**) gates ALL
   GeoINT network (feed fetches + map tiles). Each source toggles independently within
   that. **App-layer enforced** (feeds fetched in main only when gated open; tiles load
   in the renderer via Leaflet `<img>` under the already-permissive img-src CSP — same
   honest model as EyeSpy/Jukebox, not CSP-enforced).
5. **Map library:** Leaflet (lightweight raster) over a vector/WebGL stack.

## Hard invariants (inherited)

- `contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`. Renderer never
  fetches feeds — all feed network goes through main-process IPC. Tiles are the only
  renderer-side remote load (Leaflet image tiles), gated app-layer.
- Capability via typed IPC: `ipc-contracts.ts` → `register.ts` (`safeHandle` + validators)
  → preload → `api.d.ts`. Vault-gated (NOT `GATE_EXEMPT`).
- Offline-first, no telemetry, **no egress unless `geoint.networkEnabled` is on**. Persisted
  state under `dataRoot` via secure-fs (vault-encrypted at rest).
- No native modules. Retro 98.css UI. Additive, ENOENT-safe storage.

## Architecture

### Module registration (4 points)
`ModuleKey` union (`store.ts`), `ModuleHost` switch, `GLYPHS` (`Icon.tsx`),
`moduleTitles` (`Desktop.tsx`).

### Shared types (`post-mvp-types.ts`)
```
type GeoSourceType = 'rss' | 'atom' | 'geojson';
interface GeoSource { id; label; url; type: GeoSourceType; enabled: boolean;
                      lastFetched?: string; lastError?: string }
interface GeoItem { id; sourceId; title; link?; summary?; published?;
                    lat?: number; lon?: number;
                    located: 'geo' | 'gazetteer' | 'manual' | 'none' }
interface GeoSnapshot { sources: GeoSource[]; items: GeoItem[] }
```
`AppSettings.geoint`: `{ networkEnabled: boolean; tileServerUrl: string;
tileAttribution: string }` — defaults `{ networkEnabled: false, tileServerUrl: '',
tileAttribution: '' }` (added to `defaultSettings` + `mergeSettings` deep-merge).

### Source store (`src/main/geoint/sources.ts`)
`geoint-sources.json` under `dataRoot` via `secureReadText`/`secureWriteFile`
(mirrors `streams.ts`). CRUD: `list/add/update/remove`; `importOpml(text)` bulk-adds.
Fetched items cached at `geoint-cache/<sourceId>.json` so the dashboard renders offline
after a refresh.

### Feed engine (`src/main/geoint/feeds.ts`)
- `fetchSource(source)` — **only callable when `geoint.networkEnabled`** (the handler
  checks; the function also guards). Fetches the URL in main, detects/honors `type`,
  parses, geocodes, caches, returns `GeoItem[]`. On failure sets `source.lastError`,
  never throws past the handler.
- Parsing: `fast-xml-parser` (pure-JS — **verify in Stage 0**) for RSS/Atom + OPML;
  `JSON.parse` for GeoJSON `FeatureCollection` → items from features (geometry →
  lat/lon, properties → title/date).
- RSS/Atom field mapping incl. GeoRSS (`geo:lat`/`geo:long`, `georss:point`).

### Geocoding (`src/main/geoint/geocode.ts` + `resources/geoint/gazetteer.json`)
`geocode(text): {lat,lon} | null` — longest-place-name match against the bundled
gazetteer (countries + ~major cities). Deterministic (no RNG/time). Items with explicit
coords skip it (`located:'geo'`); matches → `'gazetteer'`; none → `'none'` (list-only
until a manual pin sets `'manual'`).

### IPC (`geoint.*`, validated, vault-gated)
- `listSnapshot()` → `GeoSnapshot` (sources + cached items).
- `addSource()` (URL+label+type via a small form payload; `ensureGeoSource`) /
  `updateSource(id, patch)` / `removeSource(id)`.
- `importOpml()` — open-file dialog, parse, bulk-add; returns count.
- `refresh(sourceId?)` — fetch one or all **enabled** sources; **returns early/no-op if
  `geoint.networkEnabled` is false** (the egress gate; unit-tested).
- `setItemLocation(itemId, {lat,lon} | null)` — manual pin / clear.
Validators: `ensureGeoSource` (label bounds, `validateExternalUrl` http/https only,
type enum), `ensureLatLon` (finite, in range).

### Renderer (`src/renderer/modules/geoint/`)
- `GeoIntModule.tsx` — split view: left = sources panel (add/import/toggle/refresh) +
  reading list (filter, click → focus pin); right = `MapPane`.
- `MapPane.tsx` — Leaflet map; tiles from `settings.geoint.tileServerUrl` only when
  `networkEnabled`; markers from located items; click marker → item popup; "drop pin"
  mode for manual location. Placeholder when tiles disabled.
- Network/tile config: a small controls strip (master "Allow GeoINT network" toggle +
  tile-server URL field), persisted via the settings store (live-sync already fixed).
- Leaflet is a renderer dep (Vite-bundled) + `@types/leaflet`.

## Egress model (the security-relevant claim)
- **Off by default.** `geoint.networkEnabled=false` ⇒ `refresh` is a no-op, no source is
  fetched, the map loads no tiles. The reading list shows only previously-cached items.
- **On:** only sources with `enabled:true` are fetched; tiles load only if a tile URL is set.
- Enforcement is **application-layer** (main refuses to fetch; renderer refuses to mount a
  tile layer), consistent with EyeSpy/Jukebox — not CSP, since the app's CSP already
  permits remote `img-src`/`connect-src` for existing features. Asserted by unit tests on
  the refresh path, not by CSP.

## Error handling
- Fetch failure (offline, 4xx/5xx, bad body) → `source.lastError` set + a toast; other
  sources still refresh; never a crash.
- Parse failure → that source yields no items + a recorded error; cache untouched.
- Tiles unreachable → Leaflet shows broken tiles; a one-line "check tile server" hint.
- Gazetteer miss → item stays list-only (not an error).

## Testing
**Vitest (main, headless):** RSS + Atom parse (incl. GeoRSS coords), GeoJSON parse,
OPML parse → sources, gazetteer match (hit/miss/longest-name/ambiguity-is-deterministic),
source CRUD round-trip, and the **egress gate** (`refresh` performs no fetch when
`networkEnabled` is false — the load-bearing security assertion).
**xvfb smoke:** module opens, map placeholder renders with tiles disabled, a GeoJSON
fixture source parses + plots a pin, no console/main errors.

## Out of scope (cycle 1)
- Case/entity/timeline integration (cycle 2).
- Auto-refresh scheduling/polling (manual Refresh in v1; revisit later).
- External geocoding services; vector/WebGL maps; offline bundled tiles.
- Auth into feeds (API keys/headers) — public feeds only in v1.

## Open items for implementation
- Verify `fast-xml-parser` + `leaflet`/`@types/leaflet` vendor pure-JS, no native, and
  bundle (main external for the parser; Leaflet via Vite for the renderer).
- Decide the gazetteer's size/source (a small, license-clean countries+cities table with
  coordinates — sourced verbatim, not fabricated; record provenance in the plan).
- Confirm Leaflet's CSS/marker assets bundle correctly under electron-vite.
