import { describe, it, expect } from 'vitest';
import { ensureWhiteboard } from '../src/main/security/validate';

describe('ensureWhiteboard', () => {
  it('keeps valid nodes/edges and clamps node sizes', () => {
    const b = ensureWhiteboard({
      nodes: [
        { id: 'a', type: 'text', x: 10, y: 20, w: 5, h: 5, text: 'hi' },
        { id: 'b', type: 'link', x: 0, y: 0, w: 9999, h: 50, url: 'https://x' }
      ],
      edges: [{ id: 'e', from: 'a', to: 'b' }]
    });
    expect(b.nodes).toHaveLength(2);
    expect(b.nodes[0].w).toBeGreaterThanOrEqual(40); // clamped to min
    expect(b.nodes[1].w).toBeLessThanOrEqual(4000);  // clamped to max
    expect(b.edges).toHaveLength(1);
  });

  it('drops bad node types, traversal fileNames, and dangling edges', () => {
    const b = ensureWhiteboard({
      nodes: [
        { id: 'a', type: 'evil', x: 0, y: 0, w: 50, h: 50 },
        { id: 'img', type: 'image', x: 0, y: 0, w: 50, h: 50, fileName: '../escape' }
      ],
      edges: [{ id: 'e', from: 'a', to: 'missing' }]
    });
    expect(b.nodes.find((n) => n.id === 'a')).toBeUndefined();   // invalid type
    expect(b.nodes.find((n) => n.id === 'img')).toBeUndefined(); // traversal fileName → node dropped
    expect(b.edges).toHaveLength(0);                              // dangling edge dropped
  });

  it('caps absurd node counts', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, type: 'text', x: 0, y: 0, w: 50, h: 50 }));
    expect(ensureWhiteboard({ nodes, edges: [] }).nodes.length).toBeLessThanOrEqual(2000);
  });
});
