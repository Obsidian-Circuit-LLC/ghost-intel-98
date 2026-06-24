import type { MaigretSiteEntry, SiteCatalogEntry, CheckType } from './types';

const CHECK_TYPES: ReadonlySet<string> = new Set(['status_code', 'message', 'response_url', 'unknown']);

/** Resolve Maigret engine placeholders ({urlMain}/{urlSubpath}) in a url template.
 *  These come from an engine's `.site.url` and are filled from the site's own
 *  `urlMain`/`urlSubpath` fields. `urlSubpath` is optional in Maigret and defaults
 *  to '' when absent. {username} is intentionally left for buildProbeUrl. */
function resolveUrlPlaceholders(tpl: string, urlMain: string, urlSubpath: string): string {
  return tpl.replace(/\{urlMain\}/g, urlMain).replace(/\{urlSubpath\}/g, urlSubpath);
}

function coerceEntry(name: string, info: Record<string, unknown>): MaigretSiteEntry {
  const tags = Array.isArray(info.tags) ? (info.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const ct = typeof info.checkType === 'string' && CHECK_TYPES.has(info.checkType) ? (info.checkType as CheckType) : 'status_code';
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const hdrs = info.headers && typeof info.headers === 'object' ? (info.headers as Record<string, string>) : {};
  const urlMain = typeof info.urlMain === 'string' ? info.urlMain : '';
  const urlSubpath = typeof info.urlSubpath === 'string' ? info.urlSubpath : '';
  return {
    name,
    url: resolveUrlPlaceholders(String(info.url), urlMain, urlSubpath),
    urlMain,
    urlProbe: typeof info.urlProbe === 'string' ? resolveUrlPlaceholders(info.urlProbe, urlMain, urlSubpath) : '',
    category: tags.length > 0 ? tags[0] : 'misc',
    tags,
    checkType: ct,
    presenseStrs: strArr(info.presenseStrs),
    absenceStrs: strArr(info.absenceStrs),
    alexaRank: typeof info.alexaRank === 'number' ? info.alexaRank : 99999,
    headers: hdrs,
    usernameClaimed: typeof info.usernameClaimed === 'string' ? info.usernameClaimed : '',
    ...(info.ignore403 === true ? { ignore403: true as const } : {})
  };
}

/** Merge an engine's `.site` defaults beneath a site's own fields (site overrides engine). */
function resolveEngine(info: Record<string, unknown>, engines: Record<string, unknown>): Record<string, unknown> {
  const engName = typeof info.engine === 'string' ? info.engine : null;
  const engDef = engName && engines[engName] && typeof engines[engName] === 'object'
    ? (engines[engName] as Record<string, unknown>).site
    : null;
  if (engDef && typeof engDef === 'object') return { ...(engDef as Record<string, unknown>), ...info };
  return info;
}

/** Parse a trusted/bundled Maigret object (or {sites, engines, tags} envelope). */
export function parseMaigretData(json: unknown): MaigretSiteEntry[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const sites = (root.sites && typeof root.sites === 'object' ? root.sites : root) as Record<string, unknown>;
  const engines = (root.engines && typeof root.engines === 'object' ? root.engines : {}) as Record<string, unknown>;
  const out: MaigretSiteEntry[] = [];
  for (const [name, rawInfo] of Object.entries(sites)) {
    if (!rawInfo || typeof rawInfo !== 'object') continue;
    const merged = resolveEngine(rawInfo as Record<string, unknown>, engines);
    if (typeof merged.url !== 'string' || merged.disabled) continue;
    const entry = coerceEntry(name, merged);
    // Drop entries whose engine placeholders could not be resolved — probing a
    // literal like "{urlMain}/u/x/summary" yields a bogus host, not a real check.
    if (/\{urlMain\}|\{urlSubpath\}/.test(entry.url) || /\{urlMain\}|\{urlSubpath\}/.test(entry.urlProbe)) continue;
    out.push(entry);
  }
  return out;
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
