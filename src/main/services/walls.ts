/** EyeSpy wall (video-wall board) storage. A wall holds CameraStream ids in fixed slots — no URLs,
 *  no network. Mirrors services/streams.ts. */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Wall } from '@shared/post-mvp-types';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';

function wallsFile(): string { return join(dataRoot(), 'walls.json'); }

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
  const slots = Array.from({ length: 9 }, (_, i) => (input.slots[i] ?? null));
  const idx = all.findIndex((w) => w.id === id);
  const wall: Wall = { id, name: input.name, slots, createdAt: input.createdAt ?? now, updatedAt: now };
  if (idx >= 0) all[idx] = wall; else all.push(wall);
  await writeAll(all);
  return wall;
}

export async function remove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((w) => w.id !== id));
}
