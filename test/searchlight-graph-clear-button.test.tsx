// @vitest-environment jsdom
/**
 * T2: GraphView "Clear Graph" toolbar button — confirm-gated, per-case, with local reset.
 *
 * The button wipes ONE case's relationship graph via store.clearGraph(activeCaseId), but only
 * after an EXPLICIT confirm(); on confirm it must ALSO reset the panel's LOCAL view state
 * (selected / connecting / editingNote / showAddMenu) so no id survives referencing a
 * now-deleted node (searchlight-panel-unmount-state memory). Cancelling must be a no-op. With
 * zero nodes the button is disabled.
 *
 * store.clearGraph is overridden with a spy (via setState) so the test observes the *call* +
 * the local-state reset independently of the real mutator (covered by
 * searchlight-store-clear-graph.test.ts). Because the spy doesn't actually empty the graph, the
 * only reason the NODE PROPERTIES panel (which renders iff `selected` points at a node)
 * disappears after Clear is the local setSelected(null) — exactly the reset under test.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act() against a
 * jsdom container, mirroring newsview-standalone.test.tsx. Native click events are dispatched on
 * the SVG node <g> (React 18 root delegation picks them up).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GraphView } from '../src/renderer/modules/searchlight/panels/GraphView';
import { useSearchlightStore } from '../src/renderer/modules/searchlight/store';
import type { SearchlightCase } from '@shared/searchlight/types';

const clearGraph = vi.fn();

const mkCase = (id: string, name: string, withNodes: boolean): SearchlightCase => ({
  id,
  name,
  description: '',
  createdAt: 1,
  updatedAt: 2,
  searches: [],
  graphNodes: withNodes
    ? [
        { id: `${id}-n1`, label: 'alpha', type: 'username', x: 0, y: 0 },
        { id: `${id}-n2`, label: 'bravo', type: 'username', x: 100, y: 100 },
      ]
    : [],
  graphEdges: [],
  whiteboardFiles: [],
  whiteboardNotes: [],
  notes: '',
  tags: [],
});

let container: HTMLDivElement;
let root: Root;

const buttons = () => Array.from(container.querySelectorAll('button'));
const clearBtn = () =>
  buttons().find((b) => (b.textContent ?? '').includes('CLEAR GRAPH')) as
    | HTMLButtonElement
    | undefined;
// Node <g> for the node at (0,0); the outer wrapper <g> carries a "…scale(1)" suffix so an exact
// "translate(0,0)" match is unique to the node group.
const firstNodeGroup = () =>
  Array.from(container.querySelectorAll('g')).find(
    (g) => g.getAttribute('transform') === 'translate(0,0)',
  );

const selectFirstNode = () => {
  const g = firstNodeGroup();
  if (!g) throw new Error('node group not found');
  act(() => {
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  clearGraph.mockReset();
  // Favicon/save never fire for username-only nodes with clearGraph spied, but stub defensively.
  (window as unknown as { api: unknown }).api = {
    searchlight: { favicon: vi.fn(async () => null), saveCase: vi.fn() },
    system: { openExternal: vi.fn() },
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (withNodes: boolean) => {
  useSearchlightStore.setState({
    cases: [mkCase('a', 'Alpha', withNodes), mkCase('b', 'Bravo', true)],
    activeCaseId: 'a',
    selectedJobId: 'job-keep',
    clearGraph,
  });
  act(() => root.render(<GraphView />));
};

describe('GraphView — Clear Graph button', () => {
  it('confirming calls clearGraph(activeCaseId) and resets local selection', () => {
    mount(true);
    selectFirstNode();
    // Selecting a node opens the NODE PROPERTIES panel (renders iff `selected` is set).
    expect(container.textContent ?? '').toContain('NODE PROPERTIES');

    vi.stubGlobal('confirm', vi.fn(() => true));
    act(() => {
      clearBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(clearGraph).toHaveBeenCalledTimes(1);
    expect(clearGraph).toHaveBeenCalledWith('a');
    // Local selection reset ⇒ properties panel gone even though the spy left nodes in place.
    expect(container.textContent ?? '').not.toContain('NODE PROPERTIES');
    // Sweep panel pointer untouched.
    expect(useSearchlightStore.getState().selectedJobId).toBe('job-keep');
  });

  it('confirming closes the ADD ENTITY menu (showAddMenu reset)', () => {
    mount(true);
    const addBtn = buttons().find((b) => (b.textContent ?? '').includes('ADD ENTITY'));
    act(() => { addBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // Menu open — independent of `selected`, so its disappearance isolates the showAddMenu reset.
    expect(container.querySelector('.sl-graph-add-menu')).toBeTruthy();

    vi.stubGlobal('confirm', vi.fn(() => true));
    act(() => { clearBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(clearGraph).toHaveBeenCalledWith('a');
    expect(container.querySelector('.sl-graph-add-menu')).toBeNull();
  });

  it('confirming exits connect-mode so the next node click SELECTS (not connects)', () => {
    mount(true);
    selectFirstNode(); // selects node a-n1
    // Enter connect mode via the CONNECT button in NODE PROPERTIES.
    const connectBtn = buttons().find((b) => (b.textContent ?? '').includes('CONNECT'));
    act(() => { connectBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    vi.stubGlobal('confirm', vi.fn(() => true));
    act(() => { clearBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    // clearGraph is spied (nodes remain), so node a-n2 is still clickable. If `connecting` were
    // NOT reset, clicking it would create an edge (and not select); because it WAS reset, the
    // click selects the node → NODE PROPERTIES reappears. This isolates the connecting reset.
    const node2 = Array.from(container.querySelectorAll('g')).find(
      (g) => g.getAttribute('transform') === 'translate(100,100)',
    );
    act(() => { node2!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent ?? '').toContain('NODE PROPERTIES');
  });

  it('cancelling the confirm is a no-op (no clear, selection retained)', () => {
    mount(true);
    selectFirstNode();
    expect(container.textContent ?? '').toContain('NODE PROPERTIES');

    vi.stubGlobal('confirm', vi.fn(() => false));
    act(() => {
      clearBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(clearGraph).not.toHaveBeenCalled();
    expect(container.textContent ?? '').toContain('NODE PROPERTIES');
  });

  it('is disabled when the graph has zero nodes', () => {
    mount(false);
    const btn = clearBtn();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
  });
});
