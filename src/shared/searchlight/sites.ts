import type { MaigretSiteEntry, SiteCatalogEntry, CheckType } from './types';

const CHECK_TYPES: ReadonlySet<string> = new Set(['status_code', 'message', 'response_url', 'unknown']);

function coerceEntry(name: string, info: Record<string, unknown>): MaigretSiteEntry {
  const tags = Array.isArray(info.tags) ? (info.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const ct = typeof info.checkType === 'string' && CHECK_TYPES.has(info.checkType) ? (info.checkType as CheckType) : 'status_code';
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const hdrs = info.headers && typeof info.headers === 'object' ? (info.headers as Record<string, string>) : {};
  return {
    name,
    url: String(info.url),
    urlMain: typeof info.urlMain === 'string' ? info.urlMain : '',
    urlProbe: typeof info.urlProbe === 'string' ? info.urlProbe : '',
    category: tags.length > 0 ? tags[0] : 'misc',
    tags,
    checkType: ct,
    presenseStrs: strArr(info.presenseStrs),
    absenceStrs: strArr(info.absenceStrs),
    alexaRank: typeof info.alexaRank === 'number' ? info.alexaRank : 99999,
    headers: hdrs,
    usernameClaimed: typeof info.usernameClaimed === 'string' ? info.usernameClaimed : ''
  };
}

/** Parse a trusted/bundled Maigret object (or {sites:{...}} envelope). */
export function parseMaigretData(json: unknown): MaigretSiteEntry[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const sites = (root.sites && typeof root.sites === 'object' ? root.sites : root) as Record<string, unknown>;
  return Object.entries(sites)
    .filter(([, info]) => info && typeof info === 'object' && typeof (info as Record<string, unknown>).url === 'string' && !(info as Record<string, unknown>).disabled)
    .map(([name, info]) => coerceEntry(name, info as Record<string, unknown>));
}

/** Substitute {username} (url-encoded) into url and urlProbe. */
export function buildProbeUrl(username: string, site: MaigretSiteEntry): { url: string; probeUrl: string } {
  const enc = encodeURIComponent(username);
  const url = site.url.replace(/\{username\}/g, enc);
  const probeUrl = site.urlProbe ? site.urlProbe.replace(/\{username\}/g, enc) : url;
  return { url, probeUrl };
}

export function toCatalog(sites: MaigretSiteEntry[]): SiteCatalogEntry[] {
  return sites.map((s) => ({ name: s.name, category: s.category, tags: s.tags, checkType: s.checkType }));
}

/** Validate UNTRUSTED imported site data. Each entry must have an https URL
 *  containing the {username} token. Caps the total accepted. */
export function validateImportedSites(raw: unknown, cap = 5000): { sites: MaigretSiteEntry[]; rejected: number } {
  if (!raw || typeof raw !== 'object') return { sites: [], rejected: 0 };
  const root = raw as Record<string, unknown>;
  const src = (root.sites && typeof root.sites === 'object' ? root.sites : root) as Record<string, unknown>;
  const sites: MaigretSiteEntry[] = [];
  let rejected = 0;
  for (const [name, info] of Object.entries(src)) {
    if (sites.length >= cap) { rejected++; continue; }
    if (!info || typeof info !== 'object') { rejected++; continue; }
    const url = (info as Record<string, unknown>).url;
    if (typeof url !== 'string' || !/^https:\/\//i.test(url) || !url.includes('{username}')) { rejected++; continue; }
    sites.push(coerceEntry(name, info as Record<string, unknown>));
  }
  return { sites, rejected };
}
