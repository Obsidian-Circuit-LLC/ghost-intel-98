import { describe, it, expect } from 'vitest';
import { diffScenes } from '../src/main/investigation/scene-diff';
import type { InvestigationScene } from '../src/shared/investigation-graph';

const N = (id: string, cluster = 0, score = 0.3) => ({ id, type: 'domain' as const, value: id, cluster, score, x: 0, y: 0 });
const scene = (nodes: ReturnType<typeof N>[], edges: InvestigationScene['edges'] = []): InvestigationScene => ({ nodes, edges });

describe('diffScenes', () => {
  it('detects an added node + edge', () => {
    const d = diffScenes(scene([N('a')]), scene([N('a'), N('b')], [{ source: 'a', target: 'b', relation: 'r', kind: 'relation' }]));
    expect(d.added.map((n) => n.id)).toEqual(['b']);
    expect(d.addedEdges).toHaveLength(1);
  });
  it('a changed score/cluster puts the node in updated', () => {
    const d = diffScenes(scene([N('a', 0, 0.3)]), scene([N('a', 1, 1)]));
    expect(d.updated.map((n) => n.id)).toEqual(['a']);
    expect(d.added).toHaveLength(0);
  });
  it('detects removals', () => {
    const d = diffScenes(scene([N('a'), N('b')], [{ source: 'a', target: 'b', relation: 'r', kind: 'relation' }]), scene([N('a')]));
    expect(d.removed).toEqual(['b']);
    expect(d.removedEdges).toHaveLength(1);
  });
  it('identical scenes → empty diff', () => {
    const d = diffScenes(scene([N('a')]), scene([N('a')]));
    expect(d).toEqual({ added: [], updated: [], removed: [], addedEdges: [], removedEdges: [] });
  });
});
