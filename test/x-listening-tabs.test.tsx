// @vitest-environment jsdom
/**
 * Task 14 — X Listening Station tabs: dashboard / live / sources / network / entities.
 *
 * Each tab is wired to a REAL `window.api.xListening.*` channel — no hollow panels (the
 * v3.24.2 lesson). Once a campaign is active, the shell loads the campaign's PERSISTED posts
 * (`postsList` — Task 14's wiring-gap fix; `captureTimeline` only returns one call's fresh
 * batch), the derived network analysis (`analysis`), collection health (`health`), and the
 * entity rollup (`entities`) in parallel. The Live/Sources tabs' Capture action drives the real
 * `captureTimeline` channel and reloads `postsList` afterward so the view reflects what secure-fs
 * actually holds, not a stale renderer-only cache.
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
import { defaultSettings } from '@shared/types';

const CAMP = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };

const POST_A = {
  id: 'post-a',
  channelId: 'alice',
  channelLabel: '@alice',
  authorHandle: 'alice',
  text: 'hello #osint from @bob',
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://x.com/alice/status/1',
  kind: 'post',
  metrics: { replies: 1, reposts: 2, likes: 3, views: 40 },
  metricsRaw: { replies: '1', reposts: '2', likes: '3', views: '40' },
  evidenceHash: 'abc123def456',
};

const POST_DEMO = {
  id: 'post-demo',
  channelId: 'demoacct',
  channelLabel: '@demoacct',
  authorHandle: 'demoacct',
  text: 'seeded demo post',
  publishedAt: '2026-07-01T00:00:00.000Z',
  url: 'https://x.com/demoacct/status/9',
  kind: 'post',
  synthetic: true,
};

const ANALYSIS = {
  generatedAt: '2026-08-01T00:00:00.000Z',
  targetCount: 2,
  relationshipCount: 5,
  uniqueIdentityCount: 3,
  commonIdentityCount: 1,
  highOverlapCount: 1,
  pairs: [
    {
      profileAId: 'alice',
      profileA: 'alice',
      profileBId: 'carol',
      profileB: 'carol',
      commonFollowerCount: 2,
      commonFollowingCount: 1,
      commonAnyCount: 3,
    },
  ],
  identities: [
    {
      username: 'shared1',
      displayName: 'Shared One',
      connectedTargets: 2,
      overlapScore: 80,
      followerOf: ['alice'],
      followingFrom: ['carol'],
    },
  ],
  graph: {
    nodes: [
      { id: 't:alice', type: 'target', label: '@alice', username: 'alice' },
      {
        id: 'i:shared1',
        type: 'identity',
        label: '@shared1',
        username: 'shared1',
        score: 80,
        connectedTargets: 2,
      },
    ],
    edges: [{ id: 'e1', source: 't:alice', target: 'i:shared1', relationship: 'follower' }],
  },
};

const ENTITY_ROW = {
  id: 'mention:bob',
  type: 'mention',
  value: '@bob',
  normalizedValue: 'bob',
  postIds: ['post-a'],
  sourceUsernames: ['alice'],
  firstObservedAt: '2026-08-01T00:00:00.000Z',
  lastObservedAt: '2026-08-01T00:00:00.000Z',
  count: 1,
};

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP]),
      campaignsCreate: vi.fn(),
      campaignsSwitch: vi.fn(async () => CAMP),
      campaignsUpdate: vi.fn(),
      campaignsDelete: vi.fn(),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => [POST_A]),
      analysis: vi.fn(async () => ANALYSIS),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => [ENTITY_ROW]),
      captureTimeline: vi.fn(async () => ({ blocked: false, added: 1, skipped: 0, posts: [POST_A] })),
      // Task 15: loadInsights also fetches these alongside posts/analysis/health/entities.
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      networkEvents: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => null),
      presetsRead: vi.fn(async () => ({ presets: [] })),
    },
  };
}

describe('X Listening Station tabs (Task 14)', () => {
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    useSettings.setState({ settings: null });
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => {
      root.render(<XListeningModule />);
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  }
  function findTab(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('.xls-tab')).find((b) =>
      matcher.test(b.getAttribute('data-tab') || b.textContent || ''),
    );
    if (!hit) throw new Error(`tab not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickTab(matcher: RegExp) {
    await act(async () => {
      findTab(matcher).click();
    });
    await act(async () => { await Promise.resolve(); });
  }
  function findButton(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('button')).find((b) =>
      matcher.test(b.getAttribute('data-tab') || b.textContent || ''),
    );
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('on mount with an active campaign, loads posts/analysis/health/entities via the real channels', async () => {
    await mount();
    expect(api.xListening.postsList).toHaveBeenCalledWith('camp-a');
    expect(api.xListening.analysis).toHaveBeenCalledWith('camp-a');
    expect(api.xListening.health).toHaveBeenCalledWith('camp-a');
    expect(api.xListening.entities).toHaveBeenCalledWith('camp-a');
  });

  it('no insight channel fires when no campaign is active (never a hollow fetch of nothing)', async () => {
    api.xListening.campaignsList.mockResolvedValue([]);
    await mount();
    expect(api.xListening.postsList).not.toHaveBeenCalled();
    expect(api.xListening.analysis).not.toHaveBeenCalled();
    expect(api.xListening.health).not.toHaveBeenCalled();
    expect(api.xListening.entities).not.toHaveBeenCalled();
  });

  it('renders all five tabs, dashboard active by default', async () => {
    await mount();
    expect(findTab(/^dashboard$/i).className).toContain('xls-tab-active');
    for (const label of [/^dashboard$/i, /^live$/i, /^sources$/i, /^network$/i, /^entities$/i]) {
      expect(findTab(label)).toBeTruthy();
    }
  });

  it('dashboard tab shows real stat counts derived from the loaded data (not fabricated)', async () => {
    await mount();
    const text = container.textContent || '';
    expect(text).toMatch(/CAPTURED POSTS/i);
    expect(text).toMatch(/NETWORK IDENTITIES/i);
    const grid = container.querySelector('.xls-stat-grid');
    expect(grid?.textContent).toContain('3'); // analysis.uniqueIdentityCount
  });

  it('COLLECTION HEALTH renders the restored per-target counts + oldest-post + IDLE status (not just @user/status)', async () => {
    // FB1 review: the postCount/followerCount/followingCount/oldestPostAt columns cross the IPC
    // boundary but were dropped by the renderer's XHealthRow. Feed a NON-EMPTY health payload (a
    // real target + a never-collected IDLE one) and assert the columns actually render.
    api.xListening.health = vi.fn(async () => [
      { profileId: 'p1', username: 'bob', status: 'HEALTHY', postCount: 42, followerCount: 7, followingCount: 3, oldestPostAt: '2026-08-01T12:00:00.000Z' },
      { profileId: 'p2', username: 'never', status: 'IDLE', postCount: 0, followerCount: 0, followingCount: 0, oldestPostAt: null },
    ]) as typeof api.xListening.health;
    await mount();
    const text = container.textContent || '';
    expect(text).toMatch(/42 posts/);
    expect(text).toMatch(/7 followers/);
    expect(text).toMatch(/3 following/);
    expect(text).toMatch(/oldest 2026-08-01/);
    expect(text).toMatch(/IDLE/);
  });

  it('live tab lists the persisted captured posts from postsList (not hollow)', async () => {
    await mount();
    await clickTab(/^live$/i);
    expect(container.textContent || '').toMatch(/hello #osint from @bob/);
  });

  it('live tab Capture Timeline calls the real captureTimeline channel and reloads postsList', async () => {
    await mount();
    await clickTab(/^live$/i);
    const input = container.querySelector('.xls-live-target') as HTMLInputElement;
    await act(async () => setInputValue(input, 'newtarget'));

    api.xListening.postsList.mockClear();
    await act(async () => {
      findButton(/capture timeline/i).click();
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.captureTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'camp-a', channelId: 'newtarget', targetUsername: 'newtarget' }),
    );
    // A stale renderer-only cache of the one capture batch is never trusted — the persisted
    // list is re-read from the real channel after a successful capture.
    expect(api.xListening.postsList).toHaveBeenCalledWith('camp-a');
  });

  it('a blocked capture surfaces the reason and does NOT reload the post list', async () => {
    api.xListening.captureTimeline.mockResolvedValueOnce({
      blocked: true,
      reason: 'X is not connected for this campaign.',
      added: 0,
      skipped: 0,
      posts: [],
    });
    await mount();
    await clickTab(/^live$/i);
    const input = container.querySelector('.xls-live-target') as HTMLInputElement;
    await act(async () => setInputValue(input, 'target2'));

    api.xListening.postsList.mockClear();
    await act(async () => {
      findButton(/capture timeline/i).click();
    });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent || '').toMatch(/X is not connected for this campaign\./);
    expect(api.xListening.postsList).not.toHaveBeenCalled();
  });

  it('Capture Timeline requires a non-empty target — never invokes with a blank username', async () => {
    await mount();
    await clickTab(/^live$/i);
    await act(async () => {
      findButton(/capture timeline/i).click();
    });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.captureTimeline).not.toHaveBeenCalled();
  });

  it('sources tab derives distinct targets from the captured posts', async () => {
    await mount();
    await clickTab(/^sources$/i);
    expect(container.textContent || '').toMatch(/@alice/);
  });

  it('sources tab also drives captureTimeline (same real wiring as live)', async () => {
    await mount();
    await clickTab(/^sources$/i);
    const input = container.querySelector('.xls-source-target') as HTMLInputElement;
    await act(async () => setInputValue(input, 'thirdtarget'));
    await act(async () => {
      findButton(/capture timeline/i).click();
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.captureTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'camp-a', channelId: 'thirdtarget', targetUsername: 'thirdtarget' }),
    );
  });

  it('network tab renders the real analysis graph/stats from the analysis channel', async () => {
    await mount();
    await clickTab(/^network$/i);
    const text = container.textContent || '';
    expect(text).toMatch(/shared1/);
    expect(text).toMatch(/COMMON FOLLOWER/i);
    // The COMMON NETWORK MIND MAP (Task C2b) renders the analysis graph as an interactive SVG:
    // the @alice target + @shared1 identity node labels are drawn, and the panel title is present.
    expect(text).toMatch(/COMMON NETWORK MIND MAP/i);
    expect(container.querySelector('svg.xls-network-graph')).toBeTruthy();
    expect(text).toMatch(/@shared1/);
  });

  it('entities tab lists the real entity rollup from the entities channel', async () => {
    await mount();
    await clickTab(/^entities$/i);
    expect(container.textContent || '').toMatch(/@bob/);
  });

  it('entities tab type filter narrows the visible list (client-side over real fetched data)', async () => {
    api.xListening.entities.mockResolvedValue([
      ENTITY_ROW,
      { ...ENTITY_ROW, id: 'hashtag:osint', type: 'hashtag', value: '#osint', count: 4 },
    ]);
    await mount();
    await clickTab(/^entities$/i);
    expect(container.textContent || '').toMatch(/#osint/);

    const select = container.querySelector('.xls-entities select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'mention');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent || '').not.toMatch(/#osint/);
    expect(container.textContent || '').toMatch(/@bob/);
  });

  it('DEMO marker appears once a fetched post carries synthetic:true (real data, never fabricated)', async () => {
    api.xListening.postsList.mockResolvedValue([POST_A, POST_DEMO]);
    await mount();
    expect(container.querySelector('.xls-marker-demo')?.textContent).toBe('DEMO DATA LOADED');
  });

  it('switching to a campaign with no data yet reloads insights and shows honest empty states', async () => {
    const CAMP_B = { id: 'camp-b', name: 'Beta Watch', createdAt: 2, updatedAt: 2 };
    api.xListening.campaignsList.mockResolvedValue([CAMP, CAMP_B]);
    api.xListening.campaignsSwitch.mockImplementation(async (id: string) =>
      id === 'camp-b' ? CAMP_B : CAMP,
    );
    await mount();

    // The empty-campaign mocks must be armed BEFORE the switch fires — the campaign-id effect
    // that drives loadInsights races the click, so setting them after would race the real fetch.
    api.xListening.postsList.mockImplementation(async (id: string) =>
      id === 'camp-b' ? [] : [POST_A],
    );
    api.xListening.entities.mockImplementation(async (id: string) => (id === 'camp-b' ? [] : [ENTITY_ROW]));

    const select = container.querySelector('[aria-label="Active campaign"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'camp-b');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.postsList).toHaveBeenCalledWith('camp-b');
    await clickTab(/^live$/i);
    expect(container.textContent || '').toMatch(/No records match|No posts captured/i);
  });
});
