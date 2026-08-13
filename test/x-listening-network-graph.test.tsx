// @vitest-environment jsdom
/**
 * Task C2 (part B) — the COMMON NETWORK MIND MAP (interactive graph).
 *
 * Covers the acceptance surface for `NetworkGraph.tsx`:
 *   1. given a seeded graph model, target + identity nodes and edges render;
 *   2. switching mode (ALL RELATIONSHIPS → COMMON FOLLOWERS) filters edges to that relationship;
 *   3. clicking a node opens the inspector (shows the node label);
 *   4. OPEN X PROFILE calls the `onOpenIdentity` prop with the @handle (E1 routes it to openInX);
 *   5. the layout is DETERMINISTIC — same model in → identical node positions out.
 *
 * Same createRoot + act discipline (no @testing-library) as the sibling Network-tab tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  NetworkGraph,
  computeGraphLayout,
  type NetworkGraphModel,
} from '../src/renderer/modules/x-listening/NetworkGraph';

// React 18 act() opt-in (silences the "environment not configured to support act" warning).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Two targets (alice, carol) + three common identities (each connected to >=2 targets). bob follows
// both targets; dave follows alice + is followed by carol; frank follows both. Edges carry mixed
// relationships so a mode filter has something to remove.
const GRAPH: NetworkGraphModel = {
  nodes: [
    { id: 'target:alice', type: 'target', label: '@alice', username: 'alice', profileId: 'alice', score: 100 },
    { id: 'target:carol', type: 'target', label: '@carol', username: 'carol', profileId: 'carol', score: 100 },
    { id: 'identity:bob', type: 'identity', label: '@bob', username: 'bob', score: 100, connectedTargets: 2 },
    { id: 'identity:dave', type: 'identity', label: '@dave', username: 'dave', score: 60, connectedTargets: 2 },
    { id: 'identity:frank', type: 'identity', label: '@frank', username: 'frank', score: 55, connectedTargets: 2 },
    // A single-target identity — must NOT appear (connectedTargets < 2).
    { id: 'identity:solo', type: 'identity', label: '@solo', username: 'solo', score: 20, connectedTargets: 1 },
  ],
  edges: [
    { id: 'e1', source: 'target:alice', target: 'identity:bob', relationship: 'follower' },
    { id: 'e2', source: 'target:carol', target: 'identity:bob', relationship: 'follower' },
    { id: 'e3', source: 'target:alice', target: 'identity:dave', relationship: 'follower' },
    { id: 'e4', source: 'target:carol', target: 'identity:dave', relationship: 'following' },
    { id: 'e5', source: 'target:alice', target: 'identity:frank', relationship: 'following' },
    { id: 'e6', source: 'target:carol', target: 'identity:frank', relationship: 'following' },
  ],
};

describe('X Listening Station — COMMON NETWORK MIND MAP (Task C2b)', () => {
  describe('computeGraphLayout (pure, deterministic)', () => {
    it('is deterministic: same model → identical positions', () => {
      const a = computeGraphLayout(GRAPH, 'all', 40);
      const b = computeGraphLayout(GRAPH, 'all', 40);
      expect(a.targets.map((t) => [t.node.id, t.x, t.y])).toEqual(
        b.targets.map((t) => [t.node.id, t.x, t.y]),
      );
      expect(a.identities.map((n) => [n.node.id, n.x, n.y])).toEqual(
        b.identities.map((n) => [n.node.id, n.x, n.y]),
      );
    });

    it('drops single-target identities and honours the visible cap', () => {
      const l = computeGraphLayout(GRAPH, 'all', 40);
      expect(l.targets.map((t) => t.node.id)).toEqual(['target:alice', 'target:carol']);
      // solo (connectedTargets 1) excluded; only the three >=2 identities remain.
      expect(l.identities.map((n) => n.node.id).sort()).toEqual([
        'identity:bob',
        'identity:dave',
        'identity:frank',
      ]);
    });

    it('mode filters edges by relationship', () => {
      expect(computeGraphLayout(GRAPH, 'all', 40).edges.length).toBe(6);
      expect(
        computeGraphLayout(GRAPH, 'follower', 40).edges.every((e) => e.relationship === 'follower'),
      ).toBe(true);
      expect(computeGraphLayout(GRAPH, 'follower', 40).edges.length).toBe(3);
      expect(
        computeGraphLayout(GRAPH, 'following', 40).edges.every(
          (e) => e.relationship === 'following',
        ),
      ).toBe(true);
    });

    it('empty / undersized graph yields no nodes (defensive)', () => {
      expect(computeGraphLayout({ nodes: [], edges: [] }, 'all', 40).identities.length).toBe(0);
      expect(computeGraphLayout(null, 'all', 40).targets.length).toBe(0);
    });
  });

  describe('<NetworkGraph /> (createRoot + act)', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });
    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
    });

    function render(onOpen: (u: string) => void) {
      act(() => {
        root.render(<NetworkGraph graph={GRAPH} onOpenIdentity={onOpen} />);
      });
    }

    it('renders target + identity nodes and edges from a seeded model', () => {
      render(() => {});
      expect(container.querySelector('svg.xls-network-graph')).toBeTruthy();
      expect(container.querySelectorAll('.xls-mind-node.target').length).toBe(2);
      expect(container.querySelectorAll('.xls-mind-node.identity').length).toBe(3);
      // 6 relationship edges in ALL mode.
      expect(container.querySelectorAll('path.xls-mind-edge').length).toBe(6);
      // The central COMMON NETWORK hub is present.
      expect(container.querySelector('.xls-mind-center')).toBeTruthy();
    });

    it('switching to COMMON FOLLOWERS filters edges to followers only', () => {
      render(() => {});
      const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        /^COMMON FOLLOWERS$/i.test((b.textContent || '').trim()),
      ) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      act(() => btn.click());
      // Only the 3 follower edges survive.
      expect(container.querySelectorAll('path.xls-mind-edge').length).toBe(3);
    });

    it('clicking a node opens the inspector with the node label + OPEN X PROFILE', () => {
      render(() => {});
      const node = Array.from(container.querySelectorAll('.xls-mind-node.identity')).find((g) =>
        /@bob/.test(g.textContent || ''),
      ) as SVGGElement;
      expect(node).toBeTruthy();
      act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const inspector = container.querySelector('.xls-graph-inspector');
      expect(inspector?.textContent).toMatch(/@bob/);
      expect(inspector?.textContent).toMatch(/OPEN X PROFILE/i);
    });

    it('OPEN X PROFILE calls onOpenIdentity with the @handle', () => {
      const onOpen = vi.fn();
      render(onOpen);
      const node = Array.from(container.querySelectorAll('.xls-mind-node.identity')).find((g) =>
        /@dave/.test(g.textContent || ''),
      ) as SVGGElement;
      act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const openBtn = Array.from(
        container.querySelectorAll('.xls-graph-inspector button'),
      ).find((b) => /OPEN X PROFILE/i.test(b.textContent || '')) as HTMLButtonElement;
      expect(openBtn).toBeTruthy();
      act(() => openBtn.click());
      expect(onOpen).toHaveBeenCalledWith('dave');
    });
  });
});
