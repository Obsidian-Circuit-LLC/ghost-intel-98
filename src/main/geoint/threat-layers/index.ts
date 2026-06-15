/**
 * Threat-layer dispatcher (GeoINT reimagine R5; keyed layers added in beta10). Routes a layer id to
 * its stateless fetch → GeoItem[] module. Extensible: add a layer module + a case here + the id to
 * the IPC validator allowlist (ensureThreatLayerId). Throws on an unknown id as defense in depth
 * (the IPC validator also allowlists before we get here).
 *
 * KEYED layers (firms, gdeltcloud, ucdp) take a `key` in opts — read main-side from secretStore by
 * the IPC handler, never held by the renderer. A keyed layer with no key returns [] (its fetch
 * function short-circuits on an empty key; the handler also gates before calling).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { fetchUsgs } from './usgs';
import { fetchGdacs } from './gdacs';
import { fetchWarTracker } from './war-tracker';
import { fetchGdelt } from './gdelt';
import { fetchFirms } from './firms';
import { fetchGdeltCloud } from './gdeltcloud';
import { fetchUcdp } from './ucdp';

export type ThreatLayerId =
  | 'usgs' | 'gdacs' | 'wartracker' | 'gdelt'
  | 'firms' | 'gdeltcloud' | 'ucdp';

export const THREAT_LAYER_IDS: readonly ThreatLayerId[] = [
  'usgs', 'gdacs', 'wartracker', 'gdelt', 'firms', 'gdeltcloud', 'ucdp'
];

interface ThreatLayerOpts {
  feed?: string;
  country?: string;
  query?: string;
  source?: string;
  area?: string;
  version?: string;
  /** Present only for keyed layers; the handler reads it from secretStore main-side. */
  key?: string;
}

export async function fetchThreatLayer(layerId: ThreatLayerId, opts: ThreatLayerOpts): Promise<GeoItem[]> {
  switch (layerId) {
    case 'usgs':
      return fetchUsgs(opts as { feed?: string });
    case 'gdacs':
      return fetchGdacs(opts);
    case 'wartracker':
      return fetchWarTracker(opts as { country?: string });
    case 'gdelt':
      return fetchGdelt(opts as { query?: string });
    case 'firms':
      return fetchFirms(opts.key ?? '', { source: opts.source, area: opts.area });
    case 'gdeltcloud':
      return fetchGdeltCloud(opts.key ?? '', { query: opts.query, country: opts.country });
    case 'ucdp':
      return fetchUcdp(opts.key ?? '', { version: opts.version });
    default:
      throw new Error(`unknown threat layer: ${String(layerId)}`);
  }
}
