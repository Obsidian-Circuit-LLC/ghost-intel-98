/**
 * Retriever — embeds a query and returns the most relevant chunks across the case shards and the
 * conversation shard, with provenance. Deterministic ordering (score desc, id asc). Used by the AI
 * assistant to ground answers in the user's own corpus, and exposed for a semantic search blend.
 */
import { embed } from './embeddings';
import { caseShardPath, cosine, loadAllShards, loadShard, type MemoryShard } from './store';
import { snippetOf, type ChunkKind } from './chunker';
import { createBonds } from './bonds';

export interface RecallHit {
  caseId: string;
  caseTitle: string;
  kind: ChunkKind;
  ref: string;
  text: string;   // full chunk (for RAG context)
  snippet: string; // short preview (for display)
  score: number;
  sourceKey?: string; // present for real chunk hits; lets nodeIdOf align with graph node ids
  viaBond?: boolean;  // true when this hit's score was boosted by a user-drawn bond
}

export interface RecallOptions { k?: number; caseId?: string; minScore?: number }

async function shardsFor(caseId?: string): Promise<MemoryShard[]> {
  if (caseId) { const s = await loadShard(caseShardPath(caseId)); return s ? [s] : []; }
  return loadAllShards();
}

/** Node id for a recall hit — aligns with `graph/build.ts`'s `GraphNode.id` (`${caseId}:${sourceKey}`)
 *  when the hit carries a `sourceKey` (every real chunk does); falls back to `${kind}:${ref}` when it
 *  doesn't (e.g. hand-built hits in tests). */
export function nodeIdOf(hit: RecallHit): string {
  if (hit.sourceKey) return `${hit.caseId}:${hit.sourceKey}`;
  return `${hit.kind}:${hit.ref}`;
}

/**
 * Pure, deterministic bond-boost pass: any hit whose node is a one-hop neighbor (via `neighborsOf`)
 * of the top-scoring hit's node gets a fixed `boost` added to its score and is marked `viaBond`, then
 * the list is re-sorted with the same stable tie-break (`score desc, ref asc`). One hop only — no
 * transitive boosting through the neighbor's own neighbors.
 */
export function applyBondBoost(
  hits: RecallHit[],
  neighborsOf: (nodeId: string) => Set<string>,
  opts: { boost?: number } = {}
): RecallHit[] {
  if (hits.length === 0) return hits;
  const boost = opts.boost ?? 0.15;
  const byRank = [...hits].sort((a, b) => (b.score - a.score) || a.ref.localeCompare(b.ref));
  const topNodeId = nodeIdOf(byRank[0]);
  const neighbors = neighborsOf(topNodeId);
  const boosted = hits.map((h) => {
    const id = nodeIdOf(h);
    if (id !== topNodeId && neighbors.has(id)) return { ...h, score: h.score + boost, viaBond: true };
    return h;
  });
  boosted.sort((a, b) => (b.score - a.score) || a.ref.localeCompare(b.ref));
  return boosted;
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
      if (score >= minScore) scored.push({ caseId: sh.caseId, caseTitle: sh.title, kind: c.kind, ref: c.ref, text: c.text, snippet: snippetOf(c.text), score, sourceKey: c.sourceKey });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || a.ref.localeCompare(b.ref));

  // Bond boost is best-effort: a bond-store error (corrupt/locked file, IO failure) must never
  // break recall — fall through to the unboosted, sorted result.
  try {
    const bonds = await createBonds().list();
    if (bonds.length > 0) {
      const adjacency = new Map<string, Set<string>>();
      for (const bond of bonds) {
        if (!adjacency.has(bond.a)) adjacency.set(bond.a, new Set());
        if (!adjacency.has(bond.b)) adjacency.set(bond.b, new Set());
        adjacency.get(bond.a)!.add(bond.b);
        adjacency.get(bond.b)!.add(bond.a);
      }
      const neighborsOf = (id: string) => adjacency.get(id) ?? new Set<string>();
      const boosted = applyBondBoost(scored, neighborsOf);
      return boosted.slice(0, k);
    }
  } catch {
    // best-effort: fall through to unboosted result
  }

  return scored.slice(0, k);
}

/** Format recalled hits into a context block with provenance markers the model can cite. */
export function formatRecall(hits: RecallHit[]): string {
  if (hits.length === 0) return '';
  const blocks = hits.map((h) => `----- recalled from ${h.caseTitle} › ${h.kind}:${h.ref} -----\n${h.text}`);
  return `Relevant material retrieved from your local case memory (cite the source labels when you use it):\n\n${blocks.join('\n\n')}`;
}
