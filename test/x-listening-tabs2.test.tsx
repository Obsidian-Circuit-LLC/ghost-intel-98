// @vitest-environment jsdom
/**
 * Task 15 — X Listening Station tabs: changes / search / notes / exports / campaigns / system.
 *
 * Same discipline as x-listening-tabs.test.tsx (Task 14): every control drives a REAL
 * `window.api.xListening.*` channel — no hollow panels (the v3.24.2 lesson). Settings-writing
 * controls (collect toggles, archiveCycles, and — via the shared header control — clearnet)
 * go through the REAL `useSettings` store's `patch`, which calls `window.api.settings.update`
 * (mirrors x-listening-shell.test.tsx's pattern for the clearnet toggle).
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
import { confirmDialog } from '../src/renderer/state/dialogs';
import { defaultSettings, type AppSettings } from '@shared/types';

const confirmDialogMock = vi.mocked(confirmDialog);

const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };
const CAMP_B = { id: 'camp-b', name: 'Beta Watch', createdAt: 2, updatedAt: 2 };

const POST_A = {
  id: 'post-a',
  channelId: 'alice',
  channelLabel: '@alice',
  authorHandle: 'alice',
  text: 'hello #osint from @bob',
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://x.com/alice/status/1',
  kind: 'post',
};

const POST_B = {
  id: 'post-b',
  channelId: 'carol',
  channelLabel: '@carol',
  authorHandle: 'carol',
  text: 'a totally unrelated update',
  publishedAt: '2026-08-02T00:00:00.000Z',
  url: 'https://x.com/carol/status/2',
  kind: 'post',
};

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
    {
      handle: '@long_standing',
      displayName: 'Long Standing',
      firstObservedAt: '2026-01-01T00:00:00.000Z',
      lastObservedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
};

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A, CAMP_B]),
      campaignsCreate: vi.fn(),
      campaignsSwitch: vi.fn(async (id: string) => (id === CAMP_B.id ? CAMP_B : CAMP_A)),
      campaignsUpdate: vi.fn(),
      campaignsDelete: vi.fn(async () => undefined),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => [POST_A, POST_B]),
      analysis: vi.fn(async () => ({
        targetCount: 0, relationshipCount: 0, uniqueIdentityCount: 0, commonIdentityCount: 0,
        highOverlapCount: 0, pairs: [], identities: [], graph: { nodes: [], edges: [] },
      })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      captureTimeline: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] })),
      networksList: vi.fn(async () => [NETWORK_ARTIFACT]),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [{ findingId: 'post-a', text: 'existing note', savedAt: '2026-08-01T00:00:00.000Z' }] })),
      saveNote: vi.fn(async (req: { findingId: string; text: string }) => ({
        notes: [{ findingId: req.findingId, text: req.text, savedAt: '2026-08-05T00:00:00.000Z' }],
      })),
      removeNote: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: 'cursor-123', cycles: 3, lastRunAt: '2026-08-04T00:00:00.000Z' })),
      archiveRun: vi.fn(async () => ({
        cyclesRun: 1, totalAdded: 2, blocked: false, cancelled: false, posts: [],
        state: { cursor: 'cursor-456', cycles: 4, lastRunAt: '2026-08-05T00:00:00.000Z' },
      })),
      loadDemoData: vi.fn(async () => ({ added: 6, skipped: 0, posts: [], networks: [] })),
      exportPostsToFile: vi.fn(async () => ({
        canceled: false, filePath: '/chosen/export.json', count: 2, sha256: 'a'.repeat(64), checksumPath: '/chosen/export.json.sha256.txt',
      })),
      exportNetworkToFile: vi.fn(async () => ({
        canceled: false, filePath: '/chosen/networks.csv', count: 2, sha256: 'b'.repeat(64), checksumPath: '/chosen/networks.csv.sha256.txt',
      })),
      presetsRead: vi.fn(async () => ({
        presets: [{ id: 'preset-1', name: 'OSINT watch', keywords: ['osint'], mode: 'any', caseSensitive: false, profileIds: [], enabled: true, updatedAt: '2026-08-01T00:00:00.000Z' }],
      })),
      presetsSave: vi.fn(async (req: { id: string; name: string; keywords: string[] }) => ({
        presets: [{ id: req.id, name: req.name, keywords: req.keywords, mode: 'any', caseSensitive: false, profileIds: [], enabled: true, updatedAt: '2026-08-05T00:00:00.000Z' }],
      })),
      presetsRun: vi.fn(async () => ({ matches: [{ postId: 'post-a', matchedKeywords: ['osint'] }] })),
      presetsRemove: vi.fn(async () => ({ presets: [] })),
    },
  };
}

function setXListeningSettings(patch: Partial<AppSettings['xListening']>): void {
  useSettings.setState({
    settings: { ...defaultSettings, xListening: { ...defaultSettings.xListening, ...patch } },
  });
}

/** Wires window.api.settings.update to a REAL Zustand-backed fake so `patchSettings` round-trips
 *  exactly like the app does (mirrors x-listening-shell.test.tsx's clearnet-toggle tests). */
function withSettingsUpdate(api: ReturnType<typeof makeApi>) {
  const settingsUpdate = vi.fn(async (patch: Partial<AppSettings>) => {
    const cur = useSettings.getState().settings as AppSettings;
    const next = { ...cur, ...patch, xListening: { ...cur.xListening, ...patch.xListening } };
    useSettings.setState({ settings: next });
    return next;
  });
  (globalThis as any).window.api = { ...api, settings: { update: settingsUpdate } };
  return settingsUpdate;
}

describe('X Listening Station tabs (Task 15)', () => {
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
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
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
  function findButton(root: ParentNode, matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(root.querySelectorAll('button')).find((b) => matcher.test(b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('a post with mediaRefs resolves them via the real mediaRead channel and renders a thumbnail', async () => {
    const mediaRead = vi.fn(async (req: { caseId: string; ref: string }) => {
      expect(req).toEqual({ caseId: 'camp-a', ref: `x-media/${'c'.repeat(64)}` });
      return 'data:image/png;base64,AAAA';
    });
    api.xListening.postsList.mockResolvedValue([{ ...POST_A, mediaRefs: [`x-media/${'c'.repeat(64)}`] }]);
    (api.xListening as unknown as { mediaRead: typeof mediaRead }).mediaRead = mediaRead;
    await mount();
    await clickTab(/^live$/i);
    await act(async () => { await Promise.resolve(); });
    expect(mediaRead).toHaveBeenCalled();
    const img = container.querySelector('.xls-media-strip img') as HTMLImageElement | null;
    expect(img?.src).toBe('data:image/png;base64,AAAA');
  });

  it('a mediaRead miss (null) renders no broken-image element, never throws', async () => {
    api.xListening.postsList.mockResolvedValue([{ ...POST_A, mediaRefs: [`x-media/${'d'.repeat(64)}`] }]);
    (api.xListening as unknown as { mediaRead: (...a: unknown[]) => Promise<null> }).mediaRead = vi.fn(async () => null);
    await mount();
    await clickTab(/^live$/i);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.xls-media-strip img')).toBeFalsy();
  });

  it('renders all eleven tabs, including the six new Task-15 tabs', async () => {
    await mount();
    for (const label of [/^dashboard$/i, /^live$/i, /^sources$/i, /^network$/i, /^entities$/i,
      /^changes$/i, /^search$/i, /^notes$/i, /^exports$/i, /^campaigns$/i, /^system$/i]) {
      expect(findTab(label)).toBeTruthy();
    }
  });

  // ── changes ────────────────────────────────────────────────────────────────
  it('changes tab lists real flattened network accounts from networksList and marks a first-scan account NEW', async () => {
    await mount();
    await clickTab(/^changes$/i);
    expect(api.xListening.networksList).toHaveBeenCalledWith('camp-a');
    const text = container.textContent || '';
    expect(text).toMatch(/@brand_new/);
    expect(text).toMatch(/@long_standing/);
    const newMarker = container.querySelector('.xls-marker-new');
    expect(newMarker?.closest('.xls-source-row')?.textContent).toMatch(/@brand_new/);
    // the long-standing account (first != last observed) never gets a NEW marker
    const rows = Array.from(container.querySelectorAll('.xls-changes .xls-source-row'));
    const longStandingRow = rows.find((r) => (r.textContent || '').includes('@long_standing'));
    expect(longStandingRow?.querySelector('.xls-marker-new')).toBeFalsy();
  });

  it('changes tab shows an honest empty state with no captured networks', async () => {
    api.xListening.networksList.mockResolvedValue([]);
    await mount();
    await clickTab(/^changes$/i);
    expect(container.textContent || '').toMatch(/No follower\/following accounts captured/i);
  });

  // ── search ─────────────────────────────────────────────────────────────────
  it('search tab filters the persisted posts client-side by text/handle (local search, no server round-trip)', async () => {
    await mount();
    await clickTab(/^search$/i);
    const input = container.querySelector('.xls-search-query') as HTMLInputElement;
    await act(async () => setInputValue(input, 'osint'));
    const text = container.textContent || '';
    expect(text).toMatch(/hello #osint from @bob/);
    expect(text).not.toMatch(/totally unrelated update/);
  });

  it('search tab with an empty query shows a hint, not every post (never a hollow full dump)', async () => {
    await mount();
    await clickTab(/^search$/i);
    expect(container.textContent || '').toMatch(/type to search/i);
  });

  it('search tab lists real saved presets from presetsRead', async () => {
    await mount();
    await clickTab(/^search$/i);
    expect(api.xListening.presetsRead).toHaveBeenCalledWith('camp-a');
    expect(container.textContent || '').toMatch(/OSINT watch/);
  });

  it('search tab Save Preset drives the real presetsSave channel with the current query as keywords', async () => {
    await mount();
    await clickTab(/^search$/i);
    const query = container.querySelector('.xls-search-query') as HTMLInputElement;
    await act(async () => setInputValue(query, 'foo, bar'));
    const name = container.querySelector('.xls-preset-name') as HTMLInputElement;
    await act(async () => setInputValue(name, 'My Preset'));
    await act(async () => { findButton(container, /save preset/i).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.presetsSave).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'camp-a', name: 'My Preset', keywords: ['foo', 'bar'] }),
    );
  });

  it('search tab preset Run drives presetsRun and Remove drives presetsRemove', async () => {
    await mount();
    await clickTab(/^search$/i);
    const presetRow = Array.from(container.querySelectorAll('.xls-search .xls-source-row')).find((r) =>
      (r.textContent || '').includes('OSINT watch'),
    )!;
    await act(async () => { findButton(presetRow, /^run$/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.presetsRun).toHaveBeenCalledWith({ caseId: 'camp-a', id: 'preset-1' });
    expect(container.textContent || '').toMatch(/matched 1 post/i);

    await act(async () => { findButton(presetRow, /remove/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.presetsRemove).toHaveBeenCalledWith({ caseId: 'camp-a', id: 'preset-1' });
  });

  // ── notes ──────────────────────────────────────────────────────────────────
  it('notes tab lists the real persisted notes from readNotes', async () => {
    await mount();
    await clickTab(/^notes$/i);
    expect(api.xListening.readNotes).toHaveBeenCalledWith('camp-a');
    expect(container.textContent || '').toMatch(/existing note/);
  });

  it('notes tab Save Note calls the real saveNote channel with the selected post as findingId', async () => {
    await mount();
    await clickTab(/^notes$/i);
    const select = container.querySelector('.xls-notes select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'post-b');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const textarea = container.querySelector('.xls-note-text') as HTMLTextAreaElement;
    await act(async () => setInputValue(textarea, 'a fresh analyst note'));
    await act(async () => { findButton(container, /save note/i).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.saveNote).toHaveBeenCalledWith({
      caseId: 'camp-a', findingId: 'post-b', text: 'a fresh analyst note',
    });
  });

  it('notes tab Remove calls the real removeNote channel', async () => {
    await mount();
    await clickTab(/^notes$/i);
    await act(async () => { findButton(container, /remove/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.removeNote).toHaveBeenCalledWith({ caseId: 'camp-a', findingId: 'post-a' });
  });

  // ── exports ────────────────────────────────────────────────────────────────
  it('exports tab drives the real exportPostsToFile channel per format', async () => {
    await mount();
    await clickTab(/^exports$/i);
    await act(async () => { findButton(container, /export json/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.exportPostsToFile).toHaveBeenCalledWith({ caseId: 'camp-a', format: 'json' });
    expect(container.textContent || '').toMatch(/Exported 2 post\(s\) to \/chosen\/export\.json/);
  });

  it('exports tab drives the real exportNetworkToFile channel', async () => {
    await mount();
    await clickTab(/^exports$/i);
    await act(async () => { findButton(container, /export network csv/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.exportNetworkToFile).toHaveBeenCalledWith('camp-a');
    expect(container.textContent || '').toMatch(/Exported 2 network account\(s\) to \/chosen\/networks\.csv/);
  });

  it('exports tab shows "canceled" honestly rather than a fabricated success', async () => {
    api.xListening.exportPostsToFile.mockResolvedValueOnce({ canceled: true } as never);
    await mount();
    await clickTab(/^exports$/i);
    await act(async () => { findButton(container, /export csv/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent || '').toMatch(/Export canceled/i);
  });

  // ── campaigns ──────────────────────────────────────────────────────────────
  it('campaigns tab lists every real campaign and marks the active one', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    const text = container.textContent || '';
    expect(text).toMatch(/Alpha Watch/);
    expect(text).toMatch(/Beta Watch/);
    const activeRow = Array.from(container.querySelectorAll('.xls-campaigns .xls-source-row')).find((r) =>
      (r.textContent || '').includes('Alpha Watch'),
    );
    expect(activeRow?.querySelector('.xls-marker-active')).toBeTruthy();
  });

  it('campaigns tab Switch drives the real campaignsSwitch channel for a non-active row', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    const betaRow = Array.from(container.querySelectorAll('.xls-campaigns .xls-source-row')).find((r) =>
      (r.textContent || '').includes('Beta Watch'),
    )!;
    await act(async () => { findButton(betaRow, /switch/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.campaignsSwitch).toHaveBeenCalledWith('camp-b');
  });

  it('campaigns tab Delete on a NON-active row deletes it without first switching to it', async () => {
    confirmDialogMock.mockResolvedValueOnce(true);
    await mount();
    await clickTab(/^campaigns$/i);
    const betaRow = Array.from(container.querySelectorAll('.xls-campaigns .xls-source-row')).find((r) =>
      (r.textContent || '').includes('Beta Watch'),
    )!;
    await act(async () => { findButton(betaRow, /delete/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.campaignsDelete).toHaveBeenCalledWith('camp-b');
    // the still-active campaign was never switched away from
    expect(api.xListening.campaignsSwitch).not.toHaveBeenCalledWith('camp-b');
  });

  // ── system ─────────────────────────────────────────────────────────────────
  it('system tab collect toggles patch the FULL xListening settings block (no sibling dataloss)', async () => {
    const settingsUpdate = withSettingsUpdate(api);
    await mount();
    await clickTab(/^system$/i);
    const repliesCheckbox = Array.from(container.querySelectorAll('.xls-system input[type="checkbox"]')).find(
      (el) => (el.closest('label')?.textContent || '').match(/capture replies/i),
    ) as HTMLInputElement;
    await act(async () => { repliesCheckbox.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(settingsUpdate).toHaveBeenCalledWith({
      xListening: expect.objectContaining({ collect: expect.objectContaining({ replies: true }) }),
    });
    const sent = settingsUpdate.mock.calls[0][0] as Partial<AppSettings>;
    expect(sent.xListening).toEqual(expect.objectContaining({ clearnet: defaultSettings.xListening.clearnet }));
  });

  it('system tab archiveCycles toggle patches settings and Run Archive Step drives archiveRun + refreshes archiveStatus', async () => {
    withSettingsUpdate(api);
    await mount();
    // enter a target username on the Live tab first (shared `targetUsername` state)
    await clickTab(/^live$/i);
    const target = container.querySelector('.xls-live-target') as HTMLInputElement;
    await act(async () => setInputValue(target, 'watchtarget'));

    await clickTab(/^system$/i);
    const archiveToggle = Array.from(container.querySelectorAll('.xls-system input[type="checkbox"]')).find(
      (el) => (el.closest('label')?.textContent || '').match(/archive cycles/i),
    ) as HTMLInputElement;
    await act(async () => { archiveToggle.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent || '').toMatch(/Cycles: 3/);
    expect(container.textContent || '').toMatch(/cursor-123/);

    await act(async () => { findButton(container, /run archive step/i).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.archiveRun).toHaveBeenCalledWith({
      caseId: 'camp-a', channelId: 'watchtarget', channelLabel: '@watchtarget',
      targetUsername: 'watchtarget', maxCycles: 1,
    });
    expect(container.textContent || '').toMatch(/Cycles: 4/);
  });

  it('system tab Load Demo Data requires confirmation, then drives loadDemoData and reloads insights', async () => {
    confirmDialogMock.mockResolvedValueOnce(true);
    await mount();
    await clickTab(/^system$/i);
    api.xListening.postsList.mockClear();
    await act(async () => { findButton(container, /load demo data/i).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmDialogMock).toHaveBeenCalled();
    expect(api.xListening.loadDemoData).toHaveBeenCalledWith('camp-a');
    expect(api.xListening.postsList).toHaveBeenCalledWith('camp-a');
    expect(container.textContent || '').toMatch(/Loaded 6 demo post/);
  });

  it('system tab Load Demo Data does nothing if the operator declines the confirmation', async () => {
    confirmDialogMock.mockResolvedValueOnce(false);
    await mount();
    await clickTab(/^system$/i);
    await act(async () => { findButton(container, /load demo data/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.loadDemoData).not.toHaveBeenCalled();
  });
});
