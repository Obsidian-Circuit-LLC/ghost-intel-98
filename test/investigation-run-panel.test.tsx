// @vitest-environment jsdom
/**
 * Task 5: RunPanel — the 5-state Run machine (spec §4).
 *
 * unavailable / idle / running / ask / terminal. Drives React 18's createRoot inside
 * act() against a jsdom container with a mocked window.api, mirroring
 * x-ghostscrape-cases-sidebar.test.tsx. The per-case run store is seeded directly
 * (useInvestigationRunStore.setState) to place the panel in each state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunPanel, BUDGET_PRESETS } from '../src/renderer/modules/investigation-graph/RunPanel';
import {
  useInvestigationRunStore,
  type RunEntry,
} from '../src/renderer/state/investigation-run-store';
import type { FeedLine } from '../src/renderer/modules/investigation-graph/run-feed';

const CASE_ID = 'c-1';
const NODES = [
  { id: 'n1', value: 'evil.tld', type: 'domain' as const },
  { id: 'n2', value: 'admin@evil.tld', type: 'email' as const },
];

let container: HTMLDivElement;
let root: Root;
let runStart: ReturnType<typeof vi.fn>;
let runPause: ReturnType<typeof vi.fn>;
let runResume: ReturnType<typeof vi.fn>;
let runStop: ReturnType<typeof vi.fn>;
let runAnswer: ReturnType<typeof vi.fn>;
let runAddScope: ReturnType<typeof vi.fn>;
let runRemoveScope: ReturnType<typeof vi.fn>;

function installApi(): void {
  runStart = vi.fn().mockResolvedValue('r1');
  runPause = vi.fn().mockResolvedValue(undefined);
  runResume = vi.fn().mockResolvedValue(undefined);
  runStop = vi.fn().mockResolvedValue(undefined);
  runAnswer = vi.fn().mockResolvedValue(undefined);
  runAddScope = vi.fn().mockResolvedValue(undefined);
  runRemoveScope = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    investigation: {
      run: {
        start: runStart,
        pause: runPause,
        resume: runResume,
        stop: runStop,
        answer: runAnswer,
        addScope: runAddScope,
        removeScope: runRemoveScope,
      },
    },
  };
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re}`);
  return btn as HTMLButtonElement;
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const onOpenReport = vi.fn();

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<RunPanel caseId={CASE_ID} nodes={NODES} onOpenReport={onOpenReport} />);
  });
  await flush();
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useInvestigationRunStore.setState({ cases: {} });
  onOpenReport.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useInvestigationRunStore.setState({ cases: {} });
  vi.restoreAllMocks();
});

describe('RunPanel — unavailable', () => {
  it('renders the calm reasoning-pack copy and NO Start button', async () => {
    seed({ available: false });
    await mount();

    expect((container.textContent ?? '').toLowerCase()).toContain('reasoning pack');
    const start = Array.from(container.querySelectorAll('button')).find((b) =>
      /start investigation/i.test(b.textContent ?? ''),
    );
    expect(start).toBeUndefined();
  });
});

describe('RunPanel — idle', () => {
  it('Start is disabled until a seed is picked AND an objective typed, then calls run.start', async () => {
    seed({ available: true, status: 'idle' });
    await mount();

    // Nothing selected, no objective → disabled.
    expect(buttonByText(container, /start investigation/i).disabled).toBe(true);

    // Pick a seed only → still disabled.
    await act(async () => {
      (container.querySelector('[data-seed-id="n1"]') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await flush();
    expect(buttonByText(container, /start investigation/i).disabled).toBe(true);

    // Type an objective → now enabled.
    typeInto(container.querySelector('#run-objective') as HTMLInputElement, 'Map the infrastructure');
    await flush();
    expect(buttonByText(container, /start investigation/i).disabled).toBe(false);

    await act(async () => {
      buttonByText(container, /start investigation/i).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await flush();

    expect(runStart).toHaveBeenCalledWith(
      CASE_ID,
      ['n1'],
      'Map the infrastructure',
      BUDGET_PRESETS.Standard,
    );
  });
});

describe('RunPanel — running', () => {
  const feed: FeedLine[] = [
    { text: 'Running whois on evil.tld', severity: 'action' },
    { text: 'Found 3 new entities', severity: 'info' },
  ];

  it('renders fed lines; Pause and Stop call the control fns', async () => {
    seed({ available: true, status: 'running', runId: 'r1', feed });
    await mount();

    const text = container.textContent ?? '';
    expect(text).toContain('Running whois on evil.tld');
    expect(text).toContain('Found 3 new entities');

    await act(async () => {
      buttonByText(container, /pause/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(runPause).toHaveBeenCalledWith('r1');

    typeInto(container.querySelector('#run-stop-reason') as HTMLInputElement, 'lead exhausted');
    await act(async () => {
      buttonByText(container, /^stop$/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(runStop).toHaveBeenCalledWith('r1', 'lead exhausted');
  });

  it('paused run offers Resume → run.resume', async () => {
    seed({ available: true, status: 'paused', runId: 'r1', feed });
    await mount();

    await act(async () => {
      buttonByText(container, /resume/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(runResume).toHaveBeenCalledWith('r1');
  });
});

describe('RunPanel — ask', () => {
  it('surfaces the question and Send calls run.answer', async () => {
    seed({
      available: true,
      status: 'running',
      runId: 'r1',
      pendingAsk: 'Which domain should I pivot on next?',
    });
    await mount();

    expect(container.textContent ?? '').toContain('Which domain should I pivot on next?');

    typeInto(container.querySelector('#run-answer') as HTMLTextAreaElement, 'the .tld one');
    await act(async () => {
      buttonByText(container, /send/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(runAnswer).toHaveBeenCalledWith('r1', 'the .tld one');
  });
});

describe('RunPanel — terminal', () => {
  it('shows the final status and Open report scopes to the runId', async () => {
    seed({
      available: true,
      status: 'done',
      runId: 'r1',
      feed: [{ text: 'Done: budget exhausted', severity: 'done' }],
    });
    await mount();

    expect(container.textContent ?? '').toContain('Done: budget exhausted');

    await act(async () => {
      buttonByText(container, /open report/i).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await flush();

    expect(onOpenReport).toHaveBeenCalledWith('r1');
  });
});
