import type { CameraStream } from '@shared/post-mvp-types';

export type TreeLevel = 'country' | 'region' | 'city';

export interface TreeNode {
  key: string;
  label: string;
  level: TreeLevel;
  count: number;
  streamIds: string[];
  children: TreeNode[];
}

const UNGEO = 'Ungeocoded';
const norm = (v: string | undefined): string => (v ?? '').trim();

function cmpLabel(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNGEO) return 1;
  if (b === UNGEO) return -1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

export function buildTree(streams: CameraStream[]): TreeNode[] {
  const tree = new Map<string, Map<string, Map<string, string[]>>>();
  for (const s of streams) {
    const country = norm(s.country) || UNGEO;
    const region = norm(s.region);
    const city = norm(s.city);
    const rMap = tree.get(country) ?? new Map<string, Map<string, string[]>>();
    tree.set(country, rMap);
    const cMap = rMap.get(region) ?? new Map<string, string[]>();
    rMap.set(region, cMap);
    const ids = cMap.get(city) ?? [];
    cMap.set(city, ids);
    ids.push(s.id);
  }

  const out: TreeNode[] = [];
  for (const [country, rMap] of tree) {
    const countryIds: string[] = [];
    const countryChildren: TreeNode[] = [];
    for (const [region, cMap] of rMap) {
      const regionIds: string[] = [];
      const cityNodes: TreeNode[] = [];
      for (const [city, ids] of cMap) {
        regionIds.push(...ids);
        if (city) {
          cityNodes.push({ key: `${country}/${region}/${city}`, label: city, level: 'city', count: ids.length, streamIds: [...ids], children: [] });
        }
      }
      countryIds.push(...regionIds);
      cityNodes.sort((a, b) => cmpLabel(a.label, b.label));
      if (region) {
        countryChildren.push({ key: `${country}/${region}`, label: region, level: 'region', count: regionIds.length, streamIds: [...regionIds], children: cityNodes });
      } else {
        countryChildren.push(...cityNodes);
      }
    }
    countryChildren.sort((a, b) => cmpLabel(a.label, b.label));
    out.push({ key: country, label: country, level: 'country', count: countryIds.length, streamIds: countryIds, children: countryChildren });
  }
  out.sort((a, b) => cmpLabel(a.label, b.label));
  return out;
}
