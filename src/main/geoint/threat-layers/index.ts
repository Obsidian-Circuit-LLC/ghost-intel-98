/**
 * Threat-layer dispatcher (GeoINT reimagine R5). Routes a layer id to its stateless
 * fetch → GeoItem[] module. Extensible: add a layer module + a case here + the id to the
 * IPC validator allowlist (ensureThreatLayerId). Throws on an unknown id as defense in depth
 * (the IPC validator also allowlists before we get here).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { fetchUsgs } from './usgs';

export type ThreatLayerId = 'usgs';

export const THREAT_LAYER_IDS: readonly ThreatLayerId[] = ['usgs'];

export async function fetchThreatLayer(layerId: ThreatLayerId, opts: object): Promise<GeoItem[]> {
  switch (layerId) {
    case 'usgs':
      return fetchUsgs(opts as { feed?: string });
    default:
      throw new Error(`unknown threat layer: ${String(layerId)}`);
  }
}
