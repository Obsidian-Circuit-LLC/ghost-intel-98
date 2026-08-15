/**
 * All on-disk paths derive from app.getPath('userData') / GhostAccess98 /.
 * No path is hard-coded; no user home is hard-coded; the data root is *not*
 * runtime-overridable (no IPC surface, no test seam — keep it boring).
 */

import { app } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export function dataRoot(): string {
  return join(app.getPath('userData'), 'GhostAccess98');
}

export function casesDir(): string {
  return join(dataRoot(), 'cases');
}

export function caseDir(caseId: string): string {
  return join(casesDir(), caseId);
}

export function caseFile(caseId: string): string {
  return join(caseDir(caseId), 'case.json');
}

export function caseNotesDir(caseId: string): string {
  return join(caseDir(caseId), 'notes');
}

export function caseAttachmentsDir(caseId: string): string {
  return join(caseDir(caseId), 'attachments');
}

export function caseLinksFile(caseId: string): string {
  return join(caseDir(caseId), 'links.json');
}

export function caseTimelineFile(caseId: string): string {
  return join(caseDir(caseId), 'timeline.json');
}

export function caseTasksFile(caseId: string): string {
  return join(caseDir(caseId), 'tasks.json');
}

export function caseRemindersFile(caseId: string): string {
  return join(caseDir(caseId), 'reminders.json');
}

export function caseStreamsFile(caseId: string): string {
  return join(caseDir(caseId), 'streams.json');
}

/** Scraping-case namespaces. 'x' is the clearnet-quarantined X collector; 'socmint' is
 *  every other (Tor-eligible) social collector. Which store a scraping case lands in is a
 *  pure function of the case's namespace — never iteration order or a clock. */
export type ScrapingCaseNs = 'socmint' | 'x';

export function scrapingCasesRoot(): string {
  return join(dataRoot(), 'scraping-cases');
}

export function scrapingCaseDir(ns: ScrapingCaseNs, id: string): string {
  return join(scrapingCasesRoot(), ns, id);
}

export function scrapingCaseFile(ns: ScrapingCaseNs, id: string): string {
  return join(scrapingCaseDir(ns, id), 'case.json');
}

/** Items sidecar for a scraping case: `<scrapingCaseDir(ns,id)>/<ns>-items.json`.
 *  This is the SINGLE source of truth for the per-namespace items path — both the store
 *  reader (socmint/store.ts prod listItems/listXItems, reached via window.api.{socmint,x}.listItems)
 *  and the import writer (scraping-cases/import-to-case.ts) derive from here so the
 *  writer/reader seam cannot drift into a "written-but-never-read" mismatch. */
export function scrapingCaseItemsFile(ns: ScrapingCaseNs, id: string): string {
  return join(scrapingCaseDir(ns, id), `${ns}-items.json`);
}

/** Jobs sidecar for a scraping case: `<scrapingCaseDir(ns,id)>/<ns>-jobs.json`. Single source of
 *  truth for the per-namespace jobs path (see scrapingCaseItemsFile for the seam rationale). */
export function scrapingCaseJobsFile(ns: ScrapingCaseNs, id: string): string {
  return join(scrapingCaseDir(ns, id), `${ns}-jobs.json`);
}

/** Directory holding a scraping case's saved artifacts (e.g. a GhostScrape JSON export). */
export function scrapingCaseArtifactsDir(ns: ScrapingCaseNs, id: string): string {
  return join(scrapingCaseDir(ns, id), 'artifacts');
}

/** Path of one saved artifact inside a scraping case. `name` must already be a validated
 *  filename (no separators/traversal — see ensureFileName at the IPC boundary). */
export function scrapingCaseArtifactFile(ns: ScrapingCaseNs, id: string, name: string): string {
  return join(scrapingCaseArtifactsDir(ns, id), name);
}

/** Backup of pre-v3.27.0 scraping-case originals, written before the reversible migration
 *  removes them from the main case. Kept for recovery. */
export function scrapingBackupDir(): string {
  return join(scrapingCasesRoot(), 'backup-pre-v3.27.0');
}

export function settingsFile(): string {
  return join(dataRoot(), 'settings.json');
}

/** The Weather tool's single global store (saved locations + units pref + last-conditions cache),
 *  written/read through secure-fs (encrypt-at-rest — constraint 4). Not case-scoped. */
export function weatherStoreFile(): string {
  return join(dataRoot(), 'weather.json');
}

export function globalRemindersFile(): string {
  return join(dataRoot(), 'reminders.global.json');
}

export function shredDir(): string {
  return join(dataRoot(), 'shred');
}

export function secretsFile(): string {
  return join(dataRoot(), 'secrets.enc');
}

export async function ensureDataLayout(): Promise<void> {
  await mkdir(dataRoot(), { recursive: true });
  await mkdir(casesDir(), { recursive: true });
  await mkdir(shredDir(), { recursive: true });
}

export async function ensureCaseLayout(caseId: string): Promise<void> {
  await mkdir(caseDir(caseId), { recursive: true });
  await mkdir(caseNotesDir(caseId), { recursive: true });
  await mkdir(caseAttachmentsDir(caseId), { recursive: true });
}
