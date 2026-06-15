/**
 * MapLibre GL map for GeoINT — 3D globe skeleton (Task R1 of the GeoINT reimagine).
 *
 * This is the foundation for the Leaflet→MapLibre migration: a dark globe with no basemap
 * tiles yet (raster tiles arrive in R2, markers/flyTo/pick in later tasks). It is NOT the
 * live map — GeoIntModule still mounts the Leaflet MapPane by default; MapGL renders only
 * behind the `useMapGL` flag so nothing regresses while the migration is staged.
 *
 * The map-creation logic lives in `createGlobeMap()` so it can be unit-tested against a mocked
 * `maplibre-gl` (WebGL can't render headlessly): the test asserts a globe projection is
 * requested and that cleanup runs. The component's mount effect just calls it and guards
 * against double-init (React 18 StrictMode mounts effects twice in dev) like MapPane does.
 */

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoItem } from '@shared/post-mvp-types';

// Minimal empty dark style: no sources, a single background layer. Raster basemap tiles are
// wired in R2 (behind the same network egress gate the Leaflet path already enforces).
// In MapLibre GL JS v5 the globe projection lives in the StyleSpecification (`style.projection`),
// not in MapOptions — so the empty dark style both paints the globe and requests the projection.
const EMPTY_DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1a' } }]
};

// World view: zoomed out so the whole globe is visible on first paint.
const INITIAL_CENTER: [number, number] = [0, 20];
const INITIAL_ZOOM = 1.5;

/**
 * Construct a MapLibre globe map into `container`. Factored out of the component so the init
 * path (projection + style + world view) is unit-testable with a mocked maplibre-gl. Callers
 * own the returned map's lifecycle (call `.remove()` on unmount).
 */
export function createGlobeMap(container: HTMLElement): maplibregl.Map {
  return new maplibregl.Map({
    container,
    // The globe projection is declared in the style (`EMPTY_DARK_STYLE.projection`) — MapLibre v5
    // carries projection in the StyleSpecification, not MapOptions.
    style: EMPTY_DARK_STYLE,
    // MapLibre takes attribution options (or `false` to disable), not a bare boolean. `{}` keeps
    // the attribution control on with defaults — the OSINT-honest "where did these tiles come
    // from" credit the Leaflet path also shows.
    attributionControl: {},
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM
  });
}

// Prop surface mirrors a SUBSET of MapPane's for forward-compatibility, but R1 renders none of
// it — every field is optional so the component works with `<MapGL />`. Wiring these (tiles,
// markers, focus, flyTo, pick) is the job of R2+.
export interface MapGLProps {
  items?: GeoItem[];
  tilesEnabled?: boolean;
  tileUrl?: string;
  tileAttribution?: string;
  focusId?: string | null;
}

export function MapGL(_props: MapGLProps = {}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    // Guard against double-init: a ref'd map already exists (StrictMode re-run), or the
    // container isn't mounted yet. Same pattern MapPane uses for its Leaflet map.
    if (!ref.current || map.current) return;
    map.current = createGlobeMap(ref.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  return <div ref={ref} className="ga98-geo-map" style={{ width: '100%', height: '100%' }} />;
}
