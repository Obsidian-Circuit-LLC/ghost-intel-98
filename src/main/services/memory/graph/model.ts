/**
 * Mind's Eye graph shapes — shared node/edge model consumed by build.ts (nodes), edges.ts
 * (auto-edges), layout.ts (x/y/cluster), and the graph/index.ts assembler. Kept dependency-free
 * (no imports) so renderer code can share the types without pulling in main-process modules.
 */

export type NodeKind = 'fact' | 'doc' | 'conversation' | 'entity';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  strength: number;
  pinned: boolean;
  conflict: boolean;
  vector: number[];
  x: number;
  y: number;
  cluster: number;
}

export type EdgeKind = 'auto' | 'bond';

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
}

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Actual conflicting-fact-id pairs from `merge.ts`'s `detectConflicts` (not just the
   *  per-node `conflict` boolean) — lets the "one thing to fix" tray surface a real pair
   *  instead of guessing from `conflict`-flagged node iteration order. */
  conflictPairs: [string, string][];
}
