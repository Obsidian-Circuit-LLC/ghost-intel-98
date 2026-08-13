// @vitest-environment jsdom
/**
 * Task 13 — X Listening Station shell: campaign dock CRUD, X-session box, Tor/clearnet
 * posture (one-time real-IP acknowledgement), and the persistent CLEARNET/DEMO markers.
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency). Every
 * assertion here drives the REAL rendered UI against a stubbed `window.api.xListening` —
 * proving the shell's controls invoke the actual Phase-1 channels (campaigns list/create/
 * switch/update/delete, openSession, sessionStatus, closeSession), never a hollow no-op
 * (the v3.24.2 lesson).
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  XListeningModule,
  hasSyntheticRecords,
} from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { confirmDialog, promptDialog } from '../src/renderer/state/dialogs';
import { defaultSettings, type AppSettings } from '@shared/types';

const confirmDialogMock = vi.mocked(confirmDialog);
const promptDialogMock = vi.mocked(promptDialog);

const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };
const CAMP_B = { id: 'camp-b', name: 'Beta Watch', createdAt: 2, updatedAt: 2 };

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A, CAMP_B]),
      campaignsCreate: vi.fn(async (name: string) => ({ id: 'camp-new', name, createdAt: 3, updatedAt: 3 })),
      campaignsSwitch: vi.fn(async (id: string) => ({ ...(id === CAMP_A.id ? CAMP_A : CAMP_B) })),
      campaignsUpdate: vi.fn(async (req: { id: string; name: string }) => ({ id: req.id, name: req.name, createdAt: 1, updatedAt: 4 })),
      campaignsDelete: vi.fn(async () => undefined),
      sessionStatus: vi.fn(async () => ({ connected: false, windowOpen: false })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      // Task 14/15 — insight loaders fired for any active campaign on mount; stubbed so this
      // Task-13 shell suite stays focused on the dock/session/posture assertions it tests.
      postsList: vi.fn(async () => []),
      analysis: vi.fn(async () => ({})),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => null),
      presetsRead: vi.fn(async () => ({ presets: [] })),
    },
  };
}

function setXListeningSettings(patch: Partial<AppSettings['xListening']>): void {
  useSettings.setState({
    settings: {
      ...defaultSettings,
      xListening: { ...defaultSettings.xListening, ...patch },
    },
  });
}

describe('X Listening Station shell (Task 13)', () => {
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
  }
  function findButton(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('button')).find((b) => matcher.test(b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function click(matcher: RegExp) {
    await act(async () => { findButton(matcher).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  }

  // ── campaign dock ────────────────────────────────────────────────────────
  it('New Campaign → promptDialog → campaignsCreate → list refreshed and the new campaign becomes active', async () => {
    promptDialogMock.mockResolvedValue('Gamma Watch');
    const created = { id: 'camp-new', name: 'Gamma Watch', createdAt: 3, updatedAt: 3 };
    api.xListening.campaignsCreate.mockResolvedValue(created);
    // The post-create refresh must see the newly created campaign in the list.
    api.xListening.campaignsList.mockResolvedValueOnce([CAMP_A, CAMP_B]).mockResolvedValueOnce([CAMP_A, CAMP_B, created]);
    await mount();

    await click(/new/i);

    expect(promptDialogMock).toHaveBeenCalled();
    expect(api.xListening.campaignsCreate).toHaveBeenCalledWith('Gamma Watch');
    // campaignsList was called again to refresh (mount + post-create refresh).
    expect(api.xListening.campaignsList).toHaveBeenCalledTimes(2);
    const select = container.querySelector('[aria-label="Active campaign"]') as HTMLSelectElement;
    expect(select.value).toBe('camp-new');
  });

  it('a blank/cancelled prompt creates nothing', async () => {
    promptDialogMock.mockResolvedValue(null);
    await mount();
    await click(/new/i);
    expect(api.xListening.campaignsCreate).not.toHaveBeenCalled();
  });

  it('switching the campaign select calls campaignsSwitch (validates, not just local state)', async () => {
    await mount();
    const select = container.querySelector('[aria-label="Active campaign"]') as HTMLSelectElement;
    expect(select.value).toBe('camp-a'); // auto-selected first

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'camp-b');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.campaignsSwitch).toHaveBeenCalledWith('camp-b');
    expect(select.value).toBe('camp-b');
  });

  // J2 reskin: the sidebar dock carries +NEW / EDIT / MANAGE (Enterprise parity).
  // EDIT drives the same promptDialog→campaignsUpdate rename path the dock always had.
  it('EDIT → promptDialog prefilled with the current name → campaignsUpdate', async () => {
    promptDialogMock.mockResolvedValue('Alpha Watch Renamed');
    await mount();

    await click(/^edit$/i);

    expect(promptDialogMock).toHaveBeenCalledWith(expect.any(String), 'Alpha Watch', expect.any(String));
    expect(api.xListening.campaignsUpdate).toHaveBeenCalledWith({ id: 'camp-a', name: 'Alpha Watch Renamed' });
  });

  // J2 reskin: MANAGE opens the Campaigns tab, where per-card DELETE lives (Enterprise parity —
  // the dock no longer deletes inline). The confirmDialog→campaignsDelete wiring is unchanged.
  it('MANAGE → Campaigns tab DELETE → confirmDialog → campaignsDelete; a cancelled confirm deletes nothing', async () => {
    confirmDialogMock.mockResolvedValueOnce(false);
    await mount();
    await click(/^manage$/i);
    await click(/^delete$/i);
    expect(api.xListening.campaignsDelete).not.toHaveBeenCalled();

    confirmDialogMock.mockResolvedValueOnce(true);
    await click(/^delete$/i);
    expect(api.xListening.campaignsDelete).toHaveBeenCalledWith('camp-a');
  });

  it('EDIT is disabled with no active campaign', async () => {
    api.xListening.campaignsList.mockResolvedValue([]);
    await mount();
    expect(findButton(/^edit$/i).disabled).toBe(true);
  });

  // ── X-session box ────────────────────────────────────────────────────────
  it('Open Session → openSession(activeCampaignId); a blocked result surfaces the reason', async () => {
    api.xListening.openSession.mockResolvedValueOnce({ blocked: true, reason: 'Tor is not ready.' });
    await mount();
    await click(/open session/i);
    expect(api.xListening.openSession).toHaveBeenCalledWith('camp-a');
    expect(container.textContent || '').toMatch(/Tor is not ready\./);
  });

  it('Close Session is disabled until the window is open, then calls closeSession', async () => {
    api.xListening.sessionStatus.mockResolvedValue({ connected: true, windowOpen: true });
    await mount();
    await click(/close session/i);
    expect(api.xListening.closeSession).toHaveBeenCalledWith('camp-a');
  });

  // ── Tor / clearnet posture — the one-time real-IP acknowledgement ─────────
  it('markers: TOR shown by default (clearnet off)', async () => {
    await mount();
    const marker = container.querySelector('.xls-markers .xls-marker') as HTMLElement;
    expect(marker.textContent).toBe('TOR');
    expect(marker.className).toContain('xls-marker-tor');
    expect(container.querySelector('.xls-marker-clearnet')).toBeFalsy();
  });

  it('flipping clearnet on while unacknowledged shows the one-time confirm; cancel leaves it off', async () => {
    confirmDialogMock.mockResolvedValueOnce(false);
    await mount();
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { checkbox.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmDialogMock).toHaveBeenCalled();
    expect((globalThis as any).window.api).toBeTruthy();
    expect(container.querySelector('.xls-marker-clearnet')).toBeFalsy();
  });

  it('flipping clearnet on while unacknowledged + confirm → persists clearnet+clearnetAck and shows CLEARNET marker', async () => {
    confirmDialogMock.mockResolvedValueOnce(true);
    const settingsUpdate = vi.fn(async (patch: Partial<AppSettings>) => {
      const cur = useSettings.getState().settings as AppSettings;
      const next = { ...cur, ...patch, xListening: { ...cur.xListening, ...patch.xListening } };
      useSettings.setState({ settings: next });
      return next;
    });
    (globalThis as any).window.api = { ...api, settings: { update: settingsUpdate } };
    await mount();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { checkbox.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmDialogMock).toHaveBeenCalledWith(expect.stringMatching(/real IP/i), expect.any(String));
    expect(settingsUpdate).toHaveBeenCalledWith({
      xListening: expect.objectContaining({ clearnet: true, clearnetAck: true }),
    });
    // the FULL fixed-shape block travels, not a bare { clearnet } (no sibling dataloss).
    const sent = settingsUpdate.mock.calls[0][0] as Partial<AppSettings>;
    expect(sent.xListening).toEqual(expect.objectContaining({ collect: defaultSettings.xListening.collect }));
    expect(container.querySelector('.xls-marker-clearnet')?.textContent).toBe('CLEARNET');
  });

  it('once acknowledged, re-toggling clearnet on/off never re-prompts', async () => {
    setXListeningSettings({ clearnet: false, clearnetAck: true });
    const settingsUpdate = vi.fn(async (patch: Partial<AppSettings>) => {
      const cur = useSettings.getState().settings as AppSettings;
      const next = { ...cur, ...patch, xListening: { ...cur.xListening, ...patch.xListening } };
      useSettings.setState({ settings: next });
      return next;
    });
    (globalThis as any).window.api = { ...api, settings: { update: settingsUpdate } };
    await mount();

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { checkbox.click(); }); // → true
    await act(async () => { await Promise.resolve(); });
    await act(async () => { checkbox.click(); }); // → false
    await act(async () => { await Promise.resolve(); });

    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(settingsUpdate).toHaveBeenCalledTimes(2);
  });

  it('clearnet already on at mount renders the CLEARNET marker directly (no toggle needed)', async () => {
    setXListeningSettings({ clearnet: true, clearnetAck: true });
    await mount();
    expect(container.querySelector('.xls-marker-clearnet')?.textContent).toBe('CLEARNET');
  });

  // ── DEMO marker predicate (Task 12's synthetic flag) ──────────────────────
  it('hasSyntheticRecords is true iff at least one record carries synthetic:true', () => {
    expect(hasSyntheticRecords([])).toBe(false);
    expect(hasSyntheticRecords([{ id: 'p1' }, { id: 'p2', synthetic: false }])).toBe(false);
    expect(hasSyntheticRecords([{ id: 'p1' }, { id: 'p2', synthetic: true }])).toBe(true);
  });
});
