import { describe, it, expect } from 'vitest';
import { toSvgScene, declutterLabels, type RenderGraph } from '../src/renderer/components/graph-canvas/svg-scene';

describe('declutterLabels (fixes the Mind\'s Eye overlapping-label glitch)', () => {
  it('keeps labels that do not overlap', () => {
    const out = declutterLabels([
      { x: 0, y: 0, text: 'AAAA', r: 10 },
      { x: 500, y: 500, text: 'BBBB', r: 10 },
    ]);
    expect(out.map((l) => l.text).sort()).toEqual(['AAAA', 'BBBB']);
  });
  it('drops a colliding label, keeping the larger node\'s (priority by radius)', () => {
    const out = declutterLabels([
      { x: 100, y: 100, text: 'BIG-IMPORTANT-LABEL', r: 20 },
      { x: 102, y: 101, text: 'small', r: 4 }, // sits on top of the big one → dropped
    ]);
    expect(out.map((l) => l.text)).toEqual(['BIG-IMPORTANT-LABEL']);
  });
  it('is deterministic', () => {
    const items = [
      { x: 100, y: 100, text: 'x', r: 10 }, { x: 101, y: 100, text: 'y', r: 10 }, { x: 300, y: 300, text: 'z', r: 5 },
    ];
    expect(declutterLabels(items)).toEqual(declutterLabels(items));
  });
});

describe('toSvgScene applies declutter', () => {
  it('a dense cluster of coincident nodes yields FEWER labels than nodes (no more stacking)', () => {
    const g: RenderGraph = {
      nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, x: 0.5, y: 0.5, strength: 0.5, cls: 'c', label: `Label number ${i}` })),
      edges: [],
    };
    const scene = toSvgScene(g, { w: 600, h: 400 });
    expect(scene.nodes).toHaveLength(8);          // all nodes still drawn
    expect(scene.labels.length).toBeLessThan(8);  // overlapping labels decluttered
    expect(scene.labels.length).toBeGreaterThan(0);
  });
  it('well-separated nodes keep all their labels', () => {
    const g: RenderGraph = {
      nodes: [
        { id: 'a', x: 0, y: 0, strength: 1, cls: 'c', label: 'A' },
        { id: 'b', x: 1, y: 1, strength: 1, cls: 'c', label: 'B' },
      ],
      edges: [],
    };
    expect(toSvgScene(g, { w: 600, h: 400 }).labels).toHaveLength(2);
  });
});
