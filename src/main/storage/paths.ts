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

/** WebSDR Viewer module data root. Its stores (directory/presets/notes/menu/egress/recordings)
 *  are module-global, not case-scoped — the viewer is a standalone built-in, not a scraping case.
 *  Everything under here routes through secure-fs (AES-GCM at rest), never plaintext beside the exe. */
export function websdrDir(): string {
  return join(dataRoot(), 'websdr');
}

/** The seeded receiver directory sidecar (`{ receivers, directorySeedVersion }`). */
export function websdrDirectoryFile(): string {
  return join(websdrDir(), 'directory.json');
}

/** Saved frequency presets sidecar. */
export function websdrPresetsFile(): string {
  return join(websdrDir(), 'presets.json');
}

/** Listening notes sidecar. */
export function websdrNotesFile(): string {
  return join(websdrDir(), 'notes.json');
}

/** Station Menu configuration sidecar. */
export function websdrMenuFile(): string {
  return join(websdrDir(), 'menu.json');
}

/** Egress-toggle state sidecar (clearnet/tor for the receiver session). */
export function websdrEgressFile(): string {
  return join(websdrDir(), 'egress.json');
}

/** Recording metadata sidecar (the archive index — the captured bytes live in `websdrRecordingsDir`). */
export function websdrRecordingsFile(): string {
  return join(websdrDir(), 'recordings.json');
}

/** Directory holding the encrypted captured-recording blobs (one per recording id). The actual
 *  capture/write lands in Phase 3; the path is the single source of truth for that seam. */
export function websdrRecordingsDir(): string {
  return join(websdrDir(), 'recordings');
}

/** One encrypted recording blob path, keyed by recording id. `id` must already be a validated
 *  WebSDR id (no separators/traversal — see the IPC boundary). */
export function websdrRecordingBlobFile(id: string): string {
  return join(websdrRecordingsDir(), `${id}.webm`);
}

export function settingsFile(): string {
  return join(dataRoot(), 'settings.json');
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
