// @vitest-environment jsdom
/**
 * Task B1 — Change Intel tab, full parity.
 *
 * The Change Intel tab reproduces the Enterprise CHANGE INTEL two-column layout:
 *   column 1 = HISTORICAL CHANGE EVENTS (A2's `changeEvents` IPC — each row: uppercased
 *              event type, summary, source), column 2 = COLLECTION RUN LOG (A3's `runLog`
 *              IPC — each row: @user · OPERATION, N observed / N new / N duplicate,
 *              x/y passes, status/stopReason). The existing network-deltas rendering stays
 *              alongside, below the grid.
 *
 * Same harness as x-listening-tabs2.test.tsx (createRoot + act, no @testing-library).
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings, type AppSettings } from '@shared/types';

const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };

const CHANGE_EVENTS = [
  {
    id: 'ev-1',
    kind: 'post_changed' as const,
    at: '2026-08-10T00:00:00.000Z',
    summary: 'Post text edited after capture',
    postId: 'post-a',
    sourceUsername: 'alice',
  },
  {
    id: 'ev-2',
    kind: 'profile_change' as const,
    at: '2026-08-09T00:00:00.000Z',
    summary: 'Bio changed',
    profileId: 'alice',
    sourceUsername: 'alice',
  },
  {
    id: 'ev-3',
    kind: 'post_unavailable' as const,
    at: '2026-08-08T00:00:00.000Z',
    summary: 'Post no longer available',
    postId: 'post-b',
    sourceUsername: 'carol',
  },
];

const RUN_LOG = [
  {
    profileId: 'alice',
    username: 'alice',
    operation: 'posts' as const,
    observed: 40,
    added: 12,
    duplicates: 28,
    requestedPasses: 3,
    completedPasses: 3,
    reachedEnd: true,
    stopReason: 'reached-end',
    status: 'complete',
    startedAt: '2026-08-10T00:00:00.000Z',
    endedAt: '2026-08-10T00:01:00.000Z',
  },
  {
    profileId: 'carol',
    username: 'carol',
    operation: 'archive_posts' as const,
    observed: 0,
    added: 0,
    duplicates: 0,
    requestedPasses: 1,
    completedPasses: 0,
    reachedEnd: false,
    stopReason: 'tor-unavailable',
    status: 'error',
    startedAt: '2026-08-09T00:00:00.000Z',
    endedAt: '2026-08-09T00:00:05.000Z',
  },
];

const NETWORK_ARTIFACT = {
  target: '@alice',
  kind: 'followers' as const,
  capturedAt: '2026-08-01T00:00:00.000Z',
  accounts: [
    {
      handle: '@brand_new',
      displayName: 'Brand New',
      firstObservedAt: '2026-08-01T00:00:00.000Z',
      lastObservedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
};

function makeApi(over: { changeEvents?: unknown[]; runLog?: unknown[]; networks?: unknown[] } = {}) {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A]),
      campaignsSwitch: vi.fn(async () => CAMP_A),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      postsList: vi.fn(async () => []),
      analysis: vi.fn(async () => ({
        targetCount: 0, relationshipCount: 0, uniqueIdentityCount: 0, commonIdentityCount: 0,
        highOverlapCount: 0, pairs: [], identities: [], graph: { nodes: [], edges: [] },
      })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      networksList: vi.fn(async () => over.networks ?? [NETWORK_ARTIFACT]),
      changeEvents: vi.fn(async () => over.changeEvents ?? CHANGE_EVENTS),
      runLog: vi.fn(async () => over.runLog ?? RUN_LOG),
      readNotes: vi.fn(async () => ({ notes: [] })),
      presetsRead: vi.fn(async () => ({ presets: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
    },
  };
}

describe('X Listening Station — Change Intel tab (Task B1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  function install(a: ReturnType<typeof makeApi>) {
    api = a;
    (globalThis as any).window.api = a;
  }

  beforeEach(() => {
    install(makeApi());
    useSettings.setState({
      settings: { ...defaultSettings, xListening: { ...defaultSettings.xListening } } as AppSettings,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    useSettings.setState({ settings: null });
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => { root.render(<XListeningModule />); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  }
  function findTab(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('.xls-tab')).find((b) => matcher.test(b.textContent || ''));
    if (!hit) throw new Error(`tab not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickTab(matcher: RegExp) {
    await act(async () => { findTab(matcher).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  }

  it('renders a two-column grid with both the change-events and the run-log panels', async () => {
    await mount();
    await clickTab(/^changes$/i);
    const grid = container.querySelector('.xls-changes-grid');
    expect(grid).toBeTruthy();
    const panels = Array.from(grid!.querySelectorAll('.xls-panel'));
    expect(panels.length).toBe(2);
    const titles = panels.map((p) => p.querySelector('.xls-panel-title')?.textContent || '');
    expect(titles.some((t) => /HISTORICAL CHANGE EVENTS/.test(t))).toBe(true);
    expect(titles.some((t) => /COLLECTION RUN LOG/.test(t))).toBe(true);
  });

  it('HISTORICAL CHANGE EVENTS column: uppercased event type + summary + source, from the changeEvents IPC', async () => {
    await mount();
    await clickTab(/^changes$/i);
    expect(api.xListening.changeEvents).toHaveBeenCalledWith('camp-a');
    const grid = container.querySelector('.xls-changes-grid')!;
    const eventsPanel = Array.from(grid.querySelectorAll('.xls-panel'))
      .find((p) => /HISTORICAL CHANGE EVENTS/.test(p.querySelector('.xls-panel-title')?.textContent || ''))!;
    const text = eventsPanel.textContent || '';
    expect(text).toMatch(/POST CHANGED/);
    expect(text).toMatch(/PROFILE CHANGE/);
    expect(text).toMatch(/POST UNAVAILABLE/);
    expect(text).toMatch(/Post text edited after capture/);
    expect(text).toMatch(/@alice/);
    expect(text).toMatch(/@carol/);
  });

  it('COLLECTION RUN LOG column: @user · OPERATION, observed/new/duplicate, x/y passes, status/stopReason', async () => {
    await mount();
    await clickTab(/^changes$/i);
    expect(api.xListening.runLog).toHaveBeenCalledWith('camp-a');
    const grid = container.querySelector('.xls-changes-grid')!;
    const runPanel = Array.from(grid.querySelectorAll('.xls-panel'))
      .find((p) => /COLLECTION RUN LOG/.test(p.querySelector('.xls-panel-title')?.textContent || ''))!;
    const rows = Array.from(runPanel.querySelectorAll('.xls-source-row'));
    expect(rows.length).toBe(2);
    const completeRow = rows.find((r) => /@alice/.test(r.textContent || ''))!;
    const t = completeRow.textContent || '';
    expect(t).toMatch(/POSTS/);
    expect(t).toMatch(/40 observed/);
    expect(t).toMatch(/12 new/);
    expect(t).toMatch(/28 duplicate/);
    expect(t).toMatch(/3\/3 passes/);
    expect(t).toMatch(/REACHED-END/i);
    // the errored archive run reads ERROR
    const errRow = rows.find((r) => /@carol/.test(r.textContent || ''))!;
    const et = errRow.textContent || '';
    expect(et).toMatch(/ARCHIVE POSTS/);
    expect(et).toMatch(/0\/1 passes/);
    expect(et).toMatch(/ERROR/);
    expect(errRow.querySelector('.xls-marker-run-error')).toBeTruthy();
  });

  it('keeps the network-deltas rendering alongside the two-column grid', async () => {
    await mount();
    await clickTab(/^changes$/i);
    expect(api.xListening.networksList).toHaveBeenCalledWith('camp-a');
    // grid and network-delta rows both present in the same tab panel
    expect(container.querySelector('.xls-changes-grid')).toBeTruthy();
    const text = container.textContent || '';
    expect(text).toMatch(/@brand_new/);
    expect(container.querySelector('.xls-marker-new')).toBeTruthy();
  });

  it('renders honest empty states in both columns when the streams are empty (defensive)', async () => {
    install(makeApi({ changeEvents: [], runLog: [], networks: [] }));
    await mount();
    await clickTab(/^changes$/i);
    const text = container.textContent || '';
    expect(text).toMatch(/No post edits or profile-metadata changes/i);
    expect(text).toMatch(/No collection runs recorded/i);
    expect(text).toMatch(/No follower\/following accounts captured/i);
  });
});
