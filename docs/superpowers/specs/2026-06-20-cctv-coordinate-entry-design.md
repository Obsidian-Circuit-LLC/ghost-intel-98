# Manual CCTV Coordinate Entry + Master Export — Design

**Date:** 2026-06-20
**Surface:** Ghost Intel 98 core app (`/dcs98`) — EyeSpy (renderer) + streams service/IPC (main)
**Status:** Approved for planning

## Goal

Let the operator manually set a camera feed's geographic coordinates (latitude + longitude) so it
appears as a GeoINT map pin, and export the camera library back out to a portable master CCTV JSON
file in the same shape the importer consumes.

## Context (grounding facts)

- **There is no live "CCTV JSON file" to write back to.** `Master_CCTV.json` is a *one-time import
  source* that is not retained. `src/main/services/feed-import.ts` (`parseNestedTree` +
  `extractGeo`) parses `coordinates:{latitude,longitude}` into `CameraStream.lat/lon`, and the
  streams are persisted to the in-vault corpus `<dataRoot>/streams.json` via
  `src/main/services/streams.ts` `upsert()`.
- **`CameraStream`** (`src/shared/post-mvp-types.ts:111`) already carries optional
  `lat?: number; lon?: number` (+ `country?/region?/city?/source?`). `upsert()` already round-trips
  these via `pickGeo()`.
- **GeoINT only pins cameras with valid coords.** `validCoord(lat, lon)` (`MapGL.tsx:49`) requires
  both finite, lat ∈ [−90,90], lon ∈ [−180,180]; `GeoIntModule.tsx` filters with it and
  `cctvCluster.ts` skips non-finite. Cameras without coords are silently dropped from the map.
- **An edit surface already exists.** EyeSpy's right-click `setloc` action opens `SetLocationDialog`
  (`src/renderer/modules/eyespy/SetLocationDialog.tsx`), which edits country/region/city and calls
  `window.api.streams.upsert({ ...t, country, region, city })` via `applyLoc`
  (`EyeSpyModule.tsx:234`). It supports multiple targets (bulk location stamping).
- **Master shape (verified from the reference file):** a 4-level nested tree
  `{ "<Country>": { "<Region>": { "<City>": [ { "stream_url": string, "coordinates"?: { "latitude": number, "longitude": number } } ] } } }`.
  `coordinates` is omitted when unknown.
- **Existing file-export pattern:** `channels.media.savePlaylist` (`register.ts` ~1028) — renderer
  triggers, main runs `dialog.showSaveDialog`, refuses symlink targets, writes the file, returns the
  basename.
- **Trust boundary gap:** the `streams:upsert` IPC handler validates only the URL; `pickGeo` keeps
  any *finite* number, so a renderer could persist `lat: 500`. The renderer is untrusted (charter),
  so the main side must range-gate coordinates.

## Architecture

### Part A — Coordinate entry (extend `SetLocationDialog`)

Add **Latitude** and **Longitude** inputs below City in the existing dialog.

- **Single-target only for coordinates.** The lat/lon inputs render only when `targets.length === 1`
  (a shared coordinate across many cameras is meaningless). For multi-select the dialog behaves
  exactly as today (country/region/city only). Inputs seed from `targets[0].lat/lon` (blank if
  absent).
- **Validation (renderer):** both-or-neither. Each value, when present, must parse to a finite
  number in range (lat ∈ [−90,90], lon ∈ [−180,180]). A pure helper
  `parseCoordPair(latStr, lonStr): { ok: true; lat?: number; lon?: number } | { ok: false; error: string }`
  encodes the rule: both blank → `ok` with no coords (clears); exactly one blank → `ok:false`
  ("enter both latitude and longitude, or leave both blank"); out-of-range / non-numeric →
  `ok:false`. Apply is blocked with a toast on `ok:false`.
- **Apply:** `onApply` is extended to carry optional `lat`/`lon`. `applyLoc` passes them into the
  existing `upsert` call (omitting both clears the coordinates, which `pickGeo` honors by dropping
  them). Persisted to `streams.json`; the camera pins on the next GeoINT refresh.
- The dialog legend/affordance reflects that coordinates are editable for a single feed.

### Part B — Main-side hardening (`streams.ts` `pickGeo`)

Range-gate and pair coordinates: keep `lat`/`lon` only if **both** are finite numbers in range
(lat ∈ [−90,90], lon ∈ [−180,180]); otherwise drop **both**. This mirrors `validCoord` /
`ensureLatLon` and closes the out-of-range persistence gap. Renderer validation becomes
defense-in-depth. (Existing imports supply lat/lon as a pair or not at all, so this does not regress
the import path; a degenerate lat-only feed — which could never pin — is now cleanly dropped.)

### Part C — Export to master CCTV JSON

- **Pure builder** `src/main/services/cctv-export.ts` →
  `streamsToMasterTree(streams: CameraStream[]): MasterTree` groups by
  `country → region → city → [{ stream_url, coordinates? }]`:
  - `stream_url` = `CameraStream.url`; `coordinates` = `{ latitude: lat, longitude: lon }` only when
    both are present (post-`pickGeo` they are paired + in range); omitted otherwise.
  - Missing `country`/`region`/`city` bucket under the literal `"Unknown"` at that level, so every
    camera is representable and the tree stays 4 levels deep (round-trips through `parseNestedTree`,
    which stamps the path back into country/region/city).
  - Deterministic: keys emitted in sorted order; cameras within a city array in stable input order.
- **IPC** `streams:exportCctv` (mirror `media.savePlaylist`): read all streams via the streams
  store, build the tree, `dialog.showSaveDialog({ defaultPath: 'master_CCTV.json' })`, refuse a
  symlink target, `writeFile` pretty JSON (2-space), return the basename (or `null` on cancel).
  Add the channel to `ipc-contracts.ts` (`streams.exportCctv`), the preload bridge, and `api.d.ts`.
- **UI:** an **"Export CCTV…"** button in the EyeSpy Finder toolbar next to "Import…", calling
  `window.api.streams.exportCctv()` and toasting the saved filename (or nothing on cancel).

## Data flow

Right-click camera → "Set location…" → dialog (1 target shows lat/lon) → Apply → `parseCoordPair`
→ `window.api.streams.upsert({ ...t, lat, lon })` → `pickGeo` (range-gated) → `streams.json` →
GeoINT pin.
Separately: Finder "Export CCTV…" → `streams:exportCctv` → `streamsToMasterTree` → save dialog →
`master_CCTV.json` (re-importable via the existing importer).

## Error handling

- Renderer blocks invalid/half coordinates before Apply (toast with the specific reason).
- Main `pickGeo` drops out-of-range or unpaired coords as defense-in-depth (silent, consistent with
  its existing behavior of dropping invalid geo).
- Export: returns `null` on cancel; throws (caught → toast) on symlink target or write failure.

## Testing (pure-function, vitest node env — no React render harness)

- `parseCoordPair`: both blank → ok/no-coords; one blank → error; out-of-range lat/lon → error;
  valid pair → ok with numbers; non-numeric → error; whitespace trimmed.
- `pickGeo` (via `streams.ts` export or a thin test seam): keeps an in-range pair; drops a pair when
  either is out of range; drops a lone lat or lone lon; preserves country/region/city independently.
- `streamsToMasterTree`: groups by country/region/city; omits `coordinates` when absent; emits them
  when present; buckets missing levels under `"Unknown"`; deterministic key ordering; **round-trip**
  — feed the built tree through `feed-import.ts` `parseNestedTree` and assert the coordinates and
  path stamps come back equal.

## Charter / invariants

- No new egress host, no network probing of coordinates (operator-entered only), no telemetry.
- Main remains the trust boundary: coordinate range-gating happens main-side; the export refuses
  symlink targets (mirrors the playlist/backup export guards).
- `Master_CCTV.json` stays **reference-only** — not committed; tests use small inline fixtures.
- Core change → lands on `feat/cctv-coordinate-entry` for operator merge. No push, no release.

## Out of scope

- Geocoding / reverse-geocoding (city ↔ coordinates). Coordinates are entered by hand.
- A standalone "add a brand-new camera from scratch in GeoINT" form (EyeSpy add-feed already exists;
  this feature only adds coordinates to existing feeds + export).
