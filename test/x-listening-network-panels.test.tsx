// @vitest-environment jsdom
/**
 * Task C2 (part A) — Network tab NON-GRAPH panels to parity.
 *
 * Given a seeded `computeNetworkAnalysis` result + seeded `networksList`, the Network tab must:
 *   1. show the 4 parity stat cards with the right counts (SELECTED FOLLOWERS / SELECTED
 *      FOLLOWING from the captured network rows; COMMON IDENTITIES / HIGH OVERLAP from analysis);
 *   2. render the MULTI-TARGET OVERLAP table filtered by the MINIMUM CONNECTED TARGETS input;
 *   3. open a COMMON FOLLOWERS chip via E1's `openInX('identity', …)`;
 *   4. open an EXTRACTED NETWORK RECORD via E1's `openInX('profile', …)`.
 *
 * Same createRoot + act discipline (no @testing-library) as x-listening-network-extract.test.tsx.
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
  id: 'post-a', channelId: 'alice', channelLabel: '@alice', authorHandle: 'alice',
  text: 'hello', publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://x.com/alice/status/1', kind: 'post',
};
const POST_CAROL = {
  id: 'post-c', channelId: 'carol', channelLabel: '@carol', authorHandle: 'carol',
  text: 'world', publishedAt: '2026-08-02T00:00:00.000Z',
  url: 'https://x.com/carol/status/2', kind: 'post',
};

// Two targets (alice, carol); bob follows both, dave follows alice only. eve was seen in an
// earlier scan of alice's followers but NOT the latest (a conservative "not seen" delta candidate).
const NETWORKS = [
  {
    target: 'alice', kind: 'followers', capturedAt: '2026-08-03T00:00:00.000Z',
    accounts: [
      { handle: 'bob', displayName: 'Bob', bio: 'hacker', firstObservedAt: '2026-08-01T00:00:00.000Z', lastObservedAt: '2026-08-03T00:00:00.000Z' },
      { handle: 'dave', displayName: 'Dave', bio: 'analyst', firstObservedAt: '2026-08-03T00:00:00.000Z', lastObservedAt: '2026-08-03T00:00:00.000Z' },
      { handle: 'eve', displayName: 'Eve', bio: 'ghost', firstObservedAt: '2026-08-01T00:00:00.000Z', lastObservedAt: '2026-08-01T00:00:00.000Z' },
    ],
  },
  {
    target: 'carol', kind: 'followers', capturedAt: '2026-08-03T00:00:00.000Z',
    accounts: [
      { handle: 'bob', displayName: 'Bob', bio: 'hacker', firstObservedAt: '2026-08-02T00:00:00.000Z', lastObservedAt: '2026-08-03T00:00:00.000Z' },
    ],
  },
];

// Seeded computeNetworkAnalysis output (full NetworkAnalysis shape crosses the boundary; the
// renderer casts it). connectedTargets are set to exercise the MINIMUM CONNECTED TARGETS filter.
const ANALYSIS = {
  targetCount: 2,
  relationshipCount: 4,
  uniqueIdentityCount: 3,
  commonIdentityCount: 1,
  highOverlapCount: 1,
  pairs: [
    {
      profileAId: 'alice', profileA: 'alice', profileBId: 'carol', profileB: 'carol',
      commonFollowers: ['bob'], commonFollowing: [], commonAny: ['bob'],
      commonFollowerCount: 1, commonFollowingCount: 0, commonAnyCount: 1,
    },
  ],
  identities: [
    { username: 'bob', displayName: 'Bob', avatar: '', followerOf: ['alice', 'carol'], followingFrom: [], connectedTargets: 3, overlapScore: 100 },
    { username: 'dave', displayName: 'Dave', avatar: '', followerOf: ['alice'], followingFrom: ['carol'], connectedTargets: 2, overlapScore: 60 },
  ],
  graph: { nodes: [], edges: [] },
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
      analysis: vi.fn(async () => ANALYSIS),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      captureTimeline: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] })),
      captureNetwork: vi.fn(async () => ({ blocked: false, kind: 'followers', target: '@x', observed: 0, added: 0, completedPasses: 1, reachedEnd: true })),
      networksList: vi.fn(async () => NETWORKS),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      presetsRead: vi.fn(async () => ({ presets: [] })),
      openInX: vi.fn(async () => ({ opened: true, url: 'https://x.com/bob' })),
      exportNetworkToFile: vi.fn(async () => ({ canceled: false, count: 4, filePath: '/x.csv', sha256: 'deadbeef00' })),
      mediaRead: vi.fn(async () => null),
    },
  };
}

function setXListeningSettings(patch: Partial<AppSettings['xListening']>): void {
  useSettings.setState({
    settings: { ...defaultSettings, xListening: { ...defaultSettings.xListening, ...patch } },
  });
}

describe('X Listening Station — Network tab non-graph panels (Task C2a)', () => {
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
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  }
  function findTab(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('.xls-tab')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`tab not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickTab(matcher: RegExp) {
    await act(async () => { findTab(matcher).click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  }
  /** Read the numeric <strong> of the stat card whose <span> label matches. */
  function statCardValue(label: RegExp): string {
    const card = Array.from(container.querySelectorAll('.xls-stat')).find((c) =>
      label.test(c.querySelector('span')?.textContent || ''),
    );
    if (!card) throw new Error(`stat card not found: ${label}`);
    return card.querySelector('strong')?.textContent || '';
  }

  it('renders the 4 parity stat cards with the right counts', async () => {
    await mount();
    await clickTab(/network/i);
    // SELECTED FOLLOWERS = all captured follower rows across targets (bob+dave+eve @alice, bob @carol = 4).
    expect(statCardValue(/SELECTED FOLLOWERS/i)).toBe('4');
    expect(statCardValue(/SELECTED FOLLOWING/i)).toBe('0');
    expect(statCardValue(/COMMON IDENTITIES/i)).toBe('1');
    expect(statCardValue(/HIGH OVERLAP/i)).toBe('1');
  });

  it('MULTI-TARGET OVERLAP table filters rows by the MINIMUM CONNECTED TARGETS input', async () => {
    await mount();
    await clickTab(/network/i);
    // Default min = 2 → both identities (connectedTargets 3 and 2) show.
    expect(container.querySelectorAll('.xls-overlap-row').length).toBe(2);
    // Raise to 3 → only bob (connectedTargets 3) survives.
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '3');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelectorAll('.xls-overlap-row').length).toBe(1);
  });

  it('a COMMON FOLLOWERS chip opens the identity in X via openInX', async () => {
    await mount();
    await clickTab(/network/i);
    const chip = Array.from(container.querySelectorAll('.xls-identity-chip')).find((b) =>
      /@bob/i.test(b.textContent || ''),
    ) as HTMLButtonElement | undefined;
    expect(chip).toBeTruthy();
    await act(async () => { chip!.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(api.xListening.openInX).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'identity', ref: 'bob' }),
    );
  });

  it('an EXTRACTED NETWORK RECORD OPEN PROFILE opens the profile in X via openInX', async () => {
    await mount();
    await clickTab(/network/i);
    const openBtn = Array.from(container.querySelectorAll('.xls-network-record button')).find((b) =>
      /open profile/i.test(b.textContent || ''),
    ) as HTMLButtonElement | undefined;
    expect(openBtn).toBeTruthy();
    await act(async () => { openBtn!.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(api.xListening.openInX).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'profile' }),
    );
  });

  it('excludes synthetic/demo network rows from the SELECTED counts and the records list', async () => {
    // Seed one demo/seeded follower (synthetic:true, as demo.ts stamps) alongside the real rows.
    // It must NOT inflate SELECTED FOLLOWERS (stays 4, matching the analysis/CSV surfaces) and must
    // NOT appear as an EXTRACTED NETWORK RECORD.
    const withSynthetic = [
      {
        target: 'alice', kind: 'followers', capturedAt: '2026-08-03T00:00:00.000Z',
        accounts: [
          ...NETWORKS[0].accounts,
          { handle: 'mallory', displayName: 'Mallory', bio: 'demo', firstObservedAt: '2026-08-03T00:00:00.000Z', lastObservedAt: '2026-08-03T00:00:00.000Z', synthetic: true },
        ],
      },
      NETWORKS[1],
    ];
    api.xListening.networksList = vi.fn(async () => withSynthetic);
    await mount();
    await clickTab(/network/i);
    // Still 4 — the synthetic mallory row is dropped, matching COMMON IDENTITIES / HIGH OVERLAP / CSV.
    expect(statCardValue(/SELECTED FOLLOWERS/i)).toBe('4');
    // No EXTRACTED NETWORK RECORD carries the demo handle.
    const recordsText = Array.from(container.querySelectorAll('.xls-network-record'))
      .map((r) => r.textContent || '')
      .join(' ');
    expect(/mallory/i.test(recordsText)).toBe(false);
  });

  it('renders the RECENT NETWORK DELTAS panel with the conservative caveat', async () => {
    await mount();
    await clickTab(/network/i);
    const panel = Array.from(container.querySelectorAll('.xls-panel')).find((p) =>
      /RECENT NETWORK DELTAS/i.test(p.textContent || ''),
    );
    expect(panel).toBeTruthy();
    // The conservative caveat must be present (not proof of an unfollow).
    expect(/not proof of an unfollow/i.test(panel?.textContent || '')).toBe(true);
    // eve (seen 08-01 but not the latest 08-03 scan of alice) is a "not seen" delta candidate.
    expect(container.querySelectorAll('.xls-delta-row').length).toBeGreaterThan(0);
  });
});
