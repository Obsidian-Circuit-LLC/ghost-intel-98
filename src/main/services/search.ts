/**
 * Cross-case search: literal (non-regex) substring match over every case's metadata, entities,
 * tasks, links, reminders, note bodies, and extracted text-attachment contents. The per-record
 * field matching is a pure function (searchRecord) for testing; query() adds the file reads.
 */
import { readdir } from 'node:fs/promises';
import type { CaseRecord, SearchHit, SearchResult } from '@shared/types';
import { casesDir } from '../storage/paths';
import { caseStore, noteStore, fileStore } from '../storage/json-fs';

function snippet(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, 80);
  const start = Math.max(0, i - 30);
  const slice = text.slice(start, i + needle.length + 50).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}…`;
}

/** Pure: match a loaded record's in-memory fields against an already-lowercased needle. */
export function searchRecord(rec: CaseRecord, needle: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const add = (field: string, text: string): void => {
    if (text && text.toLowerCase().includes(needle)) hits.push({ field, snippet: snippet(text, needle), kind: 'case' });
  };
  add('title', rec.title);
  add('reference', rec.reference);
  add('description', rec.description);
  add('tags', rec.tags.join(', '));
  for (const t of rec.tasks) add('task', t.text);
  for (const l of rec.links) add('link', `${l.title} ${l.url}`);
  for (const r of rec.reminders) add('reminder', r.title);
  for (const e of rec.entities) add('entity', `${e.entity.value} ${e.entity.notes} ${e.entity.aliases.join(' ')}`);
  return hits;
}

export async function query(q: string): Promise<SearchResult[]> {
  const needle = q.toLowerCase();
  let ids: string[] = [];
  try { ids = await readdir(casesDir()); } catch { return []; }
  const out: SearchResult[] = [];
  for (const id of ids) {
    let rec: CaseRecord;
    try { rec = await caseStore.read(id); } catch { continue; }
    const hits = searchRecord(rec, needle);
    for (const n of rec.notes) {
      try {
        const body = await noteStore.read(id, n.name);
        if (body.toLowerCase().includes(needle)) hits.push({ field: `note:${n.name}`, snippet: snippet(body, needle), kind: 'note', noteName: n.name });
      } catch { /* skip unreadable note */ }
    }
    for (const a of rec.attachments) {
      try {
        const r = await fileStore.readAttachmentText(id, a.fileName);
        if (r.text && r.text.toLowerCase().includes(needle)) hits.push({ field: `file:${a.originalName}`, snippet: snippet(r.text, needle), kind: 'file', fileName: a.fileName, originalName: a.originalName });
      } catch { /* skip unreadable / binary attachment */ }
    }
    if (hits.length) out.push({ caseId: id, caseTitle: rec.title, hits });
  }
  return out;
}
