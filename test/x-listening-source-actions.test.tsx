// @vitest-environment jsdom
/**
 * Task D1 — Target Sources per-source card actions (REFRESH / VIEW X / NETWORK / REMOVE).
 *
 * Same no-hollow-UI discipline as x-listening-network-extract.test.tsx: every per-source button
 * drives a REAL channel (mocked here) or a real state transition:
 *   - REFRESH  → window.api.xListening.captureTimeline for THAT one source (single-source capture).
 *   - VIEW X   → window.api.xListening.openInX({ kind:'profile', ref:<handle> }) (E1, Tor-gated main-side).
 *   - NETWORK  → switches to the Network tab with the source pre-selected as the TARGET SOURCE (C1).
 *   - REMOVE   → confirmDialog gate, then window.api.xListening.removeSource cascade, then reload.
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency).
 */
import { vi } from 'vitest';

const confirmDialog = vi.fn(async () => true);
vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: (...a: unknown[]) => confirmDialog(...a),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings, type AppSettings } from '@shared/types';

const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };

const POST_ALICE = {
  id: 'post-a',
  channelId: 'alice',
  channelLabel: '@alice',
  authorHandle: 'alice',
  text: 'hello',
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://x.com/alice/status/1',
  kind: 'post',
};
const POST_CAROL = {
  id: 'post-c',
  channelId: 'carol',
  channelLabel: '@carol',
  authorHandle: 'carol',
  text: 'world',
  publishedAt: '2026-08-02T00:00:00.000Z',
  url: 'https://x.com/carol/status/2',
  kind: 'post',
};

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A]),
      campaignsCreate: vi.fn(),
      campaignsUpdate: vi.fn(),
      campaignsDelete: vi.fn(async () => undefined),
      campaignsSwitch: vi.fn(async () => CAMP_A),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => [POST_ALICE, POST_CAROL]),
      analysis: vi.fn(async () => ({
        targetCount: 0, relationshipCount: 0, uniqueIdentityCount: 0, commonIdentityCount: 0,
        highOverlapCount: 0, pairs: [], identities: [], graph: { nodes: [], edges: [] },
      })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      captureTimeline: vi.fn(async () => ({ blocked: false, added: 1, skipped: 0, posts: [] })),
      captureNetwork: vi.fn(async () => ({
        blocked: false, kind: 'followers', target: '@x', observed: 0, added: 0,
        completedPasses: 1, reachedEnd: true,
      })),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      presetsRead: vi.fn(async () => ({ presets: [] })),
      openInX: vi.fn(async () => ({ opened: true, url: 'https://x.com/alice' })),
      removeSource: vi.fn(async () => ({ removedPosts: 1, removedNetworks: 0 })),
    },
  };
}

function setXListeningSettings(patch: Partial<AppSettings['xListening']>): void {
  useSettings.setState({
    settings: { ...defaultSettings, xListening: { ...defaultSettings.xListening, ...patch } },
  });
}

describe('X Listening Station — Target Sources per-source actions (Task D1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
    (globalThis as any).window.api = api;
    setXListeningSettings({});
    confirmDialog.mockClear();
    confirmDialog.mockResolvedValue(true as never);
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
    const hit = Array.from(container.querySelectorAll('.xls-tab')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`tab not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickTab(matcher: RegExp) {
    await act(async () => { findTab(matcher).click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
  }
  function card(sourceKey: string): HTMLElement {
    const hit = Array.from(container.querySelectorAll('.xls-source-card')).find(
      (c) => c.getAttribute('data-source') === sourceKey,
    );
    if (!hit) throw new Error(`source card not found: ${sourceKey}`);
    return hit as HTMLElement;
  }
  function cardButton(sourceKey: string, matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(card(sourceKey).querySelectorAll('button')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`card button not found: ${sourceKey} / ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickCardButton(sourceKey: string, matcher: RegExp) {
    await act(async () => { cardButton(sourceKey, matcher).click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  }
  function selectByLabel(label: RegExp): HTMLSelectElement {
    const hit = Array.from(container.querySelectorAll('select')).find(
      (s) => label.test(s.getAttribute('aria-label') || ''),
    );
    if (!hit) throw new Error(`select not found: ${label}`);
    return hit as HTMLSelectElement;
  }

  it('each source renders a per-source action card (REFRESH / VIEW X / NETWORK / REMOVE)', async () => {
    await mount();
    await clickTab(/target sources|sources/i);
    for (const key of ['alice', 'carol']) {
      expect(cardButton(key, /refresh/i)).toBeTruthy();
      expect(cardButton(key, /view x/i)).toBeTruthy();
      expect(cardButton(key, /network/i)).toBeTruthy();
      expect(cardButton(key, /remove/i)).toBeTruthy();
    }
  });

  it('REFRESH invokes a single-source captureTimeline for that source only', async () => {
    await mount();
    await clickTab(/sources/i);
    await clickCardButton('carol', /refresh/i);
    expect(api.xListening.captureTimeline).toHaveBeenCalledTimes(1);
    expect(api.xListening.captureTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'camp-a', targetUsername: 'carol' }),
    );
  });

  it('VIEW X opens the source profile via openInX kind=profile with the handle', async () => {
    await mount();
    await clickTab(/sources/i);
    await clickCardButton('alice', /view x/i);
    expect(api.xListening.openInX).toHaveBeenCalledTimes(1);
    expect(api.xListening.openInX).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'profile', ref: 'alice' }),
    );
  });

  it('NETWORK switches to the Network tab with the source pre-selected as TARGET SOURCE', async () => {
    await mount();
    await clickTab(/sources/i);
    await clickCardButton('carol', /network/i);
    // The Network tab is now active — its EXTRACT panel + TARGET SOURCE select are present…
    const sel = selectByLabel(/network extraction target source/i);
    // …and pre-selected to the clicked source.
    expect(sel.value).toBe('carol');
  });

  it('REMOVE confirms then invokes the removeSource cascade for that source', async () => {
    await mount();
    await clickTab(/sources/i);
    await clickCardButton('alice', /remove/i);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(api.xListening.removeSource).toHaveBeenCalledTimes(1);
    expect(api.xListening.removeSource).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'camp-a', sourceKey: 'alice' }),
    );
  });

  it('REMOVE does nothing when the confirm is declined', async () => {
    confirmDialog.mockResolvedValue(false as never);
    await mount();
    await clickTab(/sources/i);
    await clickCardButton('carol', /remove/i);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(api.xListening.removeSource).not.toHaveBeenCalled();
  });
});
