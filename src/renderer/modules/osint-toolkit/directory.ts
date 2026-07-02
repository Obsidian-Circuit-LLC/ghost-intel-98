import type { ModuleDescriptor } from '../../state/registry';

export interface OsintTool {
  key: string;
  title: string;
  glyph: string;
}

export interface OsintGroup {
  subcategory: string;
  tools: OsintTool[];
}

/** Fixed subcategory ordering; any subcategory not listed here is sorted alphabetically
 *  after these, with 'Other' always last. */
const SUBCATEGORY_PRIORITY = ['Social Media', 'Geospatial', 'Identity', 'Network / Recon'];

function subcategoryRank(subcategory: string): number {
  const idx = SUBCATEGORY_PRIORITY.indexOf(subcategory);
  return idx === -1 ? SUBCATEGORY_PRIORITY.length : idx;
}

function compareGroups(a: string, b: string): number {
  if (a === 'Other') return b === 'Other' ? 0 : 1;
  if (b === 'Other') return -1;
  const ra = subcategoryRank(a);
  const rb = subcategoryRank(b);
  if (ra !== rb) return ra - rb;
  // both unknown (rank === SUBCATEGORY_PRIORITY.length) — alphabetical
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareTools(a: OsintTool, b: OsintTool): number {
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

/** Pure grouping of registered modules into the OSINT Toolkit's category directory.
 *  Deterministic: identical input always produces identical output. */
export function buildOsintDirectory(mods: ModuleDescriptor[]): OsintGroup[] {
  const bySubcategory = new Map<string, OsintTool[]>();

  for (const m of mods) {
    if (m.category !== 'osint') continue;
    const subcategory = m.subcategory || 'Other';
    const tools = bySubcategory.get(subcategory) ?? [];
    tools.push({ key: m.key, title: m.title, glyph: m.glyph });
    bySubcategory.set(subcategory, tools);
  }

  return [...bySubcategory.entries()]
    .sort(([a], [b]) => compareGroups(a, b))
    .map(([subcategory, tools]) => ({
      subcategory,
      tools: [...tools].sort(compareTools),
    }));
}
