import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { app } from 'electron';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { parseMaigretData, validateImportedSites, toCatalog } from '@shared/searchlight/sites';
import type { MaigretSiteEntry, SiteCatalogEntry } from '@shared/searchlight/types';

let bundledCache: MaigretSiteEntry[] | null = null;
let customCache: MaigretSiteEntry[] | null = null;
let faviconCache: Record<string, string> | null = null;

/** resources/searchlight/maigret_sites.json — under resourcesPath when packaged, repo root in dev. */
function bundledPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, app.isPackaged ? 'searchlight' : 'resources/searchlight', 'maigret_sites.json');
}

export function loadBundled(readJson?: () => unknown): MaigretSiteEntry[] {
  // injection form (tests) caches too, so fullSites() reflects the injected bundled set
  if (readJson) { bundledCache = parseMaigretData(readJson()); return bundledCache; }
  if (!bundledCache) {
    try { bundledCache = parseMaigretData(JSON.parse(readFileSync(bundledPath(), 'utf8'))); }
    catch { bundledCache = []; }
  }
  return bundledCache;
}

export function customSitesFile(): string { return join(app.getPath('userData'), 'searchlight', 'custom-sites.json'); }

async function loadCustom(): Promise<MaigretSiteEntry[]> {
  if (customCache) return customCache;
  try { customCache = parseMaigretData(JSON.parse(await secureReadFile(customSitesFile()).then((b) => b.toString('utf8')))); }
  catch { customCache = []; }
  return customCache;
}

export async function fullSites(): Promise<MaigretSiteEntry[]> {
  const byName = new Map<string, MaigretSiteEntry>();
  for (const s of loadBundled()) byName.set(s.name, s);
  for (const s of await loadCustom()) byName.set(s.name, s); // custom overrides
  return [...byName.values()];
}

export async function catalog(): Promise<SiteCatalogEntry[]> { return toCatalog(await fullSites()); }

export async function sitesByName(names: string[]): Promise<MaigretSiteEntry[]> {
  const want = new Set(names);
  return (await fullSites()).filter((s) => want.has(s.name));
}

export async function importCustomSites(rawJsonText: string): Promise<{ added: number; rejected: number }> {
  let parsed: unknown; try { parsed = JSON.parse(rawJsonText); } catch { return { added: 0, rejected: 0 }; }
  const { sites, rejected } = validateImportedSites(parsed);
  const existing = await loadCustom();
  const byName = new Map(existing.map((s) => [s.name, s]));
  for (const s of sites) byName.set(s.name, s);
  const merged = [...byName.values()];
  customCache = merged;
  const asObj: Record<string, unknown> = {};
  for (const s of merged) asObj[s.name] = s;
  await secureWriteFile(customSitesFile(), JSON.stringify(asObj));
  return { added: sites.length, rejected };
}

export async function addCustomSite(input: { name: string; url: string; category?: string }): Promise<{ ok: boolean; reason?: string }> {
  const name = String(input?.name ?? '').trim();
  const url = String(input?.url ?? '').trim();
  if (!name) return { ok: false, reason: 'Name is required' };
  if (!/^https:\/\//i.test(url) || !url.includes('{username}')) {
    return { ok: false, reason: 'URL must start with https:// and contain {username}' };
  }
  const entry: Record<string, unknown> = { url, urlMain: (() => { try { return new URL(url).origin; } catch { return ''; } })() };
  if (input.category) entry.tags = [String(input.category)];
  const { sites } = validateImportedSites({ [name]: entry });
  if (sites.length === 0) return { ok: false, reason: 'Invalid site definition' };
  const existing = await loadCustom();
  const byName = new Map(existing.map((s) => [s.name, s]));
  byName.set(sites[0].name, sites[0]);
  const merged = [...byName.values()];
  customCache = merged;
  const asObj: Record<string, unknown> = {};
  for (const s of merged) asObj[s.name] = s;
  await secureWriteFile(customSitesFile(), JSON.stringify(asObj));
  return { ok: true };
}

export async function exportCustomSitesJson(): Promise<string> {
  const custom = await loadCustom();
  const asObj: Record<string, unknown> = {};
  for (const s of custom) asObj[s.name] = s;
  return JSON.stringify({ sites: asObj }, null, 2);
}

function faviconsPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, app.isPackaged ? 'searchlight' : 'resources/searchlight', 'favicons.json');
}

export function loadFavicons(readJson?: () => unknown): Record<string, string> {
  if (readJson) {
    try { faviconCache = sanitizeFavicons(readJson()); }
    catch { faviconCache = {}; }
    return faviconCache;
  }
  if (!faviconCache) {
    try { faviconCache = sanitizeFavicons(JSON.parse(readFileSync(faviconsPath(), 'utf8'))); }
    catch { faviconCache = {}; }
  }
  return faviconCache;
}

function sanitizeFavicons(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof val === 'string' && val.startsWith('data:image/')) out[name] = val;
    }
  }
  return out;
}

export function faviconFor(siteName: string): string | null {
  return loadFavicons()[siteName] ?? null;
}

export function _resetForTest(): void { bundledCache = null; customCache = null; faviconCache = null; }
