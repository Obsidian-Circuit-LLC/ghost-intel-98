# GeoINT CCTV pins — design spec

**Date:** 2026-06-19
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Module:** GeoINT (`src/renderer/modules/geoint/`) + a new window module (`src/renderer/modules/cameraview/`)

## Goal

Add a toggleable layer to the GeoINT map that drops a clickable camera-icon pin at every catalogued
CCTV with coordinates. Clicking a pin opens a small draggable Win98 window playing that feed. At ~2,500
cameras the layer clusters by location. Lives in GeoINT; does not undermine EyeSpy (which remains the
multi-camera wall/workspace).

## Background / what already exists

- EyeSpy's `streams.json` library (global, not per-case) holds `CameraStream` records; coordinate-bearing
  imports now land `lat`/`lon` (the v3.14.4 importer fix; insecam/TfL scrapes import ~2,555 cameras,
  ~2,469 with coordinates).
- `CameraStream` (`src/shared/post-mvp-types.ts:111–131`) carries optional
  `country?/region?/city?/lat?/lon?/source?`.
- The GeoINT map is **MapLibre GL** (not Leaflet). Markers are **one DOM element per marker**, built by
  `rebuildItemMarkers(map, store, items, corroboration?, onPopup?)` (`MapGL.tsx:186`), styled by
  `buildIconElement` (`MapGL.tsx:61`), gated by `validCoord(lat,lon)` (`MapGL.tsx:48`), capped at
  `MAX_MARKERS = 1500` (`MapGL.tsx:36`). One-popup-at-a-time tracking via `trackPopup` (`MapGL.tsx:260`).
- `corroborate.ts:25` already does spatial-grid bucketing (cell ≈ `radiusKm`, 3×3 neighborhood) — the
  grid math we reuse for clustering.
- The EyeSpy `Viewer` (`Viewer.tsx`) is a stateless `({ stream, poster?, refreshNonce? })` component that
  plays every `StreamKind` (hls/mjpeg/rtsp/http/mp4/youtube/webpage) with its own cleanup; RTSP shows an
  ffmpeg-bridge note rather than playing.
- Renderer reads streams via `window.api.streams.list()` (`preload/index.ts:253`); windows open via
  `useWindows.getState().open(spec)` (`state/store.ts:75`); Win98 dialogs via `useDialogs`
  (`state/dialogs.ts`).
- Network gate `settings.geoint.networkEnabled` (default off) gates tiles + threat layers
  (`GeoIntModule.tsx:87`). CSP (`renderer/index.html`) already permits http(s) in media-src/img-src.

## Decisions (locked during brainstorming, 2026-06-19)

1. **Density:** clustered with count badges (reuse the `corroborate.ts` spatial grid; recompute per
   zoom). Not raw individual pins, not zoom-gated-only.
2. **Quick-view form:** draggable Win98 window(s) hosting the EyeSpy `Viewer` — multiple can open.
3. **Network posture:** pins always render (local data, no egress); playback is ungated, identical to
   EyeSpy today. The camera layer is NOT disabled when the GeoINT gate is off.
4. **Clustering implementation: Approach A** — JS grid clustering feeding a dedicated camera DOM-marker
   layer (keeps Win98 icon styling + existing marker/popup machinery; no new dependency). Rejected:
   B (MapLibre native GeoJSON clustering — breaks the Win98 DOM-icon look, forks the render/popup model)
   and C (`supercluster` dependency — unneeded at single-user scale; charter leans against new deps).
5. **Camera set:** all geolocated streams in the global EyeSpy library, filtered to `validCoord`.
6. **Pin look:** camera-glyph icon in a new `camera` category color; cluster badge in Win98 raised
   (`outset`) styling.

## Architecture

The camera layer is kept **separate** from the event-marker pipeline so its clustering does not entangle
with the `MAX_MARKERS=1500` event cap or the event popup flow.

### New files

- **`src/renderer/modules/geoint/cctvCluster.ts`** — *pure, no DOM, headlessly testable.*
  - `cellDegForZoom(zoom: number): number` — grid cell size in degrees; coarse at low zoom, fine at high
    zoom; monotonically non-increasing as zoom rises. Tuned so a viewport holds at most a few hundred
    markers.
  - `clusterCameras(streams: CameraStream[], zoom: number, bounds: LngLatBoundsLike): Cell[]` where
    `interface Cell { key: string; lat: number; lon: number; count: number; streamIds: string[];
    singleton?: CameraStream }`. Buckets streams that pass `validCoord` **and** fall within `bounds`
    (plus a small margin) into grid cells; a 1-camera cell emits a `singleton`; an N>1 cell emits a
    cluster (count + streamIds, lat/lon = cell centroid). Output is **stably sorted by `key`** for
    deterministic rendering.
- **`src/renderer/modules/geoint/cctvLayer.ts`** — *DOM/marker controller (thin).*
  - `renderCctvLayer(map, cells, handlers): void` (or a small class) that diff-updates its own
    `Map<string, maplibregl.Marker>` against `cells` (add new, move/update changed, remove gone).
  - `buildCameraIcon(): HTMLElement` — inline-SVG camera glyph on a `camera`-colored marker.
  - `buildClusterIcon(count: number): HTMLElement` — Win98 `outset`-bordered gray badge showing the
    count; size scales gently with magnitude.
  - `handlers = { onOpen(streamId), onClusterClick(cell) }`.
- **`src/renderer/modules/cameraview/CameraViewModule.tsx`** — the quick-view window body: a one-line
  header (label · city/region/country) + `<Viewer stream={stream} />`. Receives `{ stream: CameraStream }`
  via window props.
- **`src/renderer/modules/cameraview/cameraWindow.ts`** — pure
  `cameraWindowAction(openIds: string[], streamId: string, cap: number): 'focus' | 'open' | 'deny'`
  and `const MAX_CAMERA_WINDOWS = 8`. (Pulled out so the open/focus/deny policy is unit-testable.)

### Modified files

- **`MapGL.tsx`** — accept props `cctvStreams: CameraStream[]` and `showCctv: boolean` plus
  `onCameraOpen(streamId: string): void`. When `showCctv`, attach `moveend`/`zoomend` listeners that call
  `clusterCameras(cctvStreams, map.getZoom(), map.getBounds())` then `renderCctvLayer`. Cluster click →
  `map.flyTo` one zoom step toward the cell centroid (clusters split as zoom rises). Singleton click →
  `onCameraOpen(streamId)`. On `showCctv=false` or unmount, tear down the camera markers + listeners. The
  camera layer is independent of `rebuildItemMarkers`; it does not consume the event marker budget.
- **`GeoIntModule.tsx`** —
  - On mount and on **Refresh**, `const cams = (await window.api.streams.list()).filter(s => valid coords)`
    cached in state; expose count `N`.
  - `showCctv` state (default `false`) + a **"CCTV cameras (N)"** checkbox in the layer controls. Unlike
    threat-layer checkboxes it is **not** `disabled` when `networkEnabled` is off.
  - `onCameraOpen(streamId)`: resolve the stream from the cache; compute
    `cameraWindowAction(currentCameraWindowIds, streamId, MAX_CAMERA_WINDOWS)`:
    - `focus` → raise the existing window `camera-view:<streamId>`.
    - `open` → `useWindows.getState().open({ module: 'camera-view', id: 'camera-view:'+streamId,
      title: stream.label, props: { stream }, width: 480, height: 360 })`.
    - `deny` → `useDialogs.push` a notice: "Close a camera window first (max 8 open)."
  - Pass `cctvStreams`, `showCctv`, `onCameraOpen` to `MapGL`.
- **5-point module registration for `camera-view`** (window-only; no desktop icon/shortcut):
  - `state/store.ts` — add `'camera-view'` to the `ModuleKey` union.
  - `ModuleHost.tsx` — switch case rendering `<CameraViewModule {...props} />`.
  - `Icon.tsx` — a glyph for the window titlebar.
  - (No `Desktop.tsx` title entry and no keyboard shortcut — it is never launched from the desktop, only
    by a pin click.)

## Data flow

`streams.list()` → filter `validCoord` → cache in `GeoIntModule` → (when `showCctv`) `MapGL` clusters the
cached array against current zoom + viewport → `cctvLayer` renders cluster badges + singleton camera pins
→ singleton click → `onCameraOpen` → `cameraWindowAction` → focus/open/deny a `camera-view` window →
`<Viewer>` plays. Cluster click → `flyTo` one zoom step. No per-frame IPC; streams fetched once on mount,
re-fetched only on Refresh.

## Pin & cluster styling (Win98 hard constraint)

- New `camera` category color, distinct from existing categories (proposed teal `#16a085`; not
  conflict-red / cyber-purple).
- **Singleton:** inline-SVG camera glyph on a `camera`-colored marker — reads unambiguously as "camera."
- **Cluster:** Win98 raised-border (`outset`) gray box with the count; gentle size-by-magnitude. No
  flat-modern styling — matches desktop chrome.

## Network / charter posture

- Pins render from local data only; drawing them performs no egress, so the layer is independent of
  `networkEnabled`.
- Playback is the same explicit, user-directed egress EyeSpy already performs — ungated (decision 3). No
  new network path is introduced.
- No telemetry, no new runtime dependency. CSP unchanged: HLS via `<video>` (media-src), MJPEG/HTTP via
  `<img>` (img-src) — both already allowed; **no frame-src broadening** (honors the CSP plugin
  invariant), since youtube/webpage kinds keep the Viewer's existing isolated handling.

## Error handling & edge cases

- Streams with missing/non-finite coords are filtered before clustering.
- Empty library → checkbox shows `(0)`; nothing renders.
- `streams.list()` IPC failure → Win98 dialog; `showCctv` reverts to off.
- Camera deleted elsewhere then a stale pin clicked → the Viewer shows its normal load error; harmless
  (window is ephemeral; props carry a snapshot of the stream).
- RTSP pin → drops normally; the window shows the Viewer's existing ffmpeg-bridge note.
- Concurrency cap reached → `deny` dialog.

## Testing

- `test/cctv-cluster.test.ts` (pure, node): `cellDegForZoom` monotonic; co-located cameras collapse to a
  single cluster with correct `count`/`streamIds`; an isolated camera emits a `singleton`; out-of-bounds
  streams filtered; deterministic (stable) ordering of `Cell[]`.
- `test/camera-window.test.ts` (pure): `cameraWindowAction` returns `focus` for a duplicate id, `open`
  below the cap, `deny` at the cap.
- A stream→marker mapping helper (category/glyph params) unit-tested if non-trivial.
- `pnpm typecheck` + full `pnpm test` green before ship.

## Scope guard (YAGNI — explicitly out)

No heatmaps, no per-case camera filtering, no live-thumbnail pins, no tile-gated camera layer, no
camera-specific search. Those remain in the shelved GeoINT-reimagine doc
(`docs/superpowers/ideas/2026-06-18-geoint-cctv-pins-and-shelf.md`). This spec ships exactly: toggle →
clustered camera pins → click → draggable window → play.

## Verification (acceptance)

- Toggling "CCTV cameras (N)" on shows clustered badges over dense areas (London collapses to a count
  badge); zooming in splits clusters toward individual camera pins.
- Clicking a camera pin opens a draggable Win98 window that plays the feed; re-clicking focuses it;
  opening a 9th is denied with a dialog.
- The layer renders with the GeoINT network gate off; playback works regardless of the gate.
- Win98 aesthetic intact (no flat-modern restyle).
- New unit suites + typecheck green; manual Windows smoke by GhostExodus against his imported scrape.
