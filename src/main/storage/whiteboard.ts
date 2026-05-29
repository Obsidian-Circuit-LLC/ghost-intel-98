/**
 * Per-case whiteboard/canvas board, stored as caseDir/whiteboard.json. Image/file nodes
 * reference case attachments by fileName (no embedded bytes), so the board stays a small
 * graph that rides along in per-case export, backup, and (later) the at-rest encryption layer.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Whiteboard } from '@shared/types';
import { caseDir } from './paths';
import { withLock } from '../util/mutex';

function boardFile(caseId: string): string { return join(caseDir(caseId), 'whiteboard.json'); }

export async function read(caseId: string): Promise<Whiteboard> {
  try {
    return JSON.parse(await readFile(boardFile(caseId), 'utf8')) as Whiteboard;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], edges: [] };
    throw err;
  }
}

export async function write(caseId: string, board: Whiteboard): Promise<void> {
  return withLock(`whiteboard:${caseId}`, async () => {
    const f = boardFile(caseId);
    await mkdir(dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(tmp, JSON.stringify(board, null, 2), 'utf8');
    await rename(tmp, f);
  });
}
