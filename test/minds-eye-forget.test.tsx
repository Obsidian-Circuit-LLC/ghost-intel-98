// @vitest-environment jsdom
/**
 * T3: Mind's Eye inspector — enable conversation Forget (tombstone), keep entity Forget disabled.
 *
 * Selecting a `kind:'conversation'` node exposes an ENABLED Forget button; clicking it (after a
 * confirm) derives the conversation id by stripping the `__conversations__:convo:` node-id prefix,
 * calls `window.api.memory.forgetConversation(<id>)`, then reloads the graph (a second
 * `memory.graph()` call). Selecting a `kind:'entity'` node exposes a DISABLED Forget button whose
 * tooltip states entity memory is a per-case aggregate (disabled by design — a per-case aggregate
 * is not forgettable node-by-node here).
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act() against a
 * jsdom container, mirroring searchlight-graph-clear-button.test.tsx. A node is selected by
 * dispatching a native `mouseup` on its <circle> (no prior mousedown ⇒ GraphCanvas treats it as a
 * plain click and opens the inspector). `confirmDialog` is mocked to auto-confirm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MindsEyeModule } from '../src/renderer/modules/minds-eye/MindsEyeModule';
import { confirmDialog } from '../src/renderer/state/dialogs';
import type { GraphNodeShape, MemoryGraphShape } from '@shared/ipc-contracts';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(async () => true),
  alertDialog: vi.fn(async () => undefined),
}));

const mkNode = (id: string, kind: GraphNodeShape['kind'], label: string): GraphNodeShape => ({
  id,
  kind,
  label,
  strength: 0.5,
  pinned: false,
  conflict: false,
  vector: [],
  // Distinct coordinates so the two nodes map to distinct on-screen circles.
  x: kind === 'conversation' ? 0 : 100,
  y: kind === 'conversation' ? 0 : 100,
  cluster: 0,
});

const graph = (): MemoryGraphShape => ({
  nodes: [
    mkNode('__conversations__:convo:c1', 'conversation', 'Chat about alpha'),
    mkNode('__entities__:entity:e1', 'entity', 'Acme Corp'),
  ],
  edges: [],
  conflictPairs: [],
});

let container: HTMLDivElement;
let root: Root;
const forgetConversation = vi.fn(async () => undefined);
const graphFn = vi.fn(async () => graph());

const buttons = () => Array.from(container.querySelectorAll('button'));
const forgetBtn = () =>
  buttons().find((b) => (b.textContent ?? '').trim() === 'Forget') as HTMLButtonElement | undefined;

const selectNode = (kind: GraphNodeShape['kind']) => {
  const circle = container.querySelector(`circle.node-${kind}`);
  if (!circle) throw new Error(`node circle for kind ${kind} not found`);
  act(() => {
    circle.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  forgetConversation.mockClear();
  graphFn.mockClear();
  (confirmDialog as unknown as ReturnType<typeof vi.fn>).mockClear();
  (window as unknown as { api: unknown }).api = {
    memory: { graph: graphFn, forgetConversation },
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const mount = async () => {
  await act(async () => {
    root.render(<MindsEyeModule />);
  });
};

describe('MindsEyeModule — conversation/entity Forget', () => {
  it('conversation node: Forget is enabled and forgets by stripped id, then reloads', async () => {
    await mount();
    selectNode('conversation');

    const btn = forgetBtn();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(false);

    const callsBefore = graphFn.mock.calls.length; // initial mount load
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(forgetConversation).toHaveBeenCalledTimes(1);
    expect(forgetConversation).toHaveBeenCalledWith('c1');
    // load() re-fetches the graph after the tombstone lands.
    expect(graphFn.mock.calls.length).toBe(callsBefore + 1);
  });

  it('entity node: Forget is disabled with the per-case-aggregate tooltip', async () => {
    await mount();
    selectNode('entity');

    const btn = forgetBtn();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
    expect(btn!.getAttribute('title') ?? '').toContain('per-case aggregate');
    expect(forgetConversation).not.toHaveBeenCalled();
  });
});
