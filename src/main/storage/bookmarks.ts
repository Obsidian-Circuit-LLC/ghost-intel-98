/**
 * Net Explorer bookmarks — saved URL list. Dedicated file, mutex-protected.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataRoot } from './paths';
import { withLock } from '../util/mutex';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  addedAt: string;
}

function file(): string {
  return join(dataRoot(), 'bookmarks.json');
}

async function readAll(): Promise<Bookmark[]> {
  try {
    const buf = await readFile(file(), 'utf8');
    return JSON.parse(buf) as Bookmark[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(list: Bookmark[]): Promise<void> {
  await mkdir(dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await rename(tmp, file());
}

export async function list(): Promise<Bookmark[]> {
  return withLock('bookmarks', () => readAll());
}

export async function add(title: string, url: string): Promise<Bookmark> {
  return withLock('bookmarks', async () => {
    const all = await readAll();
    const bm: Bookmark = { id: `bm-${randomUUID()}`, title, url, addedAt: new Date().toISOString() };
    all.push(bm);
    await writeAll(all);
    return bm;
  });
}

export async function remove(id: string): Promise<void> {
  return withLock('bookmarks', async () => {
    const all = await readAll();
    await writeAll(all.filter((b) => b.id !== id));
  });
}
