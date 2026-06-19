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
