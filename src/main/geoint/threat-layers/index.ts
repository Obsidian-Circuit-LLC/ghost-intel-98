/**
 * Threat-layer dispatcher (GeoINT reimagine R5). Routes a layer id to its stateless
 * fetch → GeoItem[] module. Extensible: add a layer module + a case here + the id to the
 * IPC validator allowlist (ensureThreatLayerId). Throws on an unknown id as defense in depth
 * (the IPC validator also allowlists before we get here).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { fetchUsgs } from './usgs';
import { fetchGdacs } from './gdacs';

export type ThreatLayerId = 'usgs' | 'gdacs';

export const THREAT_LAYER_IDS: readonly ThreatLayerId[] = ['usgs', 'gdacs'];

export async function fetchThreatLayer(layerId: ThreatLayerId, opts: object): Promise<GeoItem[]> {
  switch (layerId) {
    case 'usgs':
      return fetchUsgs(opts as { feed?: string });
    case 'gdacs':
      return fetchGdacs(opts);
    default:
      throw new Error(`unknown threat layer: ${String(layerId)}`);
  }
}
