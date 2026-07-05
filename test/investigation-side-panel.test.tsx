// @vitest-environment jsdom
/**
 * Task 7 — the cockpit shell: GraphPane + InvestigationSidePanel.
 *
 * The `InvestigationGraphModule` becomes a thin shell: `<GraphPane>` (center) beside a docked,
 * collapsible `<InvestigationSidePanel>` that hosts a Run/Report segmented switch composing
 * RunPanel + ReportPanel. This test proves:
 *   - the shell renders BOTH the graph SVG and the side panel (extraction is behavior-preserving —
 *     investigation-graph-render.pw.test.ts covers the graph half in full);
 *   - the Run/Report switch toggles which panel shows (default Run);
 *   - the collapse toggle hides the body and the expand control restores it;
 *   - "Open report" from a terminal run flips to the Report section pre-scoped to that runId.
 *
 * No @testing-library — React 18 createRoot inside act() against a jsdom container, mocked
 * window.api, mirroring x-ghostscrape-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InvestigationGraphModule } from '../src/renderer/modules/investigation-graph/InvestigationGraphModule';
import { InvestigationSidePanel } from '../src/renderer/modules/investigation-graph/InvestigationSidePanel';
import {
  useInvestigationRunStore,
  type RunEntry,
} from '../src/renderer/state/investigation-run-store';
import type { InvestigationScene, SceneDelta } from '../src/shared/investigation-graph';

const CASE_ID = 'c-shell';
const NODES = [{ id: 'n1', value: 'evil.tld', type: 'domain' as const }];

const populatedScene: InvestigationScene = {
  nodes: [
    { id: 'e1', type: 'domain', value: 'evil.tld', cluster: 0, score: 1, x: 10, y: 10 },
    { id: 'e2', type: 'email', value: 'reg@evil.tld', cluster: 0, score: 0.6, x: 90, y: 40 },
    { id: 'e3', type: 'ip', value: '1.2.3.4', cluster: 1, score: 0.3, x: 200, y: 120 },
  ],
  edges: [{ source: 'e1', target: 'e2', relation: 'registrant-of', kind: 'relation' }],
};

let container: HTMLDivElement;
let root: Root;

function installApi(scene: InvestigationScene): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    investigation: {
      graph: vi.fn().mockResolvedValue(scene),
      onGraphDelta: vi.fn((_caseId: string, _cb: (d: SceneDelta) => void) => () => {}),
      addNode: vi.fn().mockResolvedValue(undefined),
      addEdge: vi.fn().mockResolvedValue(undefined),
      run: {
        start: vi.fn().mockResolvedValue('r1'),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        answer: vi.fn().mockResolvedValue(undefined),
        addScope: vi.fn().mockResolvedValue(undefined),
        removeScope: vi.fn().mockResolvedValue(undefined),
      },
      report: {
        generate: vi.fn().mockResolvedValue({
          caseId: CASE_ID,
          generatedAt: '2026-07-05T00:00:00.000Z',
          actors: [],
          actorTail: { shown: 0, total: 0 },
          findings: [],
          methodology: [],
          narrative: null,
        }),
        save: vi.fn().mockResolvedValue('/tmp/report.pdf'),
      },
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function seed(entry: Partial<RunEntry>): void {
  const full: RunEntry = {
    runId: null,
    status: 'idle',
    feed: [],
    pendingAsk: null,
    available: true,
    ...entry,
  };
  useInvestigationRunStore.setState({ cases: { [CASE_ID]: full } });
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  installApi(populatedScene);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useInvestigationRunStore.setState({ cases: {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useInvestigationRunStore.setState({ cases: {} });
  vi.restoreAllMocks();
});

describe('InvestigationGraphModule shell (Task 7)', () => {
  it('renders BOTH the graph SVG and the docked side panel', async () => {
    seed({ available: true });
    await act(async () => {
      root.render(createElement(InvestigationGraphModule, { caseId: CASE_ID }));
    });
    await flush();

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('circle')).not.toBeNull();
    expect(container.querySelector('.investigation-side-panel')).not.toBeNull();
    // The Run/Report switch lives in the side panel.
    expect(container.querySelector('.investigation-side-panel__switch')).not.toBeNull();
  });
});

describe('InvestigationSidePanel (Task 7)', () => {
  function sidePanel(): HTMLElement {
    const el = container.querySelector('.investigation-side-panel');
    if (!el) throw new Error('no .investigation-side-panel');
    return el as HTMLElement;
  }

  it('defaults to the Run section; the switch toggles Run <-> Report', async () => {
    seed({ available: true, status: 'idle' });
    await act(async () => {
      root.render(createElement(InvestigationSidePanel, { caseId: CASE_ID, nodes: NODES }));
    });
    await flush();

    // Default: Run pressed, RunPanel content shown (idle form → Start investigation).
    const runBtn = buttonByText(sidePanel(), /^run$/i);
    const reportBtn = buttonByText(sidePanel(), /^report$/i);
    expect(runBtn.getAttribute('aria-pressed')).toBe('true');
    expect(sidePanel().querySelector('.run-panel')).not.toBeNull();
    expect(sidePanel().querySelector('.report-panel')).toBeNull();

    // Switch to Report.
    await act(async () => {
      reportBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(reportBtn.getAttribute('aria-pressed')).toBe('true');
    expect(sidePanel().querySelector('.report-panel')).not.toBeNull();
    expect(sidePanel().querySelector('.run-panel')).toBeNull();

    // Switch back to Run.
    await act(async () => {
      buttonByText(sidePanel(), /^run$/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(sidePanel().querySelector('.run-panel')).not.toBeNull();
    expect(sidePanel().querySelector('.report-panel')).toBeNull();
  });

  it('collapse hides the body; expand restores it', async () => {
    seed({ available: true, status: 'idle' });
    await act(async () => {
      root.render(createElement(InvestigationSidePanel, { caseId: CASE_ID, nodes: NODES }));
    });
    await flush();

    expect(sidePanel().querySelector('.investigation-side-panel__body')).not.toBeNull();

    await act(async () => {
      const collapse = sidePanel().querySelector(
        '.investigation-side-panel__collapse',
      ) as HTMLButtonElement;
      collapse.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    // Collapsed: body gone, an expand control present.
    expect(sidePanel().querySelector('.investigation-side-panel__body')).toBeNull();
    const expand = sidePanel().querySelector(
      '.investigation-side-panel__expand',
    ) as HTMLButtonElement | null;
    expect(expand).not.toBeNull();

    await act(async () => {
      expand!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(sidePanel().querySelector('.investigation-side-panel__body')).not.toBeNull();
  });

  it('"Open report" from a terminal run flips to Report pre-scoped to that runId', async () => {
    seed({ available: true, status: 'done', runId: 'r9' });
    await act(async () => {
      root.render(createElement(InvestigationSidePanel, { caseId: CASE_ID, nodes: NODES }));
    });
    await flush();

    // Terminal RunPanel shows the "Open report" action.
    const openReport = buttonByText(sidePanel(), /open report/i);
    await act(async () => {
      openReport.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    // Report section now shown, scoped to the run: the "This run" scope button is enabled + pressed.
    const reportPanel = sidePanel().querySelector('.report-panel') as HTMLElement | null;
    expect(reportPanel).not.toBeNull();
    const thisRun = buttonByText(reportPanel!, /this run/i);
    expect(thisRun.disabled).toBe(false);
    expect(thisRun.getAttribute('aria-pressed')).toBe('true');
  });
});
