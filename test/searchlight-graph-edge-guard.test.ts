// @vitest-environment jsdom
/**
 * addGraphEdge defense-in-depth: an edge whose source or target node isn't present must be
 * dropped, never appended. Guards the dangling-edge failure mode a stale `connecting` id could
 * otherwise reach (e.g. a connect started before a Clear-Graph wipe) — the graph reset resets
 * the panel's `connecting` state, but the store must not corrupt regardless of the caller.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchlightStore } from '../src/renderer/modules/searchlight/store';
import type { SearchlightCase } from '@shared/searchlight/types';

const mkCase = (id: string): SearchlightCase => ({
  id,
  name: id,
  description: '',
  createdAt: 1,
  updatedAt: 2,
  searches: [],
  graphNodes: [
    { id: 'n1', label: 'a', type: 'username', x: 0, y: 0 },
    { id: 'n2', label: 'b', type: 'username', x: 10, y: 10 },
  ],
  graphEdges: [],
  whiteboardFiles: [],
  whiteboardNotes: [],
  notes: '',
  tags: [],
});

const edges = (caseId: string) =>
  useSearchlightStore.getState().cases.find((c) => c.id === caseId)!.graphEdges;

describe('store.addGraphEdge endpoint guard', () => {
  beforeEach(() => {
    useSearchlightStore.setState({ cases: [mkCase('a')], activeCaseId: 'a' });
    (window as unknown as { api: unknown }).api = { searchlight: { saveCase: () => {} } };
  });

  it('adds an edge when BOTH endpoints exist', () => {
    useSearchlightStore.getState().addGraphEdge('a', { id: 'e1', source: 'n1', target: 'n2' });
    expect(edges('a').map((e) => e.id)).toEqual(['e1']);
  });

  it('DROPS an edge whose source node is missing (no dangling edge)', () => {
    useSearchlightStore.getState().addGraphEdge('a', { id: 'e2', source: 'ghost', target: 'n2' });
    expect(edges('a')).toEqual([]);
  });

  it('DROPS an edge whose target node is missing', () => {
    useSearchlightStore.getState().addGraphEdge('a', { id: 'e3', source: 'n1', target: 'ghost' });
    expect(edges('a')).toEqual([]);
  });
});
