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
