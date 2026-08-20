import { join } from 'node:path';
import { app } from 'electron';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';

let cache: string[] | null = null;
function file(): string { return join(app.getPath('userData'), 'geoint', 'monitors.json'); }

export async function loadPinned(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = JSON.parse((await secureReadFile(file())).toString('utf8'));
    cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { cache = []; }
  return cache;
}

export async function setPinned(ids: string[]): Promise<void> {
  const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string')));
  cache = clean;
  await secureWriteFile(file(), JSON.stringify(clean));
}

export async function addPinned(id: string): Promise<string[]> {
  const cur = await loadPinned();
  if (typeof id === 'string' && !cur.includes(id)) await setPinned([...cur, id]);
  return loadPinned();
}

export async function removePinned(id: string): Promise<string[]> {
  const cur = await loadPinned();
  await setPinned(cur.filter((x) => x !== id));
  return loadPinned();
}

/**
 * DISMISSED situations — a set kept separate from `pinned`.
 *
 * A row appears in Monitored Situations when it is corroborated OR pinned, so "remove from monitor"
 * could not be expressed by un-pinning alone: a corroborated row (the common case — every row in the
 * field report showed "×1") simply re-qualified and stayed, which is why the "×" looked dead.
 * Dismissal is therefore its own persisted fact: "stop showing me this", whatever qualified it.
 */
let dismissedCache: string[] | null = null;
function dismissedFile(): string { return join(app.getPath('userData'), 'geoint', 'dismissed.json'); }

export async function loadDismissed(): Promise<string[]> {
  if (dismissedCache) return dismissedCache;
  try {
    const raw = JSON.parse((await secureReadFile(dismissedFile())).toString('utf8'));
    dismissedCache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    dismissedCache = [];
  }
  return dismissedCache;
}

async function setDismissed(ids: string[]): Promise<void> {
  const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string')));
  dismissedCache = clean;
  await secureWriteFile(dismissedFile(), JSON.stringify(clean));
}

export async function dismissSituation(id: string): Promise<string[]> {
  const cur = await loadDismissed();
  if (typeof id === 'string' && id && !cur.includes(id)) await setDismissed([...cur, id]);
  return loadDismissed();
}

/** Undo a dismissal — a removed situation is hidden, never destroyed. */
export async function restoreSituation(id: string): Promise<string[]> {
  const cur = await loadDismissed();
  await setDismissed(cur.filter((x) => x !== id));
  return loadDismissed();
}

export function _resetForTest(): void { cache = null; dismissedCache = null; }
