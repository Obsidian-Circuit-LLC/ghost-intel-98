/**
 * EyeSpy storage. URLs only — no discovery, no scanning, no brute-force code path exists.
 * Stream playback happens entirely in the renderer.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CameraStream } from '@shared/post-mvp-types';
import { dataRoot } from '../storage/paths';

function streamsFile(): string {
  return join(dataRoot(), 'streams.json');
}

async function readAll(): Promise<CameraStream[]> {
  try {
    const buf = await readFile(streamsFile(), 'utf8');
    return JSON.parse(buf) as CameraStream[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(list: CameraStream[]): Promise<void> {
  await mkdir(dirname(streamsFile()), { recursive: true });
  const tmp = `${streamsFile()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await rename(tmp, streamsFile());
}

export async function list(): Promise<CameraStream[]> {
  return readAll();
}

export async function upsert(input: Partial<CameraStream> & { url: string; label: string; kind: CameraStream['kind'] }): Promise<CameraStream> {
  const all = await readAll();
  const id = input.id || `cam-${randomUUID()}`;
  const cleaned: CameraStream = {
    id,
    label: input.label,
    url: input.url,
    kind: input.kind,
    caseId: input.caseId ?? null,
    notes: input.notes ?? '',
    addedAt: input.addedAt ?? new Date().toISOString()
  };
  const idx = all.findIndex((x) => x.id === id);
  if (idx >= 0) all[idx] = cleaned;
  else all.push(cleaned);
  await writeAll(all);
  return cleaned;
}

export async function remove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((x) => x.id !== id));
}
