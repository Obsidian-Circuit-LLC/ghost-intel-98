/**
 * Vector-memory facade — what the IPC layer talks to. Reindex builds the shards; recall queries
 * them; status summarizes the index for the Settings UI. Everything is offline (loopback embeddings)
 * and encrypted at rest (shards go through secure-fs).
 */
import { loadAllShards } from './store';
import { EMBED_MODEL } from './embeddings';

export { reindexAll, reindexCase, reindexConversations, reindexLibrary, type ReindexProgress } from './indexer';
export { recall, formatRecall, type RecallHit } from './retriever';
export { embedHealth } from './embed-runtime';
export { buildGraph } from './graph';

export interface MemoryStatus { model: string; cases: number; chunks: number }

/** Summarize the on-disk index (shard count + total embedded chunks). */
export async function status(): Promise<MemoryStatus> {
  const shards = await loadAllShards();
  let cases = 0, chunks = 0;
  for (const s of shards) {
    chunks += s.chunks.length;
    if (s.caseId !== '__conversations__' && s.caseId !== '__library__') cases += 1;
  }
  return { model: EMBED_MODEL, cases, chunks };
}
