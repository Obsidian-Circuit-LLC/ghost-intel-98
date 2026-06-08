/**
 * Vector-memory facade — what the IPC layer talks to. Reindex builds the shards; recall queries
 * them; status summarizes the index for the Settings UI. Everything is offline (loopback embeddings)
 * and encrypted at rest (shards go through secure-fs).
 */
import { readdir } from 'node:fs/promises';
import { casesDir } from '../../storage/paths';
import { caseShardPath, conversationShardPath, loadShard } from './store';
import { EMBED_MODEL } from './embeddings';

export { reindexAll, reindexCase, reindexConversations, type ReindexProgress } from './indexer';
export { recall, formatRecall, type RecallHit } from './retriever';

export interface MemoryStatus { model: string; cases: number; chunks: number }

/** Summarize the on-disk index (shard count + total embedded chunks). */
export async function status(): Promise<MemoryStatus> {
  let ids: string[] = [];
  try { ids = await readdir(casesDir()); } catch { ids = []; }
  let cases = 0, chunks = 0;
  for (const id of ids) {
    const s = await loadShard(caseShardPath(id));
    if (s) { cases += 1; chunks += s.chunks.length; }
  }
  const cs = await loadShard(conversationShardPath());
  if (cs) chunks += cs.chunks.length;
  return { model: EMBED_MODEL, cases, chunks };
}
