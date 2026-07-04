// test/memory-graph-edges.test.ts
import { describe, it, expect } from 'vitest';
import { autoEdges } from '../src/main/services/memory/graph/edges';
import type { GraphNode } from '../src/main/services/memory/graph/model';
const n = (id: string, v: number[]): GraphNode => ({ id, kind: 'doc', label: id, strength: 1, pinned: false, conflict: false, vector: v, x: 0, y: 0, cluster: 0 });
describe('auto edges', () => {
  it('links similar nodes, skips dissimilar and empty-vector nodes', () => {
    const e = autoEdges([n('a', [1, 0]), n('b', [1, 0]), n('c', [0, 1]), n('d', [])], { threshold: 0.9 });
    expect(e).toEqual([{ source: 'a', target: 'b', kind: 'auto', weight: 1 }]);
  });
});
