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
