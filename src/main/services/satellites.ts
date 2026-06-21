/** Satellite storage + the gated CelesTrak fetch + bundled-snapshot loader.
 *  User satellites persist exactly like streams.ts (secure-fs, dataRoot/satellites.json).
 *  CelesTrak is fetched ONLY when settings.geoint.networkEnabled is true (the GeoINT egress gate). */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { settingsStore } from '../storage/json-fs';

export type SatType = 'starlink' | 'gps' | 'weather' | 'comms' | 'earth-obs' | 'station' | 'scientific' | 'other';

export interface UserSat {
  id: string;
  name: string;
  noradId: number | null;
  line1: string;
  line2: string;
  type: SatType;
  source: 'user';
  tag?: string;
  notes?: string;
  active: boolean;
  addedAt: string;
}

function satsFile(): string { return join(dataRoot(), 'satellites.json'); }

async function readAll(): Promise<UserSat[]> {
  try { return JSON.parse(await secureReadText(satsFile())) as UserSat[]; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
}

async function writeAll(list: UserSat[]): Promise<void> {
  await secureWriteFile(satsFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<UserSat[]> { return readAll(); }

export async function upsert(
  input: Partial<UserSat> & { name: string; line1: string; line2: string; type: SatType; active: boolean }
): Promise<UserSat> {
  const all = await readAll();
  const id = input.id || `usat-${randomUUID()}`;
  const cleaned: UserSat = {
    id,
    name: input.name,
    noradId: input.noradId ?? null,
    line1: input.line1,
    line2: input.line2,
    type: input.type,
    source: 'user',
    tag: input.tag,
    notes: input.notes,
    active: input.active,
    addedAt: input.addedAt ?? new Date().toISOString()
  };
  const idx = all.findIndex((x) => x.id === id);
  if (idx >= 0) all[idx] = cleaned; else all.push(cleaned);
  await writeAll(all);
  return cleaned;
}

export async function remove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((x) => x.id !== id));
}

const CELESTRAK = (group: string): string =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;

const ALLOWED_GROUPS = new Set(['active', 'stations', 'starlink', 'gps-ops', 'weather', 'science']);

/** Fetch a CelesTrak group as raw 3-line TLE text. Returns '' when the GeoINT network gate is off
 *  (the charter egress gate) or the group is not allowlisted. Throws on HTTP/timeout (caller toasts). */
export async function fetchGroup(group: string): Promise<string> {
  if (!ALLOWED_GROUPS.has(group)) return '';
  const enabled = (await settingsStore.read()).geoint?.networkEnabled;
  if (!enabled) return '';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(CELESTRAK(group), { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

/** Load the build-time bundled offline snapshot (TLE text). Returns '' if absent. */
export async function snapshot(): Promise<string> {
  try {
    const p = join(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).resourcesPath ?? join(process.cwd(), 'resources'),
      'satellites',
      'active-snapshot.tle'
    );
    return await readFile(p, 'utf8');
  } catch { return ''; }
}
