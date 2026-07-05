// @vitest-environment jsdom
/**
 * Task 5: SettingsModule X section — gate control + session UI.
 *
 * The refined X settings pane (XPane) collapses the old two-control gate
 * (Acknowledge button + network toggle) into ONE "Enable authenticated X
 * collection" checkbox whose checked state is the *effective* gate
 * (networkEnabled && clearnetAcknowledged), and replaces the free-form
 * add-account form with an atomic Add-session flow (Test & Save /
 * Save-without-testing) plus a Stored-sessions list (badge, Test, Remove).
 *
 * Charter invariants exercised here:
 *   - the renderer never receives a secret back (only XSessionMeta / a handle);
 *   - checking the gate when NOT acknowledged opens the clearnet modal and only
 *     patches BOTH flags on confirm; cancel patches nothing;
 *   - a legacy inconsistent state (networkEnabled:true, ack:false) renders OFF.
 *
 * No @testing-library — drive React 18 createRoot inside act() against jsdom,
 * mirroring x-ghostscrape-cases-sidebar.test.tsx. confirmDialog is mocked so no
 * DialogHost is needed; window.api.x is a bag of vi.fn()s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultSettings } from '@shared/types';
import type { AppSettings } from '@shared/types';
import type { XSessionMeta } from '@shared/ipc-contracts';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  alertDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { XPane } from '../src/renderer/modules/settings/SettingsModule';
import { confirmDialog } from '../src/renderer/state/dialogs';

let container: HTMLDivElement;
let root: Root;
let xApi: {
  listSessions: ReturnType<typeof vi.fn>;
  addSession: ReturnType<typeof vi.fn>;
  addSessionTested: ReturnType<typeof vi.fn>;
  removeSession: ReturnType<typeof vi.fn>;
  testSession: ReturnType<typeof vi.fn>;
  testStoredSession: ReturnType<typeof vi.fn>;
};

function installApi(sessions: XSessionMeta[] = []): void {
  xApi = {
    listSessions: vi.fn().mockResolvedValue(sessions),
    addSession: vi.fn().mockResolvedValue({ accountId: 'uuid-new' }),
    addSessionTested: vi.fn(),
    removeSession: vi.fn().mockResolvedValue(undefined),
    testSession: vi.fn(),
    testStoredSession: vi.fn().mockResolvedValue({ valid: true, handle: 'ghostexodus' }),
  };
  (globalThis as unknown as { window: { api: unknown } }).window.api = { x: xApi };
}

function settingsWith(x: Partial<AppSettings['x']>): AppSettings {
  return { ...defaultSettings, x: { ...defaultSettings.x, ...x } };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re}`);
  return btn as HTMLButtonElement;
}

function gateToggle(): HTMLInputElement {
  const el = container.querySelector('input[aria-label="Enable authenticated X collection"]');
  if (!el) throw new Error('no gate toggle rendered');
  return el as HTMLInputElement;
}

function inputByLabel(label: string): HTMLInputElement {
  const el = container.querySelector(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`no input for ${label}`);
  return el as HTMLInputElement;
}

async function renderPane(s: AppSettings, patch = vi.fn().mockResolvedValue(undefined)): Promise<ReturnType<typeof vi.fn>> {
  await act(async () => { root.render(<XPane s={s} patch={patch} />); });
  await flush();
  return patch;
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.mocked(confirmDialog).mockReset();
});

// ---------------------------------------------------------------------------
// Gate control (spec §4)
// ---------------------------------------------------------------------------

describe('X settings gate control', () => {
  it('checking the gate when already acknowledged patches networkEnabled:true directly (no modal)', async () => {
    const patch = await renderPane(settingsWith({ networkEnabled: false, clearnetAcknowledged: true }));
    expect(gateToggle().checked).toBe(false);

    await act(async () => { gateToggle().click(); });
    await flush();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ x: { networkEnabled: true, clearnetAcknowledged: true } });
  });

  it('checking the gate when NOT acknowledged opens the modal; confirm patches BOTH flags', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    const patch = await renderPane(settingsWith({ networkEnabled: false, clearnetAcknowledged: false }));

    await act(async () => { gateToggle().click(); });
    await flush();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ x: { clearnetAcknowledged: true, networkEnabled: true } });
  });

  it('cancelling the modal patches nothing', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false);
    const patch = await renderPane(settingsWith({ networkEnabled: false, clearnetAcknowledged: false }));

    await act(async () => { gateToggle().click(); });
    await flush();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it('the legacy state (networkEnabled:true, ack:false) renders the box UNCHECKED', async () => {
    await renderPane(settingsWith({ networkEnabled: true, clearnetAcknowledged: false }));
    expect(gateToggle().checked).toBe(false);
  });

  it('unchecking the gate patches networkEnabled:false (ack preserved)', async () => {
    const patch = await renderPane(settingsWith({ networkEnabled: true, clearnetAcknowledged: true }));
    expect(gateToggle().checked).toBe(true);

    await act(async () => { gateToggle().click(); });
    await flush();

    expect(patch).toHaveBeenCalledWith({ x: { networkEnabled: false, clearnetAcknowledged: true } });
  });
});

// ---------------------------------------------------------------------------
// Add session (spec §5 / §6)
// ---------------------------------------------------------------------------

describe('X settings Add session', () => {
  const enabled = () => settingsWith({ networkEnabled: true, clearnetAcknowledged: true });

  async function fillForm(): Promise<void> {
    typeInto(inputByLabel('Local label'), 'Burner One');
    typeInto(inputByLabel('auth_token'), 'AUTHTOKENVALUE');
    typeInto(inputByLabel('ct0'), 'CT0VALUE');
    await flush();
  }

  it('Test & Save with a valid result calls addSessionTested (one op) and shows the @handle', async () => {
    xApi.addSessionTested.mockResolvedValue({ accountId: 'uuid-new', result: { valid: true, handle: 'ghostexodus' } });
    await renderPane(enabled());
    await fillForm();

    await act(async () => { buttonByText(container, /test & save/i).click(); });
    await flush();

    // Single combined main-side op — no separate testSession/testStoredSession round-trips.
    expect(xApi.addSessionTested).toHaveBeenCalledWith({
      label: 'Burner One', username: undefined, authToken: 'AUTHTOKENVALUE', ct0: 'CT0VALUE',
    });
    expect(xApi.testSession).not.toHaveBeenCalled();
    expect(xApi.testStoredSession).not.toHaveBeenCalled();
    expect(container.textContent).toContain('@ghostexodus');
  });

  it('a definitive expired result does NOT save and shows the error', async () => {
    xApi.addSessionTested.mockResolvedValue({ result: { valid: false, reason: 'expired' } });
    await renderPane(enabled());
    await fillForm();

    await act(async () => { buttonByText(container, /test & save/i).click(); });
    await flush();

    expect(xApi.addSession).not.toHaveBeenCalled();
    expect(container.textContent?.toLowerCase()).toContain('expired');
  });

  it('an inconclusive result (rate-limited) offers Save without testing → addSession untested', async () => {
    xApi.addSessionTested.mockResolvedValue({ result: { valid: false, reason: 'rate-limited' } });
    await renderPane(enabled());
    await fillForm();

    await act(async () => { buttonByText(container, /test & save/i).click(); });
    await flush();

    expect(xApi.addSession).not.toHaveBeenCalled();
    const saveAnyway = buttonByText(container, /save without testing/i);
    await act(async () => { saveAnyway.click(); });
    await flush();

    expect(xApi.addSession).toHaveBeenCalledWith({
      label: 'Burner One', username: undefined, authToken: 'AUTHTOKENVALUE', ct0: 'CT0VALUE',
    });
  });

  it('Test & Save is disabled when the gate is off', async () => {
    await renderPane(settingsWith({ networkEnabled: false, clearnetAcknowledged: false }));
    expect(buttonByText(container, /test & save/i).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stored sessions (spec §5)
// ---------------------------------------------------------------------------

describe('X settings Stored sessions', () => {
  const SESSIONS: XSessionMeta[] = [
    { accountId: 'a-valid', label: 'Alpha', username: 'alphahint', status: 'valid', handle: 'alpharealm', lastTestedAt: '2026-07-05T00:00:00.000Z' },
    { accountId: 'b-untested', label: 'Bravo', status: 'untested' },
  ];

  function rowFor(id: string): HTMLElement {
    const el = container.querySelector(`[data-x-session-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el as HTMLElement;
  }

  it('renders each session with its label, authoritative @handle, and status badge', async () => {
    installApi(SESSIONS);
    await renderPane(settingsWith({ networkEnabled: true, clearnetAcknowledged: true }));

    expect(rowFor('a-valid').textContent).toContain('Alpha');
    expect(rowFor('a-valid').textContent).toContain('@alpharealm');
    expect(rowFor('a-valid').textContent?.toLowerCase()).toContain('valid');
    expect(rowFor('b-untested').textContent?.toLowerCase()).toContain('untested');
  });

  it('Test on a row calls testStoredSession(accountId)', async () => {
    installApi(SESSIONS);
    await renderPane(settingsWith({ networkEnabled: true, clearnetAcknowledged: true }));

    await act(async () => { buttonByText(rowFor('a-valid'), /^test$/i).click(); });
    await flush();

    expect(xApi.testStoredSession).toHaveBeenCalledWith('a-valid');
  });

  it('Remove on a row (confirmed) calls removeSession(accountId)', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    installApi(SESSIONS);
    await renderPane(settingsWith({ networkEnabled: true, clearnetAcknowledged: true }));

    await act(async () => { buttonByText(rowFor('b-untested'), /remove/i).click(); });
    await flush();

    expect(xApi.removeSession).toHaveBeenCalledWith('b-untested');
  });
});
