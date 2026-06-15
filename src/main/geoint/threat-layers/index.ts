/**
 * Threat-layer dispatcher (GeoINT reimagine R5). Routes a layer id to its stateless
 * fetch → GeoItem[] module. Extensible: add a layer module + a case here + the id to the
 * IPC validator allowlist (ensureThreatLayerId). Throws on an unknown id as defense in depth
 * (the IPC validator also allowlists before we get here).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { fetchUsgs } from './usgs';
import { fetchGdacs } from './gdacs';
import { fetchWarTracker } from './war-tracker';
import { fetchGdelt } from './gdelt';

export type ThreatLayerId = 'usgs' | 'gdacs' | 'wartracker' | 'gdelt';

export const THREAT_LAYER_IDS: readonly ThreatLayerId[] = ['usgs', 'gdacs', 'wartracker', 'gdelt'];

export async function fetchThreatLayer(layerId: ThreatLayerId, opts: object): Promise<GeoItem[]> {
  switch (layerId) {
    case 'usgs':
      return fetchUsgs(opts as { feed?: string });
    case 'gdacs':
      return fetchGdacs(opts);
    case 'wartracker':
      return fetchWarTracker(opts as { country?: string });
    case 'gdelt':
      return fetchGdelt(opts as { query?: string });
    default:
      throw new Error(`unknown threat layer: ${String(layerId)}`);
  }
}
