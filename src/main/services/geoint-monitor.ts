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

export function _resetForTest(): void { cache = null; }
