/**
 * Inverse of feed-import's parseNestedTree: rebuild the 4-level master CCTV tree
 * (Country → Region → City → [{ stream_url, coordinates? }]) from the flat CameraStream library, so
 * the operator can export their (coordinate-edited) corpus back to a re-importable master_CCTV.json.
 *
 * - coordinates are emitted ONLY when both lat & lon are present (post-pickGeo they are a range-valid
 *   pair); otherwise the key is omitted, matching the reference master shape.
 * - missing country/region/city bucket under the literal "Unknown" so every camera is representable
 *   and the tree stays 4 levels deep (round-trips through parseNestedTree, which stamps the path back
 *   into country/region/city).
 * - deterministic: country/region/city keys sorted; cameras within a city in stable input order.
 */
import type { CameraStream } from '@shared/post-mvp-types';

export interface MasterCamera {
  stream_url: string;
  coordinates?: { latitude: number; longitude: number };
}
export type MasterTree = Record<string, Record<string, Record<string, MasterCamera[]>>>;

const UNKNOWN = 'Unknown';

export function streamsToMasterTree(streams: CameraStream[]): MasterTree {
  const tree: MasterTree = {};
  for (const s of streams) {
    const country = (s.country && s.country.trim()) || UNKNOWN;
    const region = (s.region && s.region.trim()) || UNKNOWN;
    const city = (s.city && s.city.trim()) || UNKNOWN;
    const cam: MasterCamera = { stream_url: s.url };
    if (typeof s.lat === 'number' && Number.isFinite(s.lat) && typeof s.lon === 'number' && Number.isFinite(s.lon)) {
      cam.coordinates = { latitude: s.lat, longitude: s.lon };
    }
    const c = (tree[country] ??= {});
    const r = (c[region] ??= {});
    const arr = (r[city] ??= []);
    arr.push(cam);
  }
  return sortTree(tree);
}

/** Re-emit the tree with country/region/city keys in sorted order (non-numeric string keys preserve
 *  insertion order in JS, so a sorted rebuild gives deterministic output). City arrays keep order. */
function sortTree(tree: MasterTree): MasterTree {
  const out: MasterTree = {};
  for (const country of Object.keys(tree).sort()) {
    out[country] = {};
    for (const region of Object.keys(tree[country]).sort()) {
      out[country][region] = {};
      for (const city of Object.keys(tree[country][region]).sort()) {
        out[country][region][city] = tree[country][region][city];
      }
    }
  }
  return out;
}
