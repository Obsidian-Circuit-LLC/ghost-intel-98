# GeoINT CCTV Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable, clustered CCTV camera layer to the GeoINT MapLibre map; clicking a camera pin opens a small draggable Win98 window that plays the feed.

**Architecture:** A separate camera marker layer on the existing MapLibre map (not entangled with the event-marker pipeline or its `MAX_MARKERS` cap). Pure JS grid clustering (reusing `corroborate.ts`'s spatial-grid idea) feeds a thin DOM-marker controller; pin clicks open a new window-only `camera-view` module that wraps the existing EyeSpy `Viewer`.

**Tech Stack:** TypeScript, React, Zustand, MapLibre GL, Vitest. No new runtime dependency.

## Global Constraints

- **No new runtime dependency** (charter; clustering reuses the existing spatial-grid approach).
- **No telemetry, no new network egress path.** Camera pins are drawn from local data only; playback is the same user-directed egress EyeSpy already performs.
- **No CSP change.** HLS plays via `<video>` (media-src), MJPEG/HTTP via `<img>` (img-src) — both already permitted; **no frame-src broadening** (youtube/webpage kinds keep the Viewer's existing isolated handling).
- **Win98 aesthetic preserved** — no flat-modern restyle; cluster badges use raised (`outset`) borders.
- **Determinism:** clustering output is stably sorted; no `Date.now()`/RNG in the cluster path.
- **Pure modules stay maplibre-free** so they run in the `node` vitest env. Only `.tsx`/DOM modules import `maplibre-gl` and are tested under `// @vitest-environment jsdom`.
- **Live map is `MapGL`** (`src/renderer/modules/geoint/GeoIntModule.tsx:76` — the Leaflet `MapPane` fallback was removed). All map work targets `MapGL.tsx`.
- Camera category color is a **local constant `CAMERA_COLOR = '#00a8e8'`** (azure) in `cctvLayer.ts` — NOT added to `MapGL`'s `CATEGORY_COLOR` (whose `disaster` is already `#16a085`; cameras render a glyph chip, not a category dot). This refines the spec's placeholder `#16a085`.

## Reference signatures (already in the codebase)

- `validCoord(lat, lon): lat is number` and `buildIconElement`, `rebuildItemMarkers`, `createGlobeMap`, `buildStyle` — exported from `src/renderer/modules/geoint/MapGL.tsx`.
- `corroborate(items, opts)` spatial grid — `src/renderer/modules/geoint/corroborate.ts:25` (cell = `R/111`; `cellKey = floor(lat/cellDeg),floor(lon/cellDeg)`). Mirror this idea; do not import it.
- `CameraStream` (`src/shared/post-mvp-types.ts:111`): `{ id, label, url, kind, caseId, addedAt, notes, country?, region?, city?, lat?, lon?, source? }`; `StreamKind = 'hls'|'mjpeg'|'rtsp'|'http'|'mp4'|'webpage'|'youtube'`.
- `Viewer({ stream, poster?, refreshNonce? })` — `src/renderer/modules/eyespy/Viewer.tsx:12`.
- `window.api.streams.list(): Promise<CameraStream[]>` — preload bridge.
- `useWindows.getState().open(spec)` — `src/renderer/state/store.ts:75`; **dedups by `spec.id`** (re-focuses/un-minimizes an existing window with that id).
- `registerModule({ key, title, glyph, component, builtin, defaultWidth?, defaultHeight? })` — `src/renderer/state/registry.ts`; built-ins registered in `src/renderer/modules/register-builtins.tsx`. Desktop/Start-menu launchers use curated lists in `shell/Desktop.tsx` / `shell/AccessMenu.tsx`, NOT the registry — so a registry-only module does not appear as a launcher.
- `alertDialog(message, title?)` — `src/renderer/state/dialogs.ts:50`.
- Vitest: default env `node`; DOM tests start with `// @vitest-environment jsdom`. `maplibre-gl` mock pattern: `test/geoint-mapgl.test.ts`.

---

### Task 1: Pure clustering module (`cctvCluster.ts`)

**Files:**
- Create: `src/renderer/modules/geoint/cctvCluster.ts`
- Test: `test/cctv-cluster.test.ts`

**Interfaces:**
- Produces:
  - `interface Bounds { west: number; south: number; east: number; north: number }`
  - `interface Cell { key: string; lat: number; lon: number; count: number; streamIds: string[]; singleton?: CameraStream }`
  - `cellDegForZoom(zoom: number): number`
  - `clusterCameras(streams: CameraStream[], zoom: number, bounds: Bounds): Cell[]`
- Consumes: `CameraStream` from `@shared/post-mvp-types`. Imports nothing from `MapGL` (must stay maplibre-free for the node env).

- [ ] **Step 1: Write the failing test**

Create `test/cctv-cluster.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cellDegForZoom, clusterCameras, type Bounds } from '../src/renderer/modules/geoint/cctvCluster';
import type { CameraStream } from '../src/shared/post-mvp-types';

const WORLD: Bounds = { west: -180, south: -85, east: 180, north: 85 };

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

describe('cellDegForZoom', () => {
  it('is positive and monotonically non-increasing as zoom rises', () => {
    expect(cellDegForZoom(2)).toBeGreaterThan(cellDegForZoom(5));
    expect(cellDegForZoom(5)).toBeGreaterThan(cellDegForZoom(10));
    expect(cellDegForZoom(15)).toBeGreaterThan(0);
  });
  it('clamps to a sane range', () => {
    expect(cellDegForZoom(0)).toBeLessThanOrEqual(90);
    expect(cellDegForZoom(22)).toBeGreaterThanOrEqual(0.0008);
  });
});

describe('clusterCameras', () => {
  it('collapses co-located cameras into one cluster (count, sorted ids, no singleton)', () => {
    const cells = clusterCameras([
      cam({ id: 'b', lat: 51.5074, lon: -0.1278 }),
      cam({ id: 'a', lat: 51.5076, lon: -0.1279 })
    ], 3, WORLD);
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(2);
    expect(cells[0].streamIds).toEqual(['a', 'b']);
    expect(cells[0].singleton).toBeUndefined();
  });

  it('emits a singleton for an isolated camera, carrying the stream', () => {
    const s = cam({ id: 'solo', lat: -33.8688, lon: 151.2093 });
    const cells = clusterCameras([s], 3, WORLD);
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(1);
    expect(cells[0].singleton).toEqual(s);
  });

  it('filters cameras outside the viewport bounds', () => {
    const inView = cam({ id: 'in', lat: 51.5, lon: -0.1 });
    const off = cam({ id: 'off', lat: 51.5, lon: 179 });
    const cells = clusterCameras([inView, off], 8, { west: -1, south: 51, east: 0, north: 52 });
    const ids = cells.flatMap((c) => c.streamIds);
    expect(ids).toContain('in');
    expect(ids).not.toContain('off');
  });

  it('separates distinct nearby cameras into singletons at high zoom', () => {
    const cells = clusterCameras([
      cam({ id: 'p', lat: 51.5000, lon: -0.1000 }),
      cam({ id: 'q', lat: 51.5200, lon: -0.1400 })
    ], 14, WORLD);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.count === 1)).toBe(true);
  });

  it('skips non-finite coords and returns cells stably sorted by key', () => {
    const cells = clusterCameras([
      cam({ id: 'nan', lat: NaN, lon: 0 }),
      cam({ id: 'z', lat: 10, lon: 100 }),
      cam({ id: 'a', lat: -10, lon: -100 })
    ], 4, WORLD);
    expect(cells.flatMap((c) => c.streamIds)).not.toContain('nan');
    const keys = cells.map((c) => c.key);
    expect([...keys].sort()).toEqual(keys); // already sorted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cctv-cluster.test.ts`
Expected: FAIL — `cellDegForZoom`/`clusterCameras` not exported (module missing).

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/modules/geoint/cctvCluster.ts`:

```typescript
/**
 * Pure spatial clustering for the GeoINT CCTV camera layer. No DOM, no maplibre — runs in the node
 * vitest env. Mirrors corroborate.ts's lat/lon grid idea: bucket cameras into square cells whose size
 * shrinks with zoom, so co-located cameras collapse into one count-badge cell and isolated cameras
 * surface as their own pin. Viewport-filtered so the rendered marker count stays small regardless of
 * the ~2,500 total. Deterministic: cells are stably sorted by key.
 */

import type { CameraStream } from '@shared/post-mvp-types';

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Cell {
  key: string;
  lat: number; // centroid of the cell's cameras
  lon: number;
  count: number;
  streamIds: string[];
  /** Present iff count === 1, carrying the single camera (so the click can open it directly). */
  singleton?: CameraStream;
}

/** Grid cell side in degrees for a given map zoom. Coarse when zoomed out, fine when zoomed in;
 *  monotonically non-increasing. Clamped so it never exceeds the globe or shrinks below ~90 m, which
 *  keeps genuinely co-located cameras clustered even at max zoom. */
export function cellDegForZoom(zoom: number): number {
  const raw = 180 / Math.pow(2, zoom);
  return Math.min(90, Math.max(0.0008, raw));
}

/** True when lon is within [west,east] (+margin), handling an antimeridian-crossing viewport where
 *  east < west. */
function lonInBounds(lon: number, b: Bounds, margin: number): boolean {
  if (b.east >= b.west) return lon >= b.west - margin && lon <= b.east + margin;
  return lon >= b.west - margin || lon <= b.east + margin; // crosses the antimeridian
}

export function clusterCameras(streams: CameraStream[], zoom: number, bounds: Bounds): Cell[] {
  const cell = cellDegForZoom(zoom);
  const margin = cell; // include just-offscreen cameras so a small pan doesn't pop pins in/out
  const grid = new Map<string, CameraStream[]>();
  for (const s of streams) {
    const lat = s.lat, lon = s.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if ((lat as number) > bounds.north + margin || (lat as number) < bounds.south - margin) continue;
    if (!lonInBounds(lon as number, bounds, margin)) continue;
    const key = `${Math.floor((lat as number) / cell)},${Math.floor((lon as number) / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(s); else grid.set(key, [s]);
  }
  const cells: Cell[] = [];
  for (const [key, members] of grid) {
    const n = members.length;
    const lat = members.reduce((a, s) => a + (s.lat as number), 0) / n;
    const lon = members.reduce((a, s) => a + (s.lon as number), 0) / n;
    const streamIds = members.map((s) => s.id).sort();
    cells.push({ key, lat, lon, count: n, streamIds, singleton: n === 1 ? members[0] : undefined });
  }
  cells.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return cells;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cctv-cluster.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/cctvCluster.ts test/cctv-cluster.test.ts
git commit -m "feat(geoint): pure CCTV spatial clustering (cctvCluster)"
```

---

### Task 2: Camera-window policy (`cameraWindow.ts`)

**Files:**
- Create: `src/renderer/modules/cameraview/cameraWindow.ts`
- Test: `test/camera-window.test.ts`

**Interfaces:**
- Produces:
  - `const MAX_CAMERA_WINDOWS = 8`
  - `cameraWindowId(streamId: string): string` → `'camera-view:' + streamId`
  - `type CameraWindowAction = 'focus' | 'open' | 'deny'`
  - `cameraWindowAction(openCameraIds: string[], streamId: string, cap?: number): CameraWindowAction`
- Consumes: nothing (pure, node env).

- [ ] **Step 1: Write the failing test**

Create `test/camera-window.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cameraWindowAction, cameraWindowId, MAX_CAMERA_WINDOWS } from '../src/renderer/modules/cameraview/cameraWindow';

describe('cameraWindowId', () => {
  it('namespaces the id by stream', () => {
    expect(cameraWindowId('abc')).toBe('camera-view:abc');
  });
});

describe('cameraWindowAction', () => {
  it('focuses when a window for this stream is already open', () => {
    expect(cameraWindowAction(['camera-view:abc'], 'abc')).toBe('focus');
  });
  it('opens when below the cap', () => {
    expect(cameraWindowAction(['camera-view:x'], 'abc', 8)).toBe('open');
  });
  it('denies a new stream when at the cap', () => {
    const open = Array.from({ length: MAX_CAMERA_WINDOWS }, (_, i) => `camera-view:s${i}`);
    expect(cameraWindowAction(open, 'new', MAX_CAMERA_WINDOWS)).toBe('deny');
  });
  it('still focuses an already-open stream even at the cap', () => {
    const open = Array.from({ length: MAX_CAMERA_WINDOWS }, (_, i) => `camera-view:s${i}`);
    expect(cameraWindowAction(open, 's0', MAX_CAMERA_WINDOWS)).toBe('focus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/camera-window.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/modules/cameraview/cameraWindow.ts`:

```typescript
/**
 * Policy for opening CCTV quick-view windows from GeoINT camera pins. Pure + dependency-free so the
 * open/focus/deny decision is unit-testable without the window store. A soft cap bounds how many live
 * players can run at once (each window is its own HLS/<video> instance), preventing the kind of
 * resource flood the early EyeSpy auto-grid hit.
 */

export const MAX_CAMERA_WINDOWS = 8;

export type CameraWindowAction = 'focus' | 'open' | 'deny';

/** Deterministic window id for a stream, so re-clicking the same pin re-focuses its window. */
export function cameraWindowId(streamId: string): string {
  return `camera-view:${streamId}`;
}

/**
 * Decide what to do when a camera pin is clicked, given the ids of currently-open camera windows.
 * - 'focus' if a window for this stream is already open (cap does not apply).
 * - 'deny' if opening a NEW stream would exceed the cap.
 * - 'open' otherwise.
 */
export function cameraWindowAction(
  openCameraIds: string[],
  streamId: string,
  cap: number = MAX_CAMERA_WINDOWS
): CameraWindowAction {
  if (openCameraIds.includes(cameraWindowId(streamId))) return 'focus';
  if (openCameraIds.length >= cap) return 'deny';
  return 'open';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/camera-window.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/cameraview/cameraWindow.ts test/camera-window.test.ts
git commit -m "feat(geoint): camera-window open/focus/deny policy + cap"
```

---

### Task 3: Camera marker layer (`cctvLayer.ts`)

**Files:**
- Create: `src/renderer/modules/geoint/cctvLayer.ts`
- Test: `test/cctv-layer.test.ts`

**Interfaces:**
- Consumes: `Cell`, `Bounds`, `clusterCameras` from `./cctvCluster`; `CameraStream`; `maplibre-gl`.
- Produces:
  - `const CAMERA_COLOR = '#00a8e8'`
  - `buildCameraIcon(): HTMLElement`
  - `buildClusterIcon(count: number): HTMLElement`
  - `interface CctvHandlers { onOpen(streamId: string): void; onCluster(cell: Cell): void }`
  - `renderCctvLayer(map, store, cells, handlers): void`
  - `syncCctvLayer(map, store, streams, showCctv, handlers): number` (returns rendered cell count; 0 when hidden)

- [ ] **Step 1: Write the failing test**

Create `test/cctv-layer.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

const markers: FakeMarker[] = [];
type FakeMarker = {
  lngLat: [number, number] | null; element: HTMLElement | null; added: boolean; removed: boolean;
  setLngLat(ll: [number, number]): FakeMarker; addTo(): FakeMarker; remove(): void;
};

vi.mock('maplibre-gl', () => {
  class Marker implements FakeMarker {
    lngLat: [number, number] | null = null;
    element: HTMLElement | null = null;
    added = false;
    removed = false;
    constructor(public opts: { element?: HTMLElement } = {}) { this.element = opts.element ?? null; }
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    addTo(): this { this.added = true; markers.push(this); return this; }
    remove(): void { this.removed = true; }
  }
  const api = { Marker };
  return { default: api, ...api };
});

import { buildCameraIcon, buildClusterIcon, renderCctvLayer, syncCctvLayer, type CctvHandlers } from '../src/renderer/modules/geoint/cctvLayer';
import type { Cell } from '../src/renderer/modules/geoint/cctvCluster';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

// Minimal fake map exposing what syncCctvLayer reads.
function fakeMap() {
  return {
    getZoom: () => 3,
    getBounds: () => ({ getWest: () => -180, getSouth: () => -85, getEast: () => 180, getNorth: () => 85 }),
    flyTo: vi.fn()
  };
}

const NOOP: CctvHandlers = { onOpen: () => {}, onCluster: () => {} };

describe('CCTV icon builders', () => {
  it('camera icon is a camera-tagged chip', () => {
    const el = buildCameraIcon();
    expect(el.getAttribute('data-cctv')).toBe('cam');
    expect(el.textContent).toBe('📷');
  });
  it('cluster icon shows the count with a raised Win98 border', () => {
    const el = buildClusterIcon(42);
    expect(el.getAttribute('data-cctv')).toBe('cluster');
    expect(el.textContent).toBe('42');
    expect(el.style.cssText).toContain('outset');
  });
});

describe('renderCctvLayer', () => {
  beforeEach(() => { markers.length = 0; });

  it('adds one marker per cell and clears the previous set on re-render', () => {
    const store = new Map();
    const cellsA: Cell[] = [
      { key: '0,0', lat: 1, lon: 2, count: 1, streamIds: ['a'], singleton: cam({ id: 'a', lat: 1, lon: 2 }) },
      { key: '1,1', lat: 3, lon: 4, count: 5, streamIds: ['b', 'c', 'd', 'e', 'f'] }
    ];
    renderCctvLayer({} as never, store, cellsA, NOOP);
    expect(markers).toHaveLength(2);
    // singleton at [lon, lat]
    expect(markers[0].lngLat).toEqual([2, 1]);
    const first = markers[0];
    renderCctvLayer({} as never, store, [], NOOP);
    expect(first.removed).toBe(true);
    expect(store.size).toBe(0);
  });

  it('routes a singleton click to onOpen(streamId) and a cluster click to onCluster(cell)', () => {
    const store = new Map();
    let opened = '';
    let clustered = '';
    const cells: Cell[] = [
      { key: '0,0', lat: 1, lon: 2, count: 1, streamIds: ['a'], singleton: cam({ id: 'a' }) },
      { key: '1,1', lat: 3, lon: 4, count: 9, streamIds: ['x'] }
    ];
    renderCctvLayer({} as never, store, cells, { onOpen: (id) => { opened = id; }, onCluster: (c) => { clustered = c.key; } });
    markers[0].element!.dispatchEvent(new MouseEvent('click'));
    markers[1].element!.dispatchEvent(new MouseEvent('click'));
    expect(opened).toBe('a');
    expect(clustered).toBe('1,1');
  });
});

describe('syncCctvLayer', () => {
  beforeEach(() => { markers.length = 0; });

  it('clears markers and returns 0 when hidden', () => {
    const store = new Map();
    const n = syncCctvLayer(fakeMap() as never, store, [cam({ id: 'a', lat: 1, lon: 2 })], false, NOOP);
    expect(n).toBe(0);
    expect(markers).toHaveLength(0);
  });

  it('clusters visible streams and renders them when shown', () => {
    const store = new Map();
    const n = syncCctvLayer(fakeMap() as never, store, [
      cam({ id: 'a', lat: 51.5, lon: -0.1 }),
      cam({ id: 'b', lat: -33.8, lon: 151.2 })
    ], true, NOOP);
    expect(n).toBe(2);
    expect(markers).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cctv-layer.test.ts`
Expected: FAIL — `cctvLayer` module/exports missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/modules/geoint/cctvLayer.ts`:

```typescript
/**
 * DOM marker layer for GeoINT CCTV pins. Manages its own Map<cellKey, maplibregl.Marker> so it is
 * independent of the event-marker pipeline (and its MAX_MARKERS cap). Singleton cells render a camera
 * glyph chip; multi-camera cells render a Win98 raised count badge. A full clear+rebuild per sync is
 * cheap at the viewport-filtered cell counts this layer produces.
 */

import maplibregl from 'maplibre-gl';
import type { CameraStream } from '@shared/post-mvp-types';
import { clusterCameras, type Cell } from './cctvCluster';

export const CAMERA_COLOR = '#00a8e8';

/** A camera glyph on a colored chip — reads unambiguously as "camera". */
export function buildCameraIcon(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ga98-cctv-pin';
  el.setAttribute('data-cctv', 'cam');
  el.style.cssText = `display:block;width:18px;height:18px;line-height:18px;text-align:center;`
    + `font-size:13px;border-radius:3px;background:${CAMERA_COLOR};color:#fff;`
    + `border:1px solid rgba(0,0,0,.5);box-sizing:border-box;cursor:pointer;`;
  el.textContent = '📷';
  return el;
}

/** A Win98 raised (outset) gray badge showing the cluster count; gently sized by magnitude. */
export function buildClusterIcon(count: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ga98-cctv-cluster';
  el.setAttribute('data-cctv', 'cluster');
  const d = count >= 100 ? 30 : count >= 10 ? 26 : 22;
  el.style.cssText = `display:block;min-width:${d}px;height:${d}px;line-height:${d}px;text-align:center;`
    + `font-size:11px;font-weight:bold;padding:0 4px;background:var(--ga98-face,#c0c0c0);color:#000;`
    + `border:2px outset #fff;box-sizing:border-box;cursor:pointer;`;
  el.textContent = String(count);
  return el;
}

export interface CctvHandlers {
  onOpen(streamId: string): void;
  onCluster(cell: Cell): void;
}

/** Clear the previous camera markers and render one per cell. Singleton → camera icon → onOpen;
 *  cluster → count badge → onCluster. MapLibre markers live on the map (no layer group), so each is
 *  removed explicitly and the store cleared before rebuilding. */
export function renderCctvLayer(
  map: maplibregl.Map,
  store: Map<string, maplibregl.Marker>,
  cells: Cell[],
  handlers: CctvHandlers
): void {
  for (const mk of store.values()) mk.remove();
  store.clear();
  for (const c of cells) {
    const el = c.singleton ? buildCameraIcon() : buildClusterIcon(c.count);
    if (c.singleton) {
      const id = c.singleton.id;
      el.addEventListener('click', () => handlers.onOpen(id));
    } else {
      el.addEventListener('click', () => handlers.onCluster(c));
    }
    const mk = new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map);
    store.set(c.key, mk);
  }
}

/** Compute clusters for the current view and render them. When hidden, clear the layer. Returns the
 *  number of rendered cells (0 when hidden). */
export function syncCctvLayer(
  map: maplibregl.Map,
  store: Map<string, maplibregl.Marker>,
  streams: CameraStream[],
  showCctv: boolean,
  handlers: CctvHandlers
): number {
  if (!showCctv) {
    for (const mk of store.values()) mk.remove();
    store.clear();
    return 0;
  }
  const b = map.getBounds();
  const cells = clusterCameras(streams, map.getZoom(), {
    west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth()
  });
  renderCctvLayer(map, store, cells, handlers);
  return cells.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cctv-layer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/cctvLayer.ts test/cctv-layer.test.ts
git commit -m "feat(geoint): CCTV DOM marker layer (icons + render + sync)"
```

---

### Task 4: Camera-view window module + registration

**Files:**
- Create: `src/renderer/modules/cameraview/CameraViewModule.tsx`
- Modify: `src/renderer/state/store.ts` (add `'camera-view'` to `ModuleKey`)
- Modify: `src/renderer/modules/register-builtins.tsx` (import + adapter + register)
- Test: `test/camera-view-header.test.ts`

**Interfaces:**
- Consumes: `Viewer` from `../eyespy/Viewer`; `CameraStream`.
- Produces: `cameraHeaderText(stream: CameraStream): string` and `CameraViewModule({ stream })`.

- [ ] **Step 1: Write the failing test**

Create `test/camera-view-header.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cameraHeaderText } from '../src/renderer/modules/cameraview/CameraViewModule';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'A40 Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

describe('cameraHeaderText', () => {
  it('joins label with the present location parts (city · region · country)', () => {
    expect(cameraHeaderText(cam({ city: 'London', region: 'Greater London', country: 'United Kingdom' })))
      .toBe('A40 Cam — London · Greater London · United Kingdom');
  });
  it('omits the dash when no location is present', () => {
    expect(cameraHeaderText(cam())).toBe('A40 Cam');
  });
  it('skips blank location parts', () => {
    expect(cameraHeaderText(cam({ city: 'Paris', country: '' }))).toBe('A40 Cam — Paris');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/camera-view-header.test.ts`
Expected: FAIL — `CameraViewModule` module / `cameraHeaderText` missing.

> Note: this test imports a `.tsx` module in the default `node` env. `cameraHeaderText` is pure and triggers no DOM/maplibre at import; the `Viewer` import is a static React component (no top-level DOM access), so the import resolves under node. If the import errors, add `// @vitest-environment jsdom` at the top of the test file.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/modules/cameraview/CameraViewModule.tsx`:

```tsx
/**
 * CCTV quick-view window — a thin wrapper that plays one camera stream in its own draggable Win98
 * window, opened from a GeoINT camera pin. Reuses the EyeSpy Viewer verbatim; the only chrome is a
 * one-line header naming the camera and its location.
 */

import type { CameraStream } from '@shared/post-mvp-types';
import { Viewer } from '../eyespy/Viewer';

/** "<label> — <city · region · country>" using only the location parts that are present. */
export function cameraHeaderText(stream: CameraStream): string {
  const loc = [stream.city, stream.region, stream.country].filter((p) => p && p.trim()).join(' · ');
  return loc ? `${stream.label} — ${loc}` : stream.label;
}

export function CameraViewModule({ stream }: { stream: CameraStream }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {cameraHeaderText(stream)} <span style={{ opacity: 0.6 }}>({stream.kind})</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: '#000' }}>
        <Viewer stream={stream} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/camera-view-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the module (no separate test — covered by typecheck + Task 5 wiring + manual smoke)**

In `src/renderer/state/store.ts`, add `'camera-view'` to the `ModuleKey` union (e.g. after `'chat'`):

```typescript
  | 'chat'
  | 'camera-view'
  | 'help';
```

In `src/renderer/modules/register-builtins.tsx`, add the import near the other module imports:

```tsx
import { CameraViewModule } from './cameraview/CameraViewModule';
```

Add the adapter near the other adapters (it reads the `stream` prop passed at open time):

```tsx
function CameraViewAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <CameraViewModule stream={spec.props?.['stream'] as import('@shared/post-mvp-types').CameraStream} />;
}
```

Add the registration inside `registerBuiltins()` (after the `chat` line). It is window-only: do NOT add it to `shell/Desktop.tsx`, `shell/AccessMenu.tsx`, or `shell/Shortcuts.tsx`, so it never appears as a launcher:

```tsx
  registerModule({ key: 'camera-view', title: 'Camera', glyph: '📹', component: CameraViewAdapter, builtin: true, defaultWidth: 480, defaultHeight: 360 });
```

- [ ] **Step 6: Verify typecheck + registration test suite still green**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm vitest run test/camera-view-header.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/cameraview/CameraViewModule.tsx test/camera-view-header.test.ts src/renderer/state/store.ts src/renderer/modules/register-builtins.tsx
git commit -m "feat(geoint): camera-view quick-view window module + registration"
```

---

### Task 5: Wire the layer into MapGL and GeoIntModule

**Files:**
- Modify: `src/renderer/modules/geoint/MapGL.tsx` (props + camera-layer effect)
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx` (streams fetch, toggle, onCameraOpen, pass props)
- Test: `test/geoint-cctv-wiring.test.ts`

**Interfaces:**
- Consumes: `syncCctvLayer`, `CctvHandlers` from `./cctvLayer`; `cameraWindowAction`, `cameraWindowId`, `MAX_CAMERA_WINDOWS` from `../cameraview/cameraWindow`; `validCoord` from `./MapGL`; `useWindows`, `alertDialog`, `window.api.streams.list`.
- Produces: new optional `MapGLProps` — `cctvStreams?: CameraStream[]`, `showCctv?: boolean`, `onCameraOpen?: (streamId: string) => void`.

- [ ] **Step 1: Write the failing test**

This test drives `syncCctvLayer` (the unit MapGL delegates to) through a mocked map exactly as MapGL will call it on `moveend`/`zoomend`, proving the camera layer renders/clears against live map state. (The React effect itself, like the other MapGL effects, is asserted via the extracted helper — the repo has no React-renderer test infra; see `test/geoint-mapgl.test.ts`.)

Create `test/geoint-cctv-wiring.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const markers: Array<{ removed: boolean; lngLat: [number, number] | null }> = [];
vi.mock('maplibre-gl', () => {
  class Marker {
    lngLat: [number, number] | null = null;
    removed = false;
    constructor(public opts: { element?: HTMLElement } = {}) {}
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    addTo(): this { markers.push(this); return this; }
    remove(): void { this.removed = true; }
  }
  const api = { Marker };
  return { default: api, ...api };
});

import { syncCctvLayer } from '../src/renderer/modules/geoint/cctvLayer';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

function mapAt(zoom: number, b = { w: -180, s: -85, e: 180, n: 85 }) {
  return {
    getZoom: () => zoom,
    getBounds: () => ({ getWest: () => b.w, getSouth: () => b.s, getEast: () => b.e, getNorth: () => b.n }),
    flyTo: vi.fn()
  };
}

describe('MapGL camera-layer sync (the moveend/zoomend delegate)', () => {
  beforeEach(() => { markers.length = 0; });

  it('renders camera markers within the current viewport and re-syncs on a viewport change', () => {
    const store = new Map();
    const handlers = { onOpen: () => {}, onCluster: () => {} };
    const streams = [cam({ id: 'lon', lat: 51.5, lon: -0.1 }), cam({ id: 'syd', lat: -33.8, lon: 151.2 })];
    // World view: both visible.
    expect(syncCctvLayer(mapAt(2) as never, store, streams, true, handlers)).toBe(2);
    // Zoom into London bounds: only the London camera survives the viewport filter.
    const n = syncCctvLayer(mapAt(10, { w: -0.5, s: 51.2, e: 0.2, n: 51.7 }) as never, store, streams, true, handlers);
    expect(n).toBe(1);
  });

  it('clears the layer when toggled off', () => {
    const store = new Map();
    syncCctvLayer(mapAt(2) as never, store, [cam({ id: 'a', lat: 1, lon: 2 })], true, { onOpen: () => {}, onCluster: () => {} });
    expect(store.size).toBe(1);
    expect(syncCctvLayer(mapAt(2) as never, store, [cam({ id: 'a', lat: 1, lon: 2 })], false, { onOpen: () => {}, onCluster: () => {} })).toBe(0);
    expect(store.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-cctv-wiring.test.ts`
Expected: FAIL initially only if `cctvLayer`/`cctvCluster` are absent. Since Tasks 1+3 created them, this test should PASS immediately — that is acceptable here because this task's deliverable is the *component wiring*, which has no headless React-render test in this repo (same limitation the existing MapGL suite documents). Treat Step 2 as: run it and confirm GREEN, then do the wiring in Steps 3–4 and keep it green.

- [ ] **Step 3: Add the camera-layer props + effect to `MapGL.tsx`**

Extend the existing `@shared/post-mvp-types` type import (MapGL already imports `GeoItem` from it — add `CameraStream` to that same line, don't add a second import) and add the `cctvLayer` import:

```typescript
// change the existing line `import type { GeoItem } from '@shared/post-mvp-types';` to:
import type { GeoItem, CameraStream } from '@shared/post-mvp-types';
// and add:
import { syncCctvLayer } from './cctvLayer';
```

Extend `MapGLProps` (add these three fields inside the interface):

```typescript
  /** All geolocated CCTV streams to cluster onto the map (already validCoord-filtered upstream). */
  cctvStreams?: CameraStream[];
  /** When true, render the clustered camera layer. */
  showCctv?: boolean;
  /** Click handler for a single camera pin. */
  onCameraOpen?: (streamId: string) => void;
```

In the `MapGL` component, add the three to the props destructure:

```typescript
  const {
    items = [], corroboration, tilesEnabled, tileUrl, tileAttribution,
    pickMode = false, onPick, focusId, flyTo, onCenterChange,
    overlayUrls = [], overlayAttribution,
    cctvStreams = [], showCctv = false, onCameraOpen
  } = props;
```

After the existing `markers`/`searchMarker` refs, add the camera-layer ref and latest-value refs:

```typescript
  // Camera (CCTV) markers, kept in their OWN store so they never touch the event-marker set or its
  // MAX_MARKERS cap. Rebuilt on every viewport change from the clustered cells.
  const cctvMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const cctvStreamsRef = useRef(cctvStreams);
  cctvStreamsRef.current = cctvStreams;
  const showCctvRef = useRef(showCctv);
  showCctvRef.current = showCctv;
  const onCameraOpenRef = useRef(onCameraOpen);
  onCameraOpenRef.current = onCameraOpen;
```

After `trackPopup` (and before the init effect), add a stable sync callback:

```typescript
  // Cluster + render the camera layer for the current view. Reads latest props via refs so it can be
  // a stable (deps []) listener on moveend/zoomend without re-creating the map. A cluster click flies
  // one step deeper so clusters progressively split toward individual camera pins.
  const syncCctv = useCallback(() => {
    const m = map.current;
    if (!m) return;
    syncCctvLayer(m, cctvMarkers.current, cctvStreamsRef.current, showCctvRef.current, {
      onOpen: (id) => onCameraOpenRef.current?.(id),
      onCluster: (cell) => m.flyTo({ center: [cell.lon, cell.lat], zoom: Math.min(m.getZoom() + 2, 16) })
    });
  }, []);
```

In the init effect (the `useEffect(() => { ... }, [])` that creates the map), register the listeners right after `map.current = m;`:

```typescript
    m.on('moveend', syncCctv);
    m.on('zoomend', syncCctv);
    map.current = m;
```

Add a dedicated effect (next to the other marker effects) that re-syncs when the toggle or the stream set changes:

```typescript
  // Re-render the camera layer when toggled or when the stream set changes (the moveend/zoomend
  // listeners cover pan/zoom). Refs are assigned during render, so they're current here.
  useEffect(() => {
    syncCctv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCctv, cctvStreams]);
```

- [ ] **Step 4: Wire `GeoIntModule.tsx` — streams fetch, toggle, onCameraOpen, pass props**

Add imports near the top of `src/renderer/modules/geoint/GeoIntModule.tsx`. Some modules are already imported — **merge into the existing import statements, don't duplicate them**:

- It already has `import { MapGL } from './MapGL';` → change to `import { MapGL, validCoord } from './MapGL';`
- It already imports from `@shared/post-mvp-types` (for `GeoItem`/etc.) → add `CameraStream` to that line.
- For the store: it reads settings via a store hook — if it already imports from `../../state/store`, add `useWindows` to that line; otherwise add `import { useWindows } from '../../state/store';`.
- Add the two genuinely new imports:

```typescript
import { alertDialog } from '../../state/dialogs';
import { cameraWindowAction, cameraWindowId, MAX_CAMERA_WINDOWS } from '../cameraview/cameraWindow';
```

Before writing these, grep the file's current import block (`head -40`) to confirm exactly which of the above already exist, then merge accordingly.

Inside the module component, add state near the other `useState` hooks:

```typescript
  // CCTV camera layer (off by default; pins are local data so this is NOT behind the network gate).
  const [showCctv, setShowCctv] = useState(false);
  const [cctvStreams, setCctvStreams] = useState<CameraStream[]>([]);
```

Add the streams fetch + open handler (place near the other callbacks/effects). Fetch once on mount and on Refresh:

```typescript
  const refreshCameras = useCallback(async () => {
    try {
      const all = await window.api.streams.list();
      setCctvStreams(all.filter((s) => validCoord(s.lat, s.lon)));
    } catch {
      setCctvStreams([]);
      setShowCctv(false);
      void alertDialog('Could not load the camera list.', 'CCTV cameras');
    }
  }, []);

  useEffect(() => { void refreshCameras(); }, [refreshCameras]);

  const onCameraOpen = useCallback((streamId: string) => {
    const stream = cctvStreams.find((s) => s.id === streamId);
    if (!stream) return;
    const openIds = useWindows.getState().windows.filter((w) => w.module === 'camera-view').map((w) => w.id);
    if (cameraWindowAction(openIds, streamId) === 'deny') {
      void alertDialog(`Close a camera window first (max ${MAX_CAMERA_WINDOWS} open).`, 'CCTV cameras');
      return;
    }
    // open() dedups by id: an already-open camera window is re-focused; otherwise a new one opens.
    useWindows.getState().open({
      module: 'camera-view',
      id: cameraWindowId(streamId),
      title: stream.label,
      props: { stream },
      width: 480,
      height: 360
    });
  }, [cctvStreams]);
```

Pass the props to `MapGL` (extend the existing `<MapGL ... />` at ~line 810 with the three new props):

```tsx
          <MapGL items={mapItems} corroboration={corroboration} tilesEnabled={net} tileUrl={activeTileUrl} tileAttribution={activeTileAttribution}
            /* ...existing props unchanged... */
            cctvStreams={cctvStreams} showCctv={showCctv} onCameraOpen={onCameraOpen}
          />
```

Add the toggle UI. Place a small block immediately before the `<legend>Threat Layers</legend>` fieldset (it is intentionally OUTSIDE the network-gated styling — full opacity, never disabled):

```tsx
        <fieldset style={{ marginTop: 6 }}>
          <legend>CCTV</legend>
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showCctv} onChange={(e) => setShowCctv(e.target.checked)} />
            CCTV cameras ({cctvStreams.length})
          </label>
          <button style={{ marginLeft: 8 }} onClick={() => void refreshCameras()} title="Reload the camera list from EyeSpy">Refresh</button>
        </fieldset>
```

- [ ] **Step 5: Run the wiring test + typecheck**

Run: `pnpm vitest run test/geoint-cctv-wiring.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: all tests pass (the four new suites plus the existing ~1076).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/geoint/MapGL.tsx src/renderer/modules/geoint/GeoIntModule.tsx test/geoint-cctv-wiring.test.ts
git commit -m "feat(geoint): wire clustered CCTV camera layer + pin-click windows into the map"
```

---

## Manual verification (after Task 5, before release)

GhostExodus smoke on Windows (the headless tests can't render WebGL):

1. Import a coordinate-bearing scrape in EyeSpy (e.g. the London TfL file). Open GeoINT.
2. Tick **CCTV cameras (N)** — N matches the geolocated count; dense areas (London) show a count badge; sparse cameras show camera pins. Toggle works with the GeoINT network gate OFF.
3. Zoom in — clusters split toward individual camera pins; click a cluster → it flies one step deeper.
4. Click a camera pin — a 480×360 window opens and plays the feed. Re-click the same pin → the existing window is focused (no duplicate). Open 8, then a 9th → "Close a camera window first" dialog.
5. Confirm the Win98 look is intact (camera chips + raised count badges; no flat-modern restyle).

## Notes on charter / invariants

- No new dependency; clustering reuses the existing spatial-grid approach.
- Pins are local-only data; the layer renders with the network gate off. Playback is the same egress EyeSpy already performs (decision in the spec). No telemetry, no new network path.
- No CSP change; no `frame-src` broadening.
- Deterministic clustering (stable sort; no time/RNG in the path).
