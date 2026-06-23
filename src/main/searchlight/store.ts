import { join } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';
import { app } from 'electron';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';
import type { SearchlightCase, SearchlightCaseSummary } from '@shared/searchlight/types';
import { sanitizeImportedCase } from '@shared/searchlight/import-sanitize';

function dir(): string { return join(app.getPath('userData'), 'searchlight', 'cases'); }
function caseFile(id: string): string { return join(dir(), `${encodeURIComponent(id)}.json`); }

async function readCase(id: string): Promise<SearchlightCase | null> {
  try { return JSON.parse((await secureReadFile(caseFile(id))).toString('utf8')) as SearchlightCase; }
  catch { return null; }
}

export async function listCases(): Promise<SearchlightCaseSummary[]> {
  let names: string[];
  try { names = await readdir(dir()); } catch { return []; }
  const out: SearchlightCaseSummary[] = [];
  for (const f of names.filter((n) => n.endsWith('.json'))) {
    const c = await readCase(decodeURIComponent(f.replace(/\.json$/, '')));
    if (c) out.push({ id: c.id, name: c.name, updatedAt: c.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadCase(id: string): Promise<SearchlightCase | null> { return readCase(id); }

export async function saveCase(c: SearchlightCase): Promise<void> {
  await secureWriteFile(caseFile(c.id), JSON.stringify(c));
}

export async function deleteCase(id: string): Promise<void> {
  try { await unlink(caseFile(id)); } catch { /* already gone */ }
}

export async function exportCase(id: string): Promise<string | null> {
  const c = await readCase(id);
  return c ? JSON.stringify(c, null, 2) : null;
}

export async function importCase(jsonText: string): Promise<SearchlightCase | null> {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { return null; }
  const c = sanitizeImportedCase(parsed);
  if (!c) return null;
  await saveCase(c);
  return c;
}

export function _resetForTest(): void { /* fs-backed; temp dir per run */ }
