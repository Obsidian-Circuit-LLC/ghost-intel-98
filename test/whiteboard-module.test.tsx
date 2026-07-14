// @vitest-environment jsdom
/**
 * T3: Whiteboard v2 — node header shows the user-given name (headerLabel) and every node carries a
 * bottom-right resize handle. Pure colour/size/label logic is covered by whiteboard-node-visual;
 * this is a thin render smoke proving the module wires the helpers in (name over type in the
 * header) and paints the `.ga98-wb-resize` grip. window.api.whiteboard is stubbed so no egress /
 * disk touch; the board loads a single named node.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), mirroring
 * newsview-standalone.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WhiteboardModule } from '../src/renderer/modules/whiteboard/WhiteboardModule';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  (globalThis as unknown as { window: Window }).window.api = {
    whiteboard: {
      read: vi.fn().mockResolvedValue({
        nodes: [{ id: 'n1', type: 'file', x: 10, y: 10, w: 200, h: 120, name: 'Finn photo' }],
        edges: []
      }),
      write: vi.fn().mockResolvedValue(undefined)
    }
  } as unknown as typeof window.api;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('WhiteboardModule v2 node chrome', () => {
  it('renders the node name in the header and a resize handle', async () => {
    await act(async () => { root.render(<WhiteboardModule caseId="c1" />); });
    await act(async () => { await Promise.resolve(); });
    // headerLabel prefers the user-given name over the node type.
    expect(container.textContent ?? '').toContain('Finn photo');
    // Every node carries a bottom-right resize grip.
    expect(container.querySelector('.ga98-wb-resize')).not.toBeNull();
  });
});
