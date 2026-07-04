import { describe, it, expect } from 'vitest';
import { toSvgScene } from '../src/renderer/modules/minds-eye/svg-graph';

describe('svg scene', () => {
  it('maps nodes into the viewBox and never returns NaN', () => {
    const scene = toSvgScene({ nodes: [
      { id: 'a', kind: 'doc', label: 'a', strength: 1, pinned: false, conflict: false, vector: [], x: -50, y: 200, cluster: 0 }
    ], edges: [] }, { w: 720, h: 500 });
    const c = scene.nodes[0];
    expect(c.cx).toBeGreaterThanOrEqual(0); expect(c.cx).toBeLessThanOrEqual(720);
    expect(Number.isFinite(c.cy)).toBe(true);
  });
});
