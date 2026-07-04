import { describe, it, expect } from 'vitest';
import { toSvgScene, type RenderGraph } from '../src/renderer/components/graph-canvas/svg-scene';

const g: RenderGraph = {
  nodes: [
    { id: 'a', x: 0, y: 0, strength: 0, cls: 'inv-node cluster-0', label: 'A' },
    { id: 'b', x: 10, y: 10, strength: 1, cls: 'inv-node cluster-1', label: 'B' },
  ],
  edges: [{ source: 'a', target: 'b', cls: 'edge-relation' }],
};

describe('toSvgScene (generic RenderGraph)', () => {
  it('carries node cls through and produces finite coordinates', () => {
    const s = toSvgScene(g, { w: 400, h: 300 });
    expect(s.nodes.map((n) => n.cls)).toEqual(['inv-node cluster-0', 'inv-node cluster-1']);
    expect(s.nodes.every((n) => Number.isFinite(n.cx) && Number.isFinite(n.cy) && Number.isFinite(n.r))).toBe(true);
    expect(s.edges[0].cls).toBe('edge-relation');
    expect(s.edges[0]).toMatchObject({ source: 'a', target: 'b' });
  });
  it('a single node collapses to center (no NaN)', () => {
    const s = toSvgScene({ nodes: [{ id: 'x', x: 5, y: 5, strength: 0.5, cls: 'c', label: 'X' }], edges: [] }, { w: 400, h: 300 });
    expect(s.nodes[0].cx).toBe(200);
    expect(s.nodes[0].cy).toBe(150);
  });
});
