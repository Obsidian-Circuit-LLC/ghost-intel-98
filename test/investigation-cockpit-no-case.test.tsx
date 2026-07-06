// @vitest-environment jsdom
/**
 * Pre-ship v3.31.0 reachability fix — the investigation cockpit must never open into a raw error.
 *
 * The cockpit is per-case: opened without a caseId (e.g. from the global OSINT AccessMenu, which
 * passes no props) GraphPane used to call investigation.graph(undefined) → ensureUuid throws → the
 * pane rendered "Could not load the investigation graph: Invalid caseId…". InvestigationGraphModule
 * now GUARDS: no caseId → a calm, actionable hint (how to open it from a case) and it must NOT touch
 * the graph IPC. With a caseId it mounts the cockpit and drives the graph exactly as before.
 *
 * No @testing-library — React 18 createRoot inside act() against a jsdom container, mirroring
 * test/investigation-graph-render.pw.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InvestigationGraphModule } from '../src/renderer/modules/investigation-graph/InvestigationGraphModule';

let container: HTMLDivElement;
let root: Root;
let graphSpy: ReturnType<typeof vi.fn>;

function installApi(): void {
  graphSpy = vi.fn().mockResolvedValue({ nodes: [], edges: [] });
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    investigation: {
      graph: graphSpy,
      onGraphDelta: vi.fn().mockReturnValue(() => {}),
      run: { available: vi.fn().mockResolvedValue(false) }
    }
  };
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('investigation cockpit — no-case guard', () => {
  it('with no caseId: renders the actionable hint and never calls the graph IPC', () => {
    act(() => { root.render(createElement(InvestigationGraphModule, { caseId: undefined })); });
    expect(container.textContent).toMatch(/open an investigation from a case/i);
    expect(container.textContent).not.toMatch(/Invalid caseId|Could not load/i);
    expect(graphSpy).not.toHaveBeenCalled();
  });

  it('with an empty-string caseId: still the hint, still no graph call', () => {
    act(() => { root.render(createElement(InvestigationGraphModule, { caseId: '' })); });
    expect(container.textContent).toMatch(/open an investigation from a case/i);
    expect(graphSpy).not.toHaveBeenCalled();
  });

  it('with a real caseId: mounts the cockpit and drives the graph IPC', () => {
    act(() => { root.render(createElement(InvestigationGraphModule, { caseId: '11111111-1111-4111-8111-111111111111' })); });
    expect(container.textContent).not.toMatch(/open an investigation from a case/i);
    expect(graphSpy).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });
});
