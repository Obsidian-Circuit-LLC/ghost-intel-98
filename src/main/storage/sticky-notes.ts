/**
 * Sticky-notes store — the Win95-style desktop note layer.
 *
 * Persisted under dataRoot via secure-fs (vault-encrypted at rest when login is enabled), like
 * case data and the bookmarks board: what you pin to your desktop is OpSec-sensitive and must
 * not sit in plaintext. This module has ZERO network egress — notes never leave the machine.
 *
 * Whole-state read/write (the layer is small); the IPC boundary validates/clamps via
 * ensureStickyNotes before every write.
 */

import { join } from 'node:path';
import { dataRoot } from './paths';
import { secureReadText, secureWriteFile } from './secure-fs';
import type { StickyNotesState } from '@shared/post-mvp-types';

const EMPTY: StickyNotesState = { notes: [], hidden: false };
const notesFile = (): string => join(dataRoot(), 'sticky-notes.json');

export async function read(): Promise<StickyNotesState> {
  try {
    const parsed = JSON.parse(await secureReadText(notesFile())) as Partial<StickyNotesState>;
    return { notes: Array.isArray(parsed.notes) ? parsed.notes : [], hidden: parsed.hidden === true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    return { ...EMPTY };
  }
}

/** Persist the layer (already validated/clamped at the IPC boundary by ensureStickyNotes). */
export async function write(state: StickyNotesState): Promise<void> {
  await secureWriteFile(notesFile(), JSON.stringify(state, null, 2));
}

export async function _resetForTest(): Promise<void> { await write({ ...EMPTY }); }
