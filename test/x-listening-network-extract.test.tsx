// @vitest-environment jsdom
/**
 * Task C1 — Network tab EXTRACT FOLLOWERS / FOLLOWING / BOTH actions.
 *
 * Same no-hollow-UI discipline as x-listening-tabs.test.tsx / x-listening-tabs2.test.tsx: every
 * button drives the REAL `window.api.xListening.captureNetwork` channel (mocked here), for the
 * selected TARGET SOURCE, with the right `kind`. EXTRACT BOTH drives followers THEN following.
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency).
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
      captureTimeline: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] })),
      captureNetwork: vi.fn(async (req: { kind: string; targetUsername: string }) => ({
        blocked: false, kind: req.kind, target: `@${req.targetUsername}`, observed: 3, added: 3,
        completedPasses: 1, reachedEnd: true,
      })),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      networkEvents: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      presetsRead: vi.fn(async () => ({ presets: [] })),
    },
  };
}

function setXListeningSettings(patch: Partial<AppSettings['xListening']>): void {
  useSettings.setState({
    settings: { ...defaultSettings, xListening: { ...defaultSettings.xListening, ...patch } },
  });
}

describe('X Listening Station — Network tab EXTRACT actions (Task C1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
    (globalThis as any).window.api = api;
    setXListeningSettings({});
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
  function findButton(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('button')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickButton(matcher: RegExp) {
    await act(async () => { findButton(matcher).click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  }
  function selectByLabel(label: RegExp): HTMLSelectElement {
    const hit = Array.from(container.querySelectorAll('select')).find(
      (s) => label.test(s.getAttribute('aria-label') || ''),
    );
    if (!hit) throw new Error(`select not found: ${label}`);
    return hit as HTMLSelectElement;
  }
  function setSelect(sel: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('EXTRACT FOLLOWERS invokes captureNetwork with kind=followers for the selected target', async () => {
    await mount();
    await clickTab(/network/i);
    // Pick a specific target source (@alice) rather than ALL.
    await act(async () => { setSelect(selectByLabel(/target source/i), 'alice'); });
    await clickButton(/extract followers/i);
    expect(api.xListening.captureNetwork).toHaveBeenCalledTimes(1);
    expect(api.xListening.captureNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'camp-a', targetUsername: 'alice', kind: 'followers' }),
    );
  });

  it('EXTRACT FOLLOWING invokes captureNetwork with kind=following for the selected target', async () => {
    await mount();
    await clickTab(/network/i);
    await act(async () => { setSelect(selectByLabel(/target source/i), 'carol'); });
    await clickButton(/extract following/i);
    expect(api.xListening.captureNetwork).toHaveBeenCalledTimes(1);
    expect(api.xListening.captureNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ targetUsername: 'carol', kind: 'following' }),
    );
  });

  it('EXTRACT BOTH invokes captureNetwork for BOTH followers and following', async () => {
    await mount();
    await clickTab(/network/i);
    await act(async () => { setSelect(selectByLabel(/target source/i), 'alice'); });
    await clickButton(/extract both/i);
    expect(api.xListening.captureNetwork).toHaveBeenCalledTimes(2);
    const kinds = api.xListening.captureNetwork.mock.calls.map((c: any[]) => c[0].kind).sort();
    expect(kinds).toEqual(['followers', 'following']);
  });

  it('TARGET SOURCE = ALL extracts followers for every captured source', async () => {
    await mount();
    await clickTab(/network/i);
    // Default target is ALL — both @alice and @carol should be extracted.
    await clickButton(/extract followers/i);
    expect(api.xListening.captureNetwork).toHaveBeenCalledTimes(2);
    const targets = api.xListening.captureNetwork.mock.calls.map((c: any[]) => c[0].targetUsername).sort();
    expect(targets).toEqual(['alice', 'carol']);
  });
});
