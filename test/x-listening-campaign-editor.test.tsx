// @vitest-environment jsdom
/**
 * Task J1 — Campaigns tab to parity: the CREATE/EDIT editor modal (NAME/PURPOSE/DESCRIPTION),
 * the per-card ACTIVATE / EDIT / DUPLICATE SETUP / DELETE actions, and DELETE disabled at one
 * campaign. createRoot + act, NO @testing-library (Global Constraint: no new dependency).
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(async () => true),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import { DEFAULT_COLLECTION_SETTINGS } from '@shared/x-listening-collection-settings';

const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };
const CAMP_B = { id: 'camp-b', name: 'Beta Watch', createdAt: 2, updatedAt: 2 };

function makeApi(campaigns = [CAMP_A, CAMP_B]) {
  return {
    xListening: {
      campaignsList: vi.fn(async () => campaigns),
      campaignsMeta: vi.fn(async () => ({
        'camp-a': { purpose: 'Track alpha leaks', description: 'Alpha scope + targets' },
        'camp-b': { purpose: '', description: '' },
      })),
      campaignsCreate: vi.fn(async (name: string) => ({ id: 'camp-new', name, createdAt: 9, updatedAt: 9 })),
      campaignsUpdate: vi.fn(async (req: { id: string; name: string }) => ({
        id: req.id, name: req.name, createdAt: 1, updatedAt: 2,
      })),
      campaignsDuplicate: vi.fn(async () => ({ id: 'camp-copy', name: 'Alpha Watch Copy', createdAt: 5, updatedAt: 5 })),
      campaignsSwitch: vi.fn(async (id: string) => (id === CAMP_B.id ? CAMP_B : CAMP_A)),
      campaignsDelete: vi.fn(async () => undefined),
      sessionStatus: vi.fn(async () => ({ connected: false, windowOpen: false })),
      postsList: vi.fn(async () => []),
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
      presetsRead: vi.fn(async () => ({ presets: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      getCollectionSettings: vi.fn(async () => DEFAULT_COLLECTION_SETTINGS),
      getImagePolicy: vi.fn(async () => ({ modes: {}, retrieveImages: true })),
      scheduleStatus: vi.fn(async () => ({ sweepEnabled: false, archiveEnabled: false })),
    },
  };
}

describe('X Listening campaigns editor (Task J1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  function setApi(a: ReturnType<typeof makeApi>) {
    api = a;
    (globalThis as any).window.api = a;
  }

  beforeEach(() => {
    setApi(makeApi());
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
  function findButton(scope: ParentNode, matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(scope.querySelectorAll('button')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  function campaignRow(name: string): HTMLElement {
    const row = Array.from(container.querySelectorAll('.xls-campaigns .xls-campaign-card')).find((r) =>
      (r.textContent || '').includes(name),
    );
    if (!row) throw new Error(`campaign row not found: ${name}`);
    return row as HTMLElement;
  }
  async function click(btn: HTMLButtonElement) {
    await act(async () => { btn.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
  }
  function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('renders each campaign card with its purpose from campaignsMeta', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    expect(container.textContent).toMatch(/Track alpha leaks/);
    expect(container.textContent).toMatch(/Alpha scope \+ targets/);
    // Beta has no meta → the honest placeholder
    expect(campaignRow('Beta Watch').textContent).toMatch(/No purpose defined/);
  });

  it('DELETE is disabled when only one campaign remains', async () => {
    setApi(makeApi([CAMP_A]));
    await mount();
    await clickTab(/^campaigns$/i);
    const del = findButton(campaignRow('Alpha Watch'), /^delete$/i);
    expect(del.disabled).toBe(true);
  });

  it('DELETE is enabled with two campaigns and drives campaignsDelete for the row', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    const del = findButton(campaignRow('Beta Watch'), /^delete$/i);
    expect(del.disabled).toBe(false);
    await click(del);
    expect(api.xListening.campaignsDelete).toHaveBeenCalledWith('camp-b');
  });

  it('ACTIVATE drives campaignsSwitch for a non-active row', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    await click(findButton(campaignRow('Beta Watch'), /^activate$/i));
    expect(api.xListening.campaignsSwitch).toHaveBeenCalledWith('camp-b');
  });

  it('EDIT opens the modal prefilled with the campaign name + purpose + description', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    await click(findButton(campaignRow('Alpha Watch'), /^edit$/i));
    const dialog = container.querySelector('.xls-campaign-editor') as HTMLElement;
    expect(dialog).toBeTruthy();
    const name = dialog.querySelector('[aria-label="Campaign name"]') as HTMLInputElement;
    const purpose = dialog.querySelector('[aria-label="Campaign purpose"]') as HTMLInputElement;
    const description = dialog.querySelector('[aria-label="Campaign description"]') as HTMLTextAreaElement;
    expect(name.value).toBe('Alpha Watch');
    expect(purpose.value).toBe('Track alpha leaks');
    expect(description.value).toBe('Alpha scope + targets');
    // SAVE persists all three via campaignsUpdate
    setInputValue(purpose, 'Revised purpose');
    await click(findButton(dialog, /save campaign/i));
    expect(api.xListening.campaignsUpdate).toHaveBeenCalledWith({
      id: 'camp-a', name: 'Alpha Watch', purpose: 'Revised purpose', description: 'Alpha scope + targets',
    });
  });

  it('CREATE + ACTIVATE round-trips name/purpose/description through create then update', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    // The tab's New Campaign button opens the modal (create mode)
    const section = container.querySelector('.xls-campaigns') as HTMLElement;
    await click(findButton(section, /new campaign/i));
    const dialog = container.querySelector('.xls-campaign-editor') as HTMLElement;
    setInputValue(dialog.querySelector('[aria-label="Campaign name"]') as HTMLInputElement, 'Gamma Op');
    setInputValue(dialog.querySelector('[aria-label="Campaign purpose"]') as HTMLInputElement, 'Watch gamma');
    setInputValue(dialog.querySelector('[aria-label="Campaign description"]') as HTMLTextAreaElement, 'Full gamma scope');
    await click(findButton(dialog, /create \+ activate/i));
    expect(api.xListening.campaignsCreate).toHaveBeenCalledWith('Gamma Op');
    expect(api.xListening.campaignsUpdate).toHaveBeenCalledWith({
      id: 'camp-new', name: 'Gamma Op', purpose: 'Watch gamma', description: 'Full gamma scope',
    });
    // modal closes after a successful create
    expect(container.querySelector('.xls-campaign-editor')).toBeFalsy();
  });

  it('DUPLICATE SETUP drives campaignsDuplicate for the row', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    await click(findButton(campaignRow('Alpha Watch'), /duplicate setup/i));
    expect(api.xListening.campaignsDuplicate).toHaveBeenCalledWith('camp-a');
  });

  it('CANCEL closes the editor without any create/update call', async () => {
    await mount();
    await clickTab(/^campaigns$/i);
    await click(findButton(campaignRow('Alpha Watch'), /^edit$/i));
    const dialog = container.querySelector('.xls-campaign-editor') as HTMLElement;
    await click(findButton(dialog, /^cancel$/i));
    expect(container.querySelector('.xls-campaign-editor')).toBeFalsy();
    expect(api.xListening.campaignsUpdate).not.toHaveBeenCalled();
  });
});
