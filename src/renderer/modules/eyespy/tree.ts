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

export function matchStream(s: CameraStream, qLower: string): boolean {
  const hay = `${s.label} ${s.city ?? ''} ${s.region ?? ''} ${s.country ?? ''} ${s.url}`.toLowerCase();
  return hay.includes(qLower);
}

export function filterTree(nodes: TreeNode[], streams: CameraStream[], q: string): TreeNode[] {
  const query = q.trim().toLowerCase();
  if (!query) return nodes;
  const byId = new Map(streams.map((s) => [s.id, s] as const));
  const keep = (n: TreeNode): TreeNode | null => {
    const children = n.children.map(keep).filter((c): c is TreeNode => c !== null);
    const labelHit = n.label.toLowerCase().includes(query);
    const streamHit = n.streamIds.some((id) => { const st = byId.get(id); return !!st && matchStream(st, query); });
    return labelHit || streamHit || children.length > 0 ? { ...n, children } : null;
  };
  return nodes.map(keep).filter((c): c is TreeNode => c !== null);
}
