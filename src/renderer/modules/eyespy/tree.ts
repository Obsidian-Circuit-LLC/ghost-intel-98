import type { CameraStream } from '@shared/post-mvp-types';

export type TreeLevel = 'country' | 'region' | 'city';

export interface TreeNode {
  key: string;
  label: string;
  level: TreeLevel;
  count: number;
  streamIds: string[];
  children: TreeNode[];
  country?: string;   // node's own coords; undefined for the Ungeocoded bucket
  region?: string;
  city?: string;
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
          cityNodes.push({ key: `${country}\0${region}\0${city}`, label: city, level: 'city', count: ids.length, streamIds: [...ids], children: [], country: country === UNGEO ? undefined : country, region: region || undefined, city });
        }
      }
      countryIds.push(...regionIds);
      cityNodes.sort((a, b) => cmpLabel(a.label, b.label));
      if (region) {
        countryChildren.push({ key: `${country}\0${region}`, label: region, level: 'region', count: regionIds.length, streamIds: [...regionIds], children: cityNodes, country: country === UNGEO ? undefined : country, region });
      } else {
        countryChildren.push(...cityNodes);
      }
    }
    countryChildren.sort((a, b) => cmpLabel(a.label, b.label));
    out.push({ key: country, label: country, level: 'country', count: countryIds.length, streamIds: countryIds, children: countryChildren, country: country === UNGEO ? undefined : country });
  }
  out.sort((a, b) => cmpLabel(a.label, b.label));
  return out;
}

export function findNode(nodes: TreeNode[], key: string): TreeNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    const hit = findNode(n.children, key);
    if (hit) return hit;
  }
  return null;
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

// Offline country-name → ISO-3166-alpha-2, then to a regional-indicator flag emoji. No network/assets.
const COUNTRY_ISO: Record<string, string> = {
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
  'united states': 'US', usa: 'US', 'united states of america': 'US', 'u.s.': 'US',
  canada: 'CA', australia: 'AU', germany: 'DE', france: 'FR', netherlands: 'NL',
  spain: 'ES', italy: 'IT', ireland: 'IE', japan: 'JP', 'new zealand': 'NZ',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', poland: 'PL',
  switzerland: 'CH', austria: 'AT', belgium: 'BE', portugal: 'PT', 'czech republic': 'CZ',
  mexico: 'MX', brazil: 'BR', 'south korea': 'KR', china: 'CN', india: 'IN', russia: 'RU'
};

export function countryFlag(name: string | undefined): string {
  const iso = COUNTRY_ISO[(name ?? '').trim().toLowerCase()];
  if (!iso) return '';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)));
}

export interface CityEntry { city: string; region?: string; country?: string; count: number }

export function citiesOf(streams: CameraStream[]): CityEntry[] {
  const m = new Map<string, CityEntry>();
  for (const s of streams) {
    const city = (s.city ?? '').trim();
    if (!city) continue;
    const key = `${(s.country ?? '').toLowerCase()} ${city.toLowerCase()}`;
    const e = m.get(key) ?? { city, region: (s.region ?? '').trim() || undefined, country: (s.country ?? '').trim() || undefined, count: 0 };
    e.count += 1;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => a.city.localeCompare(b.city, 'en', { numeric: true, sensitivity: 'base' }));
}
