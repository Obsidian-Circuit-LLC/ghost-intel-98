/**
 * Briefcase store — standalone text notes not tied to any case.
 *
 * Notepad 98 saves into a case when one is selected; pick "Briefcase" in its selector and it
 * saves here instead. The Briefcase module browses/edits these loose notes. Persisted under
 * dataRoot via secure-fs (encrypted at rest when login is on), like case data; zero network.
 *
 * One JSON file holding the array; writes are serialized (read-modify-write) so two windows
 * can't clobber each other, and validated at the IPC boundary via ensureBriefcaseNote.
 */

import { join } from 'node:path';
import { dataRoot } from './paths';
import { secureReadText, secureWriteFile } from './secure-fs';
import type { BriefcaseNote, BriefcaseNoteSummary, BriefcaseNoteInput } from '@shared/post-mvp-types';

const MAX_NOTES = 1000;
const briefcaseFile = (): string => join(dataRoot(), 'briefcase.json');

/** Newest-first by ISO updatedAt. Plain string comparison (not localeCompare) — the keys are
 *  ASCII ISO-8601, so this is locale-independent and deterministic across environments. */
function byUpdatedDesc(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

async function readAll(): Promise<BriefcaseNote[]> {
  try {
    const parsed = JSON.parse(await secureReadText(briefcaseFile())) as unknown;
    return Array.isArray(parsed) ? (parsed as BriefcaseNote[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}

async function writeAll(list: BriefcaseNote[]): Promise<void> {
  await secureWriteFile(briefcaseFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<BriefcaseNoteSummary[]> {
  const all = await readAll();
  return all
    .slice()
    .sort(byUpdatedDesc)
    .map((n) => ({ id: n.id, name: n.name, updatedAt: n.updatedAt, bytes: Buffer.byteLength(n.body ?? '', 'utf8') }));
}

export async function read(id: string): Promise<BriefcaseNote | null> {
  const all = await readAll();
  return all.find((n) => n.id === id) ?? null;
}

/** Upsert a note; the store owns createdAt (first save) and updatedAt (every save). */
export async function save(input: BriefcaseNoteInput): Promise<BriefcaseNote> {
  return serialize(async () => {
    const all = await readAll();
    const now = new Date().toISOString();
    const existing = all.find((n) => n.id === input.id);
    const record: BriefcaseNote = {
      id: input.id,
      name: input.name,
      body: input.body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const others = all.filter((n) => n.id !== input.id);
    const next = [record, ...others.sort(byUpdatedDesc)].slice(0, MAX_NOTES);
    await writeAll(next);
    return record;
  });
}

export async function remove(id: string): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    const next = all.filter((n) => n.id !== id);
    if (next.length !== all.length) await writeAll(next);
  });
}

export async function _resetForTest(): Promise<void> { await writeAll([]); }
