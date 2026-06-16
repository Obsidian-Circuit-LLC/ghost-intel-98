/** EyeSpy wall (video-wall board) storage. A wall holds CameraStream ids in fixed slots — no URLs,
 *  no network. Mirrors services/streams.ts. */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Wall } from '@shared/post-mvp-types';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';

function wallsFile(): string { return join(dataRoot(), 'walls.json'); }

/** Upper bound on stored slots — the grid is variable-length (unlimited cameras), but a stored
 *  wall is still clamped so a hostile/buggy renderer can't write an unbounded array to disk. */
const MAX_SLOTS = 200;

/** Trimmed location category — omit empty fields (mirrors services/streams.ts pickGeo). */
function pickGeo(i: Partial<Wall>): Partial<Wall> {
  const g: Partial<Wall> = {};
  if (typeof i.country === 'string' && i.country.trim()) g.country = i.country.trim();
  if (typeof i.region === 'string' && i.region.trim()) g.region = i.region.trim();
  if (typeof i.city === 'string' && i.city.trim()) g.city = i.city.trim();
  return g;
}

async function readAll(): Promise<Wall[]> {
  try { return JSON.parse(await secureReadText(wallsFile())) as Wall[]; }
  catch (err) { const e = err as NodeJS.ErrnoException; if (e.code === 'ENOENT') return []; throw err; }
}
async function writeAll(list: Wall[]): Promise<void> {
  await secureWriteFile(wallsFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<Wall[]> { return readAll(); }
export async function get(id: string): Promise<Wall | null> {
  return (await readAll()).find((w) => w.id === id) ?? null;
}

export async function save(input: Partial<Wall> & { name: string; slots: (string | null)[] }): Promise<Wall> {
  const all = await readAll();
  const now = new Date().toISOString();
  const id = input.id || `wall-${randomUUID()}`;
  // Persist at the wall's ACTUAL length (variable-length scrollable grid — unlimited cameras),
  // clamped to a sane maximum so a hostile/buggy renderer can't bloat the store.
  const slots = input.slots.slice(0, MAX_SLOTS).map((s) => s ?? null);
  const idx = all.findIndex((w) => w.id === id);
  const wall: Wall = { id, name: input.name, slots, createdAt: input.createdAt ?? now, updatedAt: now, ...pickGeo(input) };
  if (idx >= 0) all[idx] = wall; else all.push(wall);
  await writeAll(all);
  return wall;
}

export async function remove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((w) => w.id !== id));
}
