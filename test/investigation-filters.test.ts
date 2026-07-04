import { describe, it, expect } from 'vitest';
import { applyFilters } from '../src/renderer/modules/investigation-graph/filters';
import type { InvestigationScene, GraphFilters } from '../src/shared/investigation-graph';

const base: GraphFilters = { minScore: 0, search: '', type: 'all', cluster: 'all', hideUnconnected: false, showCooccurrence: true };
const scene: InvestigationScene = {
  nodes: [
    { id: 'a', type: 'domain', value: 'evil.tld', cluster: 0, score: 1, x: 0, y: 0 },
    { id: 'b', type: 'email', value: 'x@evil.tld', cluster: 0, score: 0.3, x: 0, y: 0 },
    { id: 'c', type: 'ip', value: '1.2.3.4', cluster: 1, score: 0.6, x: 0, y: 0 },
  ],
  edges: [{ source: 'a', target: 'b', relation: 'registrant-of', kind: 'relation' }],
};

describe('applyFilters', () => {
  it('minScore drops low nodes (and their now-dangling edges)', () => {
    const r = applyFilters(scene, { ...base, minScore: 0.5 });
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(r.edges).toHaveLength(0); // b filtered → its edge drops
  });
  it('type filter keeps only that type', () => {
    expect(applyFilters(scene, { ...base, type: 'ip' }).nodes.map((n) => n.id)).toEqual(['c']);
  });
  it('hideUnconnected drops isolated nodes', () => {
    expect(applyFilters(scene, { ...base, hideUnconnected: true }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('showCooccurrence:false hides co-occurrence edges only', () => {
    const s2: InvestigationScene = { ...scene, edges: [...scene.edges, { source: 'a', target: 'c', relation: 'co-occurs', kind: 'cooccurrence' }] };
    expect(applyFilters(s2, { ...base, showCooccurrence: false }).edges.every((e) => e.kind === 'relation')).toBe(true);
  });
  it('search matches value substring (case-insensitive)', () => {
    expect(applyFilters(scene, { ...base, search: 'EVIL' }).nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});
