/**
 * X Listening Station — campaigns (Task 5).
 *
 * Enterprise's "campaigns" (`electron/main.cjs` `campaigns:create/switch/update/delete`,
 * `appState.cases`) map here onto self-managed **x-namespace scraping cases**
 * (`scrapingCaseDir('x', id)`, `storage/scraping-cases.ts`) — NOT the app's core
 * investigation cases (`caseStore`). A campaign IS an x-namespace scraping-case id: the
 * SAME id every other x-listening module (`store.ts` Task 1, `session.ts` Task 3,
 * `capture.ts` Task 4) already scopes its per-campaign artifact sidecars by. This module
 * owns its own campaign list — no core `caseId` need ever be bound for X capture/collection
 * to work, which is what removes the case requirement.
 *
 * This file adds NO new persistence: it is a thin domain-named wrapper (validate/trim input,
 * delegate) over the generic `ScrapingCaseStore('x')` seam (Global Constraints: reuse, do not
 * reinvent). Deleting a campaign removes its ENTIRE `scrapingCaseDir('x', id)` recursively
 * (`ScrapingCaseStore.remove` → `rm(caseDir, {recursive:true})`), which already covers every
 * artifact sidecar this module writes today (items/posts/notes/networks/archiveState/
 * presets/entitiesCache) AND the per-campaign media directory Task 9 will add later — no
 * separate media-dir removal step is needed because everything a campaign ever persists
 * lives under that one directory.
 *
 * Quarantine-clean at module load: no static `electron` import — the production store wiring
 * is a LAZY dynamic `import('../storage/scraping-cases')` inside `defaultDeps()`, mirroring
 * `capture.ts`'s `defaultDeps()` convention, so importing this module in a test that injects
 * its own deps never evaluates electron.
 */
import type { ScrapingCase } from '@shared/types';

export type XCampaign = ScrapingCase;

/** Injectable seam — shape matches `ScrapingCaseStore` exactly (Reuse, don't reinvent): a
 *  test can hand in `makeScrapingCaseStore('x', memDeps)` directly as `overrides`. */
export interface XCampaignDeps {
  list(): Promise<ScrapingCase[]>;
  create(name: string): Promise<ScrapingCase>;
  read(id: string): Promise<ScrapingCase>;
  rename(id: string, name: string): Promise<ScrapingCase>;
  remove(id: string): Promise<void>;
}

function defaultDeps(): XCampaignDeps {
  return {
    list: async () => {
      const { prodScrapingCaseStore } = await import('../storage/scraping-cases');
      return (await prodScrapingCaseStore('x')).list();
    },
    create: async (name) => {
      const { prodScrapingCaseStore } = await import('../storage/scraping-cases');
      return (await prodScrapingCaseStore('x')).create(name);
    },
    read: async (id) => {
      const { prodScrapingCaseStore } = await import('../storage/scraping-cases');
      return (await prodScrapingCaseStore('x')).read(id);
    },
    rename: async (id, name) => {
      const { prodScrapingCaseStore } = await import('../storage/scraping-cases');
      return (await prodScrapingCaseStore('x')).rename(id, name);
    },
    remove: async (id) => {
      const { prodScrapingCaseStore } = await import('../storage/scraping-cases');
      return (await prodScrapingCaseStore('x')).remove(id);
    },
  };
}

/** Every campaign, stable order (createdAt asc, then id asc — `ScrapingCaseStore.list`). */
export async function listCampaigns(overrides: Partial<XCampaignDeps> = {}): Promise<XCampaign[]> {
  const deps: XCampaignDeps = { ...defaultDeps(), ...overrides };
  return deps.list();
}

/** Create a new campaign. Trims `name`; an empty/whitespace-only name is refused (mirrors
 *  Enterprise `campaigns:create`'s "Campaign name is required" guard). */
export async function createCampaign(
  name: string,
  overrides: Partial<XCampaignDeps> = {},
): Promise<XCampaign> {
  const deps: XCampaignDeps = { ...defaultDeps(), ...overrides };
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Campaign name is required.');
  return deps.create(trimmed);
}

/** Validate a campaign exists and hand it back. No main-side "active campaign" pointer is
 *  persisted here — the renderer (Task 13) owns which campaign is active via `spec.props`,
 *  mirroring the app's case-scoped module convention; this is purely the existence check the
 *  renderer's switch action needs (rejects with ENOENT on an unknown id, same as
 *  `ScrapingCaseStore.read`). */
export async function switchCampaign(
  id: string,
  overrides: Partial<XCampaignDeps> = {},
): Promise<XCampaign> {
  const deps: XCampaignDeps = { ...defaultDeps(), ...overrides };
  return deps.read(id);
}

/** Rename a campaign. Trims `name`; an empty/whitespace-only name is refused, same as create. */
export async function updateCampaign(
  id: string,
  name: string,
  overrides: Partial<XCampaignDeps> = {},
): Promise<XCampaign> {
  const deps: XCampaignDeps = { ...defaultDeps(), ...overrides };
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Campaign name is required.');
  return deps.rename(id, trimmed);
}

/** Delete a campaign — removes its entire on-disk directory recursively (see module header). */
export async function deleteCampaign(
  id: string,
  overrides: Partial<XCampaignDeps> = {},
): Promise<void> {
  const deps: XCampaignDeps = { ...defaultDeps(), ...overrides };
  return deps.remove(id);
}
