/**
 * Net Explorer browsing history. Capped at 500 entries; oldest evicted.
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataRoot } from './paths';
import { withLock } from '../util/mutex';
import { secureReadText, secureWriteFile } from './secure-fs';

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
}

const CAP = 500;

function file(): string {
  return join(dataRoot(), 'browser-history.json');
}

async function readAll(): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(await secureReadText(file())) as HistoryEntry[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(list: HistoryEntry[]): Promise<void> {
  await secureWriteFile(file(), JSON.stringify(list, null, 2));
}

export async function list(limit = 100): Promise<HistoryEntry[]> {
  return withLock('history', async () => {
    const all = await readAll();
    return all.slice(0, limit);
  });
}

export async function add(url: string, title: string): Promise<void> {
  return withLock('history', async () => {
    const all = await readAll();
    all.unshift({ id: `h-${randomUUID()}`, url, title, visitedAt: new Date().toISOString() });
    if (all.length > CAP) all.length = CAP;
    await writeAll(all);
  });
}

export async function clear(): Promise<void> {
  return withLock('history', async () => writeAll([]));
}
