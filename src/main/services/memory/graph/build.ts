/**
 * Pure graph node builder — turns already-loaded shards (library/conversation/case) and the
 * adaptive-memory profile into `GraphNode[]` for the Mind's Eye. x/y/cluster are left at 0 here;
 * layout.ts fills them in deterministically in a later pass. No I/O, no randomness: same shards +
 * profile in ⇒ same nodes out.
 *
 * Node derivation (v1):
 *  - one `doc` node per source whose chunks carry `kind: 'doc'` (library docs, briefcase, journal)
 *  - one `conversation` node per source whose chunks carry `kind: 'chat'`
 *  - one `entity` node per source whose chunks carry `kind: 'entity'`
 *  - other chunk kinds (`desc`, `note`, `file`) don't get a node in v1
 *  - one `fact` node per profile `MemoryItem` — facts have no embedding here (empty vector);
 *    similarity auto-edges (edges.ts) skip nodes with an empty vector.
 */
import type { MemoryShard, StoredChunk } from '../store';
import type { MemoryItem } from '../profile/types';
import type { GraphNode, NodeKind } from './model';
import { detectConflicts } from './merge';

export interface BuildInputs {
  shards: MemoryShard[];
  profile: MemoryItem[];
}

function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i] ?? 0;
  }
  return sum.map((s) => s / vectors.length);
}

function nodeKindForChunkKind(kind: StoredChunk['kind']): NodeKind | null {
  if (kind === 'doc') return 'doc';
  if (kind === 'chat') return 'conversation';
  if (kind === 'entity') return 'entity';
  return null;
}

export function buildNodes(input: BuildInputs): GraphNode[] {
  const nodes: GraphNode[] = [];

  for (const shard of input.shards) {
    const bySource = new Map<string, StoredChunk[]>();
    for (const chunk of shard.chunks) {
      const list = bySource.get(chunk.sourceKey);
      if (list) list.push(chunk);
      else bySource.set(chunk.sourceKey, [chunk]);
    }

    for (const [sourceKey, chunks] of bySource) {
      const kind = nodeKindForChunkKind(chunks[0].kind);
      if (!kind) continue;

      nodes.push({
        id: `${shard.caseId}:${sourceKey}`,
        kind,
        label: chunks[0].ref,
        strength: Math.min(1, chunks.length / 5),
        pinned: false,
        conflict: false,
        vector: meanVector(chunks.map((c) => c.vector)),
        x: 0,
        y: 0,
        cluster: 0
      });
    }
  }

  // A fact is flagged `conflict: true` when it's one half of an obvious contradiction (see
  // detectConflicts's v1 heuristic) — the Mind's Eye "one thing to fix" tray surfaces these one
  // pair at a time and offers Resolve (merge.ts's `mergeItems`) to collapse the pair.
  const conflictIds = new Set<string>();
  for (const [a, b] of detectConflicts(input.profile)) {
    conflictIds.add(a);
    conflictIds.add(b);
  }

  for (const item of input.profile) {
    nodes.push({
      id: item.id,
      kind: 'fact',
      label: item.text,
      strength: item.confidence,
      pinned: item.pinned,
      conflict: conflictIds.has(item.id),
      vector: [],
      x: 0,
      y: 0,
      cluster: 0
    });
  }

  return nodes;
}
