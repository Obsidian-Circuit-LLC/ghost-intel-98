// @vitest-environment jsdom
/**
 * `loadInsights` must not let ONE failing channel blank the whole station.
 *
 * FIELD CONTEXT (GhostExodus, 2026-08-18): panels that had data came back empty on a later visit
 * ("I returned to the app later, and they've all disappeared lol") with nothing on screen saying
 * why. `loadInsights` fans out over ELEVEN IPC channels in a single `Promise.all` and its only
 * error handling is `console.warn`. `Promise.all` is all-or-nothing: one rejection — a locked
 * vault (`EVAULTLOCKED`), a failed GCM tag (`EDECRYPT`), a stale preload — skips ALL ELEVEN
 * `setX` calls, so every panel silently shows its empty state and the user is told nothing. A
 * silent blank is indistinguishable from "you have no data", which is exactly the confusion the
 * field reports describe.
 *
 * Two guarantees, both asserted against the REAL module (createRoot + act, no @testing-library):
 *   1. ISOLATION — a channel that rejects costs only its own panel; the other ten still populate.
 *   2. HONESTY — the failure is surfaced in the UI, and a locked vault says so in plain language
 *      with the one action that fixes it (ADHD-friendliness: never fail silently, one clear next
 *      step). A console.warn is not surfacing.
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
import { defaultSettings } from '@shared/types';

const CAMP = { id: 'camp-a', name: 'Operation Midnight', createdAt: 1, updatedAt: 1 };

const POSTS = [
  {
    id: 'post-a', channelId: 'alice', channelLabel: '@alice', authorHandle: 'alice',
    text: 'hello', publishedAt: '2026-08-01T00:00:00.000Z',
    url: 'https://x.com/alice/status/1', kind: 'post',
  },
  {
    id: 'post-b', channelId: 'bob', channelLabel: '@bob', authorHandle: 'bob',
    text: 'world', publishedAt: '2026-08-02T00:00:00.000Z',
    url: 'https://x.com/bob/status/2', kind: 'post',
  },
];

/** The error the main-process IPC gate throws when the vault is locked (ipc/register.ts). */
function vaultLockedError(): Error {
  const err = new Error('[x:networksList] Locked — unlock Ghost Intel 98 to continue.');
  err.name = 'VaultLocked';
  (err as Error & { code?: string }).code = 'EVAULTLOCKED';
  return err;
}

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP]),
      campaignsCreate: vi.fn(),
      campaignsUpdate: vi.fn(),
      campaignsDelete: vi.fn(async () => undefined),
      campaignsSwitch: vi.fn(async () => CAMP),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => POSTS),
      analysis: vi.fn(async () => ({
        targetCount: 0, relationshipCount: 0, uniqueIdentityCount: 0, commonIdentityCount: 0,
        highOverlapCount: 0, pairs: [], identities: [], graph: { nodes: [], edges: [] },
      })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      networkEvents: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      presetsRead: vi.fn(async () => ({ presets: [] })),
      avatars: vi.fn(async () => ({})),
    },
  };
}

describe('X Listening Station — one failing insights channel must not blank the station', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
    (globalThis as any).window.api = api;
    useSettings.setState({ settings: { ...defaultSettings } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  }

  function badgeFor(tab: string): string {
    const btn = container.querySelector(`button[data-tab="${tab}"]`);
    if (!btn) throw new Error(`tab not found: ${tab}`);
    return btn.querySelector('.xls-nav-badge')?.textContent ?? '';
  }

  function noticeText(): string {
    return Array.from(container.querySelectorAll('.xls-notice'))
      .map((n) => n.textContent ?? '')
      .join(' | ');
  }

  it('keeps the other panels populated when one channel rejects', async () => {
    api.xListening.networksList.mockRejectedValueOnce(vaultLockedError());
    await mount();
    // The live feed read succeeded; its badge must reflect the 2 posts it returned. Under the
    // all-or-nothing Promise.all this is '0' — the panel is blanked by an UNRELATED channel.
    expect(badgeFor('live')).toBe('2');
  });

  it('tells the user a panel failed instead of silently showing empty', async () => {
    api.xListening.networksList.mockRejectedValueOnce(vaultLockedError());
    await mount();
    expect(noticeText()).toMatch(/couldn't load|could not load|failed to load/i);
  });

  it('names the lock and the action that clears it', async () => {
    api.xListening.networksList.mockRejectedValueOnce(vaultLockedError());
    await mount();
    expect(noticeText()).toMatch(/unlock/i);
  });

  it('says nothing when every channel succeeds', async () => {
    await mount();
    expect(noticeText()).not.toMatch(/couldn't load|could not load|failed to load/i);
  });
});
