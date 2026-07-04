/**
 * Library sources — gathers the case-independent corpus (uploaded documents + briefcase notes +
 * journal entries) as a flat `Source[]` for the indexer to chunk/embed into the global library
 * shard. Pure aggregation: no embedding, no persistence — `indexer.ts`'s `reindexLibrary()` feeds
 * this straight into the same `reindexShard` every case/conversation reindex uses.
 *
 * `deps` is injectable so tests can substitute fake briefcase/journal/library stores without
 * touching real secure-fs (mirrors the rest of the memory substrate's dependency-injection pattern).
 */
import { createLibrary } from './store';
import * as briefcase from '../../../storage/briefcase';
import * as journal from '../../../storage/journal';
import type { ChunkKind } from '../chunker';

export interface Source { key: string; kind: ChunkKind; ref: string; text: string }

export interface LibrarySourcesDeps {
  library?: ReturnType<typeof createLibrary>;
  briefcaseList?: typeof briefcase.list;
  briefcaseRead?: typeof briefcase.read;
  journalList?: typeof journal.list;
  journalRead?: typeof journal.read;
}

export async function librarySources(deps: LibrarySourcesDeps = {}): Promise<Source[]> {
  const lib = deps.library ?? createLibrary();
  const briefcaseList = deps.briefcaseList ?? briefcase.list;
  const briefcaseRead = deps.briefcaseRead ?? briefcase.read;
  const journalList = deps.journalList ?? journal.list;
  const journalRead = deps.journalRead ?? journal.read;

  const sources: Source[] = [];

  for (const doc of await lib.list()) {
    const text = await lib.readText(doc.docId);
    if (text?.trim()) sources.push({ key: `doc:${doc.docId}`, kind: 'doc', ref: doc.title, text });
  }

  for (const summary of await briefcaseList()) {
    const note = await briefcaseRead(summary.id);
    if (note?.body?.trim()) sources.push({ key: `briefcase:${note.id}`, kind: 'doc', ref: note.name, text: note.body });
  }

  for (const summary of await journalList()) {
    const entry = await journalRead(summary.id);
    if (entry?.body?.trim()) sources.push({ key: `journal:${entry.id}`, kind: 'doc', ref: entry.title, text: entry.body });
  }

  return sources;
}
