import { describe, it, expect } from 'vitest';
import { ensureWhiteboard } from '../src/main/security/validate';

describe('ensureWhiteboard: name field', () => {
  it('keeps a bounded node name + hex color and clamps size', () => {
    const wb = ensureWhiteboard({ nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, w: 99999, h: 5, name: 'x'.repeat(500), color: '#ff8800' }], edges: [] });
    expect(wb.nodes[0].name).toHaveLength(120);
    expect(wb.nodes[0].color).toBe('#ff8800');
    expect(wb.nodes[0].w).toBe(4000);   // clamped max
    expect(wb.nodes[0].h).toBe(30);     // clamped min
  });
});
