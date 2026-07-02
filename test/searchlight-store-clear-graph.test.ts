/**
 * Searchlight renderer store — clearGraph(caseId) action.
 *
 * clearGraph wipes ONE case's relationship graph (graphNodes + graphEdges → []),
 * advances that case's updatedAt, touches no other case, and schedules the same
 * debounced saveCase (window.api.searchlight.saveCase) every other graph mutator uses.
 *
 * Runs in the default node env; window.api.searchlight.saveCase is stubbed and the
 * 500ms debounce driven with fake timers (mirrors scheduleSave's persistence path).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSearchlightStore } from '../src/renderer/modules/searchlight/store';
import type { SearchlightCase } from '@shared/searchlight/types';

const saveCase = vi.fn();

const mkCase = (id: string, name: string): SearchlightCase => ({
  id,
  name,
  description: '',
  createdAt: 1,
  updatedAt: 2,
  searches: [],
  graphNodes: [
    { id: `${id}-n1`, label: 'a', type: 'username', x: 0, y: 0 },
    { id: `${id}-n2`, label: 'b', type: 'username', x: 10, y: 10 },
  ],
  graphEdges: [{ id: `${id}-e1`, source: `${id}-n1`, target: `${id}-n2` }],
  whiteboardFiles: [],
  whiteboardNotes: [],
  notes: '',
  tags: [],
});

describe('searchlight store — clearGraph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    saveCase.mockReset();
    vi.stubGlobal('window', { api: { searchlight: { saveCase } } });
    useSearchlightStore.setState({
      cases: [mkCase('a', 'Alpha'), mkCase('b', 'Bravo')],
      activeCaseId: 'a',
      selectedJobId: 'job-keep',
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('empties the target case graph, advances its updatedAt, and leaves other cases untouched', () => {
    useSearchlightStore.getState().clearGraph('a');
    const { cases } = useSearchlightStore.getState();
    const a = cases.find((c) => c.id === 'a')!;
    const b = cases.find((c) => c.id === 'b')!;

    expect(a.graphNodes).toEqual([]);
    expect(a.graphEdges).toEqual([]);
    expect(a.updatedAt).toBe(1_000_000);
    expect(a.updatedAt).toBeGreaterThan(2);

    // caseB is fully untouched (same reference, graph intact).
    expect(b.graphNodes).toHaveLength(2);
    expect(b.graphEdges).toHaveLength(1);
    expect(b.updatedAt).toBe(2);
  });

  it('does not disturb the Sweep panel selectedJobId', () => {
    useSearchlightStore.getState().clearGraph('a');
    expect(useSearchlightStore.getState().selectedJobId).toBe('job-keep');
  });

  it('schedules the debounced saveCase with the cleared case', () => {
    useSearchlightStore.getState().clearGraph('a');
    // Debounced — not called synchronously.
    expect(saveCase).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(saveCase).toHaveBeenCalledTimes(1);
    const saved = saveCase.mock.calls[0][0] as SearchlightCase;
    expect(saved.id).toBe('a');
    expect(saved.graphNodes).toEqual([]);
    expect(saved.graphEdges).toEqual([]);
  });

  it('is a no-op for an unknown case id (no save scheduled)', () => {
    useSearchlightStore.getState().clearGraph('does-not-exist');
    vi.advanceTimersByTime(500);
    expect(saveCase).not.toHaveBeenCalled();
  });
});
