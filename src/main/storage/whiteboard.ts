/**
 * Per-case whiteboard/canvas board, stored as caseDir/whiteboard.json. Image/file nodes
 * reference case attachments by fileName (no embedded bytes), so the board stays a small
 * graph that rides along in per-case export, backup, and (later) the at-rest encryption layer.
 */
import type { Whiteboard } from '@shared/types';
import { join } from 'node:path';
import { caseDir } from './paths';
import { withLock } from '../util/mutex';
import { secureReadText, secureWriteFile } from './secure-fs';

function boardFile(caseId: string): string { return join(caseDir(caseId), 'whiteboard.json'); }

export async function read(caseId: string): Promise<Whiteboard> {
  try {
    return JSON.parse(await secureReadText(boardFile(caseId))) as Whiteboard;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], edges: [] };
    throw err;
  }
}

export async function write(caseId: string, board: Whiteboard): Promise<void> {
  return withLock(`whiteboard:${caseId}`, async () => {
    await secureWriteFile(boardFile(caseId), JSON.stringify(board, null, 2));
  });
}
