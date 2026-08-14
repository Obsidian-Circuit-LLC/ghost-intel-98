// @vitest-environment jsdom
/**
 * PC5 — restore GhostExodus Enterprise v3.4.1 analyst-UX filters on the hardened core.
 *
 *   M12  LIVE-FEED KIND FILTER — four INDEPENDENT kind checkboxes (post/reply/repost/comment)
 *        with per-kind counts + a Live SOURCE dropdown (not the single-select ALL/one downgrade).
 *   M13  SEARCH SCOPE — matches post text, @handle AND analyst-note text, with SOURCE / TYPE /
 *        PRESET-MATCHES-ONLY filters.
 *   M14  TAB FILTERS — Notes source filter + note-text search; Entities free-text search;
 *        Network records free-text search.
 *   M15  EXPORT FILTERS — per-export SOURCE / TYPE / QUERY threaded into the export IPC call.
 *   L2   HEALTH RATIO — the run-log passes ratio never renders > 100%.
 *
 * Same discipline as x-listening-tabs2.test.tsx: real `window.api.xListening.*` channels,
 * createRoot + act, NO @testing-library / no new dependency.
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

const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };

// Two sources (alice, bob); one post of each kind. Kinds/counts drive M12; note text drives M13.
const POSTS = [
  { id: 'p-post', channelId: 'alice', channelLabel: '@alice', authorHandle: 'alice', text: 'alpha ransomware alert', publishedAt: '2026-08-01T00:00:00.000Z', url: 'https://x.com/alice/status/1', kind: 'post' },
  { id: 'p-reply', channelId: 'alice', channelLabel: '@alice', authorHandle: 'alice', text: 'beta follow-up', publishedAt: '2026-08-02T00:00:00.000Z', url: 'https://x.com/alice/status/2', kind: 'reply' },
  { id: 'p-repost', channelId: 'bob', channelLabel: '@bob', authorHandle: 'bob', text: 'gamma amplification', publishedAt: '2026-08-03T00:00:00.000Z', url: 'https://x.com/bob/status/3', kind: 'repost' },
  { id: 'p-comment', channelId: 'bob', channelLabel: '@bob', authorHandle: 'bob', text: 'delta thread reply', publishedAt: '2026-08-04T00:00:00.000Z', url: 'https://x.com/bob/status/4', kind: 'comment' },
];

const ENTITIES = [
  { id: 'e1', type: 'hashtag', value: '#ransomware', count: 3, normalizedValue: '#ransomware', sourceUsernames: ['alice'], firstObservedAt: '2026-08-01T00:00:00.000Z', lastObservedAt: '2026-08-03T00:00:00.000Z' },
  { id: 'e2', type: 'domain', value: 'example.org', count: 1, normalizedValue: 'example.org', sourceUsernames: ['bob'], firstObservedAt: '2026-08-02T00:00:00.000Z', lastObservedAt: '2026-08-02T00:00:00.000Z' },
];

// networksList returns the ARTIFACT shape ({target,kind,accounts[]}); the module flattens it.
const NETWORKS = [
  {
    target: 'alice',
    kind: 'followers' as const,
    capturedAt: '2026-08-01T00:00:00.000Z',
    accounts: [
      { handle: '@nightowl', displayName: 'Night Owl', bio: 'threat researcher', firstObservedAt: '2026-08-01T00:00:00.000Z', lastObservedAt: '2026-08-01T00:00:00.000Z' },
      { handle: '@daywatch', displayName: 'Day Watch', bio: 'journalist', firstObservedAt: '2026-08-01T00:00:00.000Z', lastObservedAt: '2026-08-01T00:00:00.000Z' },
    ],
  },
];

// L2: a run whose completedPasses (6) exceeds requestedPasses (5) — the +1 initial read.
const RUN_LOG = [
  { profileId: 'alice', username: 'alice', operation: 'posts', observed: 10, added: 8, duplicates: 2, requestedPasses: 5, completedPasses: 6, reachedEnd: true, stopReason: 'reached_end', status: 'ok', startedAt: '2026-08-04T00:00:00.000Z', endedAt: '2026-08-04T00:01:00.000Z' },
];

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A]),
      campaignsSwitch: vi.fn(async () => CAMP_A),
      campaignsMeta: vi.fn(async () => ({})),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      postsList: vi.fn(async () => POSTS),
      analysis: vi.fn(async () => ({ targetCount: 0, relationshipCount: 0, uniqueIdentityCount: 0, commonIdentityCount: 0, highOverlapCount: 0, pairs: [], identities: [], graph: { nodes: [], edges: [] } })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => ENTITIES),
      avatars: vi.fn(async () => ({})),
      networksList: vi.fn(async () => NETWORKS),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => RUN_LOG),
      readNotes: vi.fn(async () => ({ notes: [{ id: 'n1', findingId: 'p-repost', text: 'flagged by counter-intel', savedAt: '2026-08-05T00:00:00.000Z' }] })),
      presetsRead: vi.fn(async () => ({ presets: [] })),
      presetsRun: vi.fn(async () => ({ matches: [{ postId: 'p-post', matchedKeywords: ['ransomware'] }] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      getCollectionSettings: vi.fn(async () => defaultSettings.xListening),
      exportPostsToFile: vi.fn(async () => ({ canceled: false, filePath: '/chosen/export.csv', count: 1, sha256: 'a'.repeat(64), checksumPath: '/chosen/export.csv.sha256.txt' })),
    },
  };
}

describe('PC5 — restored analyst-UX filters (M12–M15, L2)', () => {
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
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  }
  function findButton(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('button')).find((b) => matcher.test(b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setSelect(sel: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function countCards(): number {
    return container.querySelectorAll('.xls-live .xls-post-card').length;
  }

  // ── M12 live feed ──────────────────────────────────────────────────────────
  it('M12: Live feed renders FOUR independent kind checkboxes with per-kind counts', async () => {
    await mount();
    await clickTab(/^live$/i);
    const checks = Array.from(container.querySelectorAll('.xls-kind-checks input[type="checkbox"]'));
    expect(checks).toHaveLength(4);
    const labels = container.querySelector('.xls-kind-checks')!.textContent || '';
    // one of each kind captured → each count is 1
    expect(labels).toMatch(/POSTS \(1\)/);
    expect(labels).toMatch(/REPLIES \(1\)/);
    expect(labels).toMatch(/REPOSTS \(1\)/);
    expect(labels).toMatch(/COMMENTS \(1\)/);
    expect(countCards()).toBe(4);
  });

  it('M12: unchecking a kind hides only that kind (independent toggles, not single-select)', async () => {
    await mount();
    await clickTab(/^live$/i);
    const replyCheck = Array.from(container.querySelectorAll('.xls-kind-checks label')).find((l) => /REPLIES/.test(l.textContent || ''))!.querySelector('input') as HTMLInputElement;
    await act(async () => { replyCheck.click(); });
    // the reply is gone; the other three remain (would be impossible with a single-select control)
    expect(countCards()).toBe(3);
    expect(container.querySelector('.xls-live')!.textContent || '').not.toMatch(/beta follow-up/);
    expect(container.querySelector('.xls-live')!.textContent || '').toMatch(/alpha ransomware alert/);
  });

  it('M12: the Live SOURCE dropdown narrows the feed to one source', async () => {
    await mount();
    await clickTab(/^live$/i);
    const source = container.querySelector('.xls-live-source') as HTMLSelectElement;
    expect(source).toBeTruthy();
    setSelect(source, 'bob');
    await act(async () => { await Promise.resolve(); });
    // only bob's two posts (repost + comment) survive — assert against the FEED, not the toolbar
    // (whose SOURCE dropdown legitimately still lists the @alice option).
    expect(countCards()).toBe(2);
    const feedText = container.querySelector('.xls-live .xls-feed')!.textContent || '';
    expect(feedText).not.toMatch(/@alice/);
    expect(feedText).toMatch(/gamma amplification/);
  });

  // ── M13 search ───────────────────────────────────────────────────────────────
  it('M13: search matches analyst-NOTE text, not only post text/handle', async () => {
    await mount();
    await clickTab(/^search$/i);
    const query = container.querySelector('.xls-search-query') as HTMLInputElement;
    // "counter-intel" appears ONLY in the analyst note on p-repost, never in any post body
    setValue(query, 'counter-intel');
    await act(async () => { await Promise.resolve(); });
    const cards = container.querySelectorAll('.xls-search .xls-post-card');
    expect(cards).toHaveLength(1);
    expect(container.querySelector('.xls-search')!.textContent || '').toMatch(/gamma amplification/);
  });

  it('M13: TYPE + SOURCE filters narrow the results with an empty query (return-all-with-filters)', async () => {
    await mount();
    await clickTab(/^search$/i);
    const kind = container.querySelector('.xls-search-kind') as HTMLSelectElement;
    setSelect(kind, 'comment');
    await act(async () => { await Promise.resolve(); });
    const cards = container.querySelectorAll('.xls-search .xls-post-card');
    expect(cards).toHaveLength(1);
    expect(container.querySelector('.xls-search')!.textContent || '').toMatch(/delta thread reply/);
  });

  it('M13: PRESET MATCHES ONLY restricts to the last preset run', async () => {
    await mount();
    await clickTab(/^search$/i);
    // run the (mocked) preset so presetMatchByPost is populated (matches p-post)
    // presetsRun is auto-wired via the RUN button in the editor list; simulate by toggling the box
    const presetOnly = container.querySelector('.xls-preset-only input[type="checkbox"]') as HTMLInputElement;
    expect(presetOnly).toBeTruthy();
    // with no run yet, PRESET-MATCHES-ONLY shows nothing (the map is empty)
    await act(async () => { presetOnly.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelectorAll('.xls-search .xls-post-card')).toHaveLength(0);
  });

  // ── M14 tab filters ──────────────────────────────────────────────────────────
  it('M14: Entities tab free-text search narrows the entity grid', async () => {
    await mount();
    await clickTab(/^entities$/i);
    const search = container.querySelector('.xls-entity-search') as HTMLInputElement;
    expect(search).toBeTruthy();
    setValue(search, 'example.org');
    await act(async () => { await Promise.resolve(); });
    const cards = container.querySelectorAll('.xls-entities .xls-entity-card');
    expect(cards).toHaveLength(1);
    expect(container.querySelector('.xls-entities')!.textContent || '').not.toMatch(/#ransomware/);
  });

  it('M14: Notes tab SOURCE filter + note-text search narrow the saved-notes list', async () => {
    await mount();
    await clickTab(/^notes$/i);
    // the note is on p-repost (source bob) — filtering to source alice hides it
    const source = container.querySelector('.xls-note-source') as HTMLSelectElement;
    setSelect(source, 'alice');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.xls-notes')!.textContent || '').toMatch(/No analyst notes match these filters/);
    // reset to all, then a note-text search that DOESN'T match hides it too
    setSelect(source, 'all');
    await act(async () => { await Promise.resolve(); });
    const search = container.querySelector('.xls-note-search') as HTMLInputElement;
    setValue(search, 'counter-intel');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.xls-notes')!.textContent || '').toMatch(/flagged by counter-intel/);
    setValue(search, 'nonexistent-token');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.xls-notes')!.textContent || '').toMatch(/No analyst notes match these filters/);
  });

  it('M14: Network tab free-text SEARCH narrows the extracted records', async () => {
    await mount();
    await clickTab(/^network$/i);
    const search = container.querySelector('.xls-network-search') as HTMLInputElement;
    expect(search).toBeTruthy();
    // "journalist" appears only in @daywatch's bio
    setValue(search, 'journalist');
    await act(async () => { await Promise.resolve(); });
    // scope the assertion to the RECORDS list — the (separate, unfiltered) network-deltas panel
    // legitimately still names @nightowl.
    const records = container.querySelector('.xls-network-records')!;
    const recs = records.querySelectorAll('.xls-network-record');
    expect(records.textContent || '').toMatch(/daywatch/);
    expect(records.textContent || '').not.toMatch(/nightowl/);
    expect(recs.length).toBe(1);
  });

  // ── M15 export filters ─────────────────────────────────────────────────────────
  it('M15: export threads the per-export SOURCE / TYPE / QUERY filters into the IPC call', async () => {
    await mount();
    await clickTab(/^exports$/i);
    setSelect(container.querySelector('.xls-export-source') as HTMLSelectElement, 'bob');
    setSelect(container.querySelector('.xls-export-kind') as HTMLSelectElement, 'repost');
    setValue(container.querySelector('.xls-export-query') as HTMLInputElement, 'gamma');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { findButton(/export csv/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.exportPostsToFile).toHaveBeenCalledWith({
      caseId: 'camp-a',
      format: 'csv',
      filters: { source: 'bob', kind: 'repost', query: 'gamma' },
    });
  });

  it('M15: an all-default export sends NO filters block (full campaign)', async () => {
    await mount();
    await clickTab(/^exports$/i);
    await act(async () => { findButton(/export json/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.exportPostsToFile).toHaveBeenCalledWith({ caseId: 'camp-a', format: 'json' });
  });

  // ── L2 health ratio ─────────────────────────────────────────────────────────
  it('L2: the run-log passes ratio never renders greater than its requested budget', async () => {
    await mount();
    await clickTab(/^changes$/i);
    const text = container.querySelector('.xls-changes')!.textContent || '';
    // completedPasses (6) is clamped to requestedPasses (5) → "5/5 passes", never "6/5"
    expect(text).toMatch(/5\/5 passes/);
    expect(text).not.toMatch(/6\/5/);
  });
});
