// @vitest-environment jsdom
/**
 * Task 8 — wire the cockpit live: the mount-independent run-event singleton, the
 * availability probe, and graph-node Focus/Ignore during an active run.
 *
 * Proves the §6 data-flow contract end to end:
 *   - mounting the shell probes `run.available()` into the store AND subscribes the
 *     run-event singleton exactly once (`run.onEvent`);
 *   - an event pushed through that singleton folds into the RunPanel feed;
 *   - UNMOUNT PERSISTENCE — unmount the panel, remount it, and the feed + runId survived
 *     (they live in the per-case store + the mount-independent subscriber, not panel state);
 *   - a graph node's Focus during an active run calls `run.focus(runId, entityId)`.
 *
 * No @testing-library — React 18 createRoot inside act() against a jsdom container with a
 * mocked window.api, mirroring x-ghostscrape-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InvestigationGraphModule } from '../src/renderer/modules/investigation-graph/InvestigationGraphModule';
import { useInvestigationRunStore } from '../src/renderer/state/investigation-run-store';
import { __resetRunStreamForTest } from '../src/renderer/state/investigation-run-stream.singleton';
import type { InvestigationScene, SceneDelta } from '../src/shared/investigation-graph';
import type { RunEvent } from '../src/shared/investigation-agent';

const CASE_ID = 'c-live';

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
let runAvailable: ReturnType<typeof vi.fn>;
let runFocus: ReturnType<typeof vi.fn>;
let runIgnore: ReturnType<typeof vi.fn>;
let runOnEvent: ReturnType<typeof vi.fn>;
let eventCb: ((p: { runId: string; event: RunEvent }) => void) | null;

function installApi(scene: InvestigationScene): void {
  eventCb = null;
  runAvailable = vi.fn().mockResolvedValue(true);
  runFocus = vi.fn().mockResolvedValue(undefined);
  runIgnore = vi.fn().mockResolvedValue(undefined);
  runOnEvent = vi.fn((cb: (p: { runId: string; event: RunEvent }) => void) => {
    eventCb = cb;
    return () => { eventCb = null; };
  });
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    investigation: {
      graph: vi.fn().mockResolvedValue(scene),
      onGraphDelta: vi.fn((_caseId: string, _cb: (d: SceneDelta) => void) => () => {}),
      addNode: vi.fn().mockResolvedValue(undefined),
      addEdge: vi.fn().mockResolvedValue(undefined),
      run: {
        available: runAvailable,
        start: vi.fn().mockResolvedValue('r1'),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        addScope: vi.fn().mockResolvedValue(undefined),
        removeScope: vi.fn().mockResolvedValue(undefined),
        focus: runFocus,
        ignore: runIgnore,
        answer: vi.fn().mockResolvedValue(undefined),
        onEvent: runOnEvent,
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
        save: vi.fn().mockResolvedValue(null),
      },
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(InvestigationGraphModule, { caseId: CASE_ID }));
  });
  await flush();
}

async function fire(event: RunEvent, runId = 'r1'): Promise<void> {
  await act(async () => {
    eventCb?.({ runId, event });
  });
  await flush();
}

beforeEach(() => {
  __resetRunStreamForTest();
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
  __resetRunStreamForTest();
  vi.restoreAllMocks();
});

describe('Investigation cockpit — live wiring (Task 8)', () => {
  it('mount probes run.available into the store and subscribes the run-event singleton once', async () => {
    await mount();

    expect(runAvailable).toHaveBeenCalled();
    expect(runOnEvent).toHaveBeenCalledTimes(1);
    expect(useInvestigationRunStore.getState().cases[CASE_ID]?.available).toBe(true);
  });

  it('a run event fed through the singleton folds into the RunPanel feed', async () => {
    await mount();

    // A run is under way (started elsewhere / rehydrated) — the store owns the runId.
    await act(async () => {
      useInvestigationRunStore.getState().beginRun(CASE_ID, 'r1');
    });
    await flush();

    await fire({ kind: 'action', transformId: 'whois', entityValue: 'evil.tld' });

    expect(container.textContent ?? '').toContain('Running whois on evil.tld');
  });

  it('unmount then remount preserves the feed and runId (store-backed)', async () => {
    await mount();
    await act(async () => {
      useInvestigationRunStore.getState().beginRun(CASE_ID, 'r1');
    });
    await flush();
    await fire({ kind: 'action', transformId: 'whois', entityValue: 'evil.tld' });
    expect(container.textContent ?? '').toContain('Running whois on evil.tld');

    // Unmount the whole panel (a tab switch).
    act(() => root.unmount());

    // Remount into a fresh root — the run kept going main-side; the store greets us back.
    root = createRoot(container);
    await mount();

    expect(container.textContent ?? '').toContain('Running whois on evil.tld');
    expect(useInvestigationRunStore.getState().cases[CASE_ID]?.runId).toBe('r1');
  });

  it('Focus on a graph node during an active run calls run.focus(runId, entityId)', async () => {
    // Seed an active run before mount so GraphPane offers Focus/Ignore in the inspector.
    useInvestigationRunStore.setState({
      cases: {
        [CASE_ID]: {
          runId: 'r1',
          status: 'running',
          feed: [],
          pendingAsk: null,
          available: true,
        },
      },
    });
    await mount();

    // Click the first node to open the inspector.
    const circle = container.querySelector('circle');
    expect(circle).not.toBeNull();
    await act(async () => {
      circle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      circle!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await flush();

    const focusBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /^focus$/i.test(b.textContent ?? ''),
    );
    expect(focusBtn).not.toBeUndefined();
    await act(async () => {
      focusBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(runFocus).toHaveBeenCalledWith('r1', 'e1');
  });
});
