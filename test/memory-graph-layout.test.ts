// test/memory-graph-layout.test.ts
import { describe, it, expect } from 'vitest';
import { layout } from '../src/main/services/memory/graph/layout';
import type { GraphNode } from '../src/main/services/memory/graph/model';
const n = (id: string, v: number[]): GraphNode => ({ id, kind: 'doc', label: id, strength: 1, pinned: false, conflict: false, vector: v, x: 0, y: 0, cluster: 0 });
describe('deterministic layout', () => {
  it('same input → identical positions (no RNG)', () => {
    const input = () => [n('a', [1, 0]), n('b', [0.9, 0.1]), n('c', [0, 1]), n('d', [0.1, 0.9])];
    const a = layout(input(), { clusters: 2 });
    const b = layout(input(), { clusters: 2 });
    expect(a.map((x) => [x.id, x.x, x.y, x.cluster])).toEqual(b.map((x) => [x.id, x.x, x.y, x.cluster]));
    expect(a.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))).toBe(true);
  });
});
