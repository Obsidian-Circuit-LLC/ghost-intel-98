/**
 * Retriever — embeds a query and returns the most relevant chunks across the case shards and the
 * conversation shard, with provenance. Deterministic ordering (score desc, id asc). Used by the AI
 * assistant to ground answers in the user's own corpus, and exposed for a semantic search blend.
 */
import { readdir } from 'node:fs/promises';
import { casesDir } from '../../storage/paths';
import { embed } from './embeddings';
import { caseShardPath, conversationShardPath, cosine, loadShard, type MemoryShard } from './store';
import { snippetOf, type ChunkKind } from './chunker';

export interface RecallHit {
  caseId: string;
  caseTitle: string;
  kind: ChunkKind;
  ref: string;
  text: string;   // full chunk (for RAG context)
  snippet: string; // short preview (for display)
  score: number;
}

export interface RecallOptions { k?: number; caseId?: string; minScore?: number }

async function shardsFor(caseId?: string): Promise<MemoryShard[]> {
  if (caseId) { const s = await loadShard(caseShardPath(caseId)); return s ? [s] : []; }
  const shards: MemoryShard[] = [];
  let ids: string[] = [];
  try { ids = await readdir(casesDir()); } catch { ids = []; }
  for (const id of ids) { const s = await loadShard(caseShardPath(id)); if (s) shards.push(s); }
  const cs = await loadShard(conversationShardPath());
  if (cs) shards.push(cs);
  return shards;
}

export async function recall(query: string, opts: RecallOptions = {}): Promise<RecallHit[]> {
  const k = opts.k ?? 6;
  const minScore = opts.minScore ?? 0.2;
  if (!query.trim()) return [];
  const [qv] = await embed([query]);
  if (!qv) return [];
  const shards = await shardsFor(opts.caseId);
  const scored: RecallHit[] = [];
  for (const sh of shards) {
    for (const c of sh.chunks) {
      const score = cosine(c.vector, qv);
      if (score >= minScore) scored.push({ caseId: sh.caseId, caseTitle: sh.title, kind: c.kind, ref: c.ref, text: c.text, snippet: snippetOf(c.text), score });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || a.ref.localeCompare(b.ref));
  return scored.slice(0, k);
}

/** Format recalled hits into a context block with provenance markers the model can cite. */
export function formatRecall(hits: RecallHit[]): string {
  if (hits.length === 0) return '';
  const blocks = hits.map((h) => `----- recalled from ${h.caseTitle} › ${h.kind}:${h.ref} -----\n${h.text}`);
  return `Relevant material retrieved from your local case memory (cite the source labels when you use it):\n\n${blocks.join('\n\n')}`;
}
