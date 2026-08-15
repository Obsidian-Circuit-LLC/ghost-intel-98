// @vitest-environment jsdom
/**
 * Ghost Social Media Manager (hardened port) — Phase 4 renderer behaviour.
 *
 * Safety-critical + regression-class proofs, driven through a stubbed `window.api.ghostSocial`
 * surface (no real IPC), rendered with createRoot + act (no @testing-library — Global Constraint:
 * no new dependency):
 *
 *  1. AUTO-POST ARM GATE (constraint 3): the Queue's Arm switch is DEFAULT-OFF; arming shows a
 *     one-time confirm and does NOT arm until confirmed; confirming flips the switch AND renders the
 *     persistent "AUTO-POSTING ARMED" header indicator.
 *  2. OVERLAY LIFECYCLE (constraint 9, the SDR regression class): blur/minimize (this window leaves
 *     the top of the focus stack) hides every native view; module unmount tears them ALL down — for
 *     the embedded browser AND the Compose Live Account Wall (compose-grid card).
 *  3. RECOVERY EXPORT (constraint 2): the recovery screen's export routes through the native
 *     save-dialog IPC (`vaultSaveRecoveryKey`) — never an auto-write.
 *  4. COMPOSER PREPARE-ONLY (G5): manual publish calls `publishPrepare` and NEVER arms or clicks
 *     Publish (`armSet` / `scheduledRunNow` are never touched).
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(async () => true),
  alertDialog: vi.fn(async () => {}),
  promptDialog: vi.fn(async () => null),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { GhostSocialModule } from '../src/renderer/modules/ghost-social/GhostSocialModule';
import type { GhostState, PlatformDefault } from '@shared/ghost-social/types';
import { useWindows } from '../src/renderer/state/store';

const WIN = 'gsm-win';

function caps() { return { text: true, image: true, video: true, messages: true, comments: true }; }

function seedState(): GhostState {
  return {
    campaigns: [{
      id: 'c1', name: 'Camp One', notes: '',
      accounts: [
        { id: 'a1', platform: 'x', name: 'X / Twitter', url: 'https://x.com', username: '@one', enabled: true, capabilities: caps() },
      ],
    }],
    selectedCampaignId: 'c1',
    postHistory: [], messageNotes: [], browserCacheMode: 'recent3', scheduledPosts: [],
  };
}

type GsApi = Record<string, ReturnType<typeof vi.fn>>;

function mkApi(overrides: Partial<GsApi> = {}): GsApi {
  const api: GsApi = {
    vaultIsConfigured: vi.fn(async () => true),
    vaultSetup: vi.fn(async () => ({ recoveryKey: 'GSMM-TEST-KEY-0001' })),
    vaultUnlock: vi.fn(async () => true),
    vaultLock: vi.fn(async () => true),
    vaultSaveRecoveryKey: vi.fn(async () => ({ saved: true, filePath: '/chosen/path/key.txt' })),
    getState: vi.fn(async () => seedState()),
    saveState: vi.fn(async (s: GhostState) => s),
    platformDefaults: vi.fn(async (): Promise<PlatformDefault> => ({ name: 'X / Twitter', url: 'https://x.com', capabilities: caps() })),
    browserOpenAccount: vi.fn(async () => true),
    browserShowGrid: vi.fn(async () => true),
    browserHide: vi.fn(async () => {}),
    browserClose: vi.fn(async () => {}),
    browserCloseAll: vi.fn(async () => {}),
    browserRefresh: vi.fn(async () => true),
    browserNav: vi.fn(async () => true),
    browserResize: vi.fn(async () => {}),
    browserSetCacheMode: vi.fn(async () => {}),
    browserDeleteAccountData: vi.fn(async () => true),
    browserSetWindowActive: vi.fn(async () => {}),
    browserSetModal: vi.fn(async () => {}),
    browserApplyEgress: vi.fn(async () => ({ mode: 'clearnet', showWarning: false })),
    browserRegisterHosts: vi.fn(async () => {}),
    browserCacheStatus: vi.fn(async () => ({ mode: 'recent3', activeKey: null, cachedKeys: [], visibleKeys: [] })),
    faviconFetch: vi.fn(async () => null),
    openExternal: vi.fn(async () => {}),
    publishPrepare: vi.fn(async () => ({ status: 'prepared', message: 'Composer prepared in the live account tile.' })),
    armGet: vi.fn(async () => false),
    armSet: vi.fn(async (armed: boolean) => armed === true),
    scheduledRunNow: vi.fn(async () => ({ ran: false, disarmed: true })),
    scheduledProcessDue: vi.fn(async () => ({ ran: false, disarmed: true })),
    statsRefresh: vi.fn(async () => ({ followers: 1, following: 2, status: 'ok' })),
    onScheduledStateChanged: vi.fn(() => () => {}),
  };
  return { ...api, ...overrides };
}

let container: HTMLDivElement;
let root: Root;
let api: GsApi;

function setActive(active: boolean): void {
  // Focus stack top === WIN and not minimized ⇒ active. Push a different id on top to blur.
  if (active) useWindows.setState({ windows: [{ id: WIN, module: 'ghost-social', title: 'Ghost Social' }], focusStack: [WIN] });
  else useWindows.setState({ windows: [{ id: WIN, module: 'ghost-social', title: 'Ghost Social' }, { id: 'other', module: 'notepad', title: 'n' }], focusStack: [WIN, 'other'] });
}

const tick = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function mount(over: Partial<GsApi> = {}): Promise<void> {
  api = mkApi(over);
  (window as unknown as { api: { ghostSocial: GsApi } }).api = { ghostSocial: api };
  setActive(true);
  await act(async () => { root.render(<GhostSocialModule windowId={WIN} />); });
  await tick();
}

// Enter the unlocked app (vault is configured → type + click UNLOCK).
async function unlock(): Promise<void> {
  const input = container.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'hunter2'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const btn = [...container.querySelectorAll('button')].find((b) => /UNLOCK/.test(b.textContent || ''))!;
  await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
}

function clickText(re: RegExp): void {
  const btn = [...container.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
  if (!btn) throw new Error('no button matching ' + re);
  act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

beforeEach(() => {
  // jsdom has no ResizeObserver (the bounds-tracking effects use one).
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useWindows.setState({ windows: [], focusStack: [] });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('Ghost Social — AUTO-POST ARM GATE (constraint 3, safety-critical)', () => {
  it('the arm switch is DEFAULT-OFF and no ARMED indicator shows', async () => {
    await mount();
    await unlock();
    clickText(/Scheduled Queue/);
    await tick();
    const sw = container.querySelector('[aria-label="Arm auto-posting"]') as HTMLButtonElement;
    expect(sw).toBeTruthy();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('AUTO-POSTING DISARMED');
    expect(container.querySelector('.gsm-armed-marker')).toBeNull();
  });

  it('arming requires the one-time confirm and only then arms + shows the indicator', async () => {
    await mount();
    await unlock();
    clickText(/Scheduled Queue/);
    await tick();
    // Flip the switch → confirm appears, but NOT yet armed.
    const sw = container.querySelector('[aria-label="Arm auto-posting"]') as HTMLButtonElement;
    await act(async () => { sw.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await tick();
    expect(container.textContent).toContain('Arm auto-posting?');
    expect(api.armSet).not.toHaveBeenCalled();
    // Confirm.
    clickText(/ARM AUTO-POSTING/);
    await tick();
    expect(api.armSet).toHaveBeenCalledWith(true);
    expect(container.querySelector('.gsm-armed-marker')?.textContent).toContain('AUTO-POSTING ARMED');
    expect((container.querySelector('[aria-label="Arm auto-posting"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
  });
});

describe('Ghost Social — overlay lifecycle (constraint 9, the SDR regression class)', () => {
  it('blur (leaving the focus-stack top) hides every native view', async () => {
    await mount();
    await unlock();
    // Open the embedded browser for account a1.
    clickText(/@one/);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    await tick();
    api.browserHide.mockClear();
    api.browserSetWindowActive.mockClear();
    // Blur: another window takes the focus-stack top.
    await act(async () => { setActive(false); });
    await tick();
    expect(api.browserSetWindowActive).toHaveBeenCalledWith(false);
    expect(api.browserHide).toHaveBeenCalled();
  });

  it('unmount tears down EVERY view (browser page)', async () => {
    await mount();
    await unlock();
    clickText(/@one/);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    await tick();
    await act(async () => { root.unmount(); });
    expect(api.browserCloseAll).toHaveBeenCalled();
  });

  it('the Compose Live Account Wall shows a grid card view and unmount tears it down', async () => {
    await mount();
    await unlock();
    clickText(/Compose/);
    await tick();
    // The grid effect debounces ~100ms before pushing bounds for its per-account card view.
    await act(async () => { await new Promise((r) => setTimeout(r, 160)); });
    await tick();
    expect(api.browserShowGrid).toHaveBeenCalled();
    api.browserCloseAll.mockClear();
    await act(async () => { root.unmount(); });
    expect(api.browserCloseAll).toHaveBeenCalled();
  });
});

describe('Ghost Social — renderer resyncs the arm flag (Finding 1) + deferred-open unmount safety (Finding 4)', () => {
  it('disarming resyncs React state.autoPostArmed so a later persist() never carries a stale true', async () => {
    // Vault loads with auto-posting ARMED (getState carries autoPostArmed:true). After the user
    // disarms, any unrelated persist() must send autoPostArmed:false — never the stale true that the
    // MAIN Finding-1 override would otherwise have to catch. Belt-and-braces with the MAIN fix.
    await mount({ armGet: vi.fn(async () => true), getState: vi.fn(async () => ({ ...seedState(), autoPostArmed: true } as GhostState)) });
    await unlock();
    clickText(/Scheduled Queue/);
    await tick();
    expect(container.querySelector('.gsm-armed-marker')).toBeTruthy(); // armed indicator shows
    // Disarm.
    const sw = container.querySelector('[aria-label="Arm auto-posting"]') as HTMLButtonElement;
    await act(async () => { sw.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await tick();
    expect(api.armSet).toHaveBeenCalledWith(false);
    expect(container.querySelector('.gsm-armed-marker')).toBeNull(); // indicator cleared
    // Trigger an UNRELATED persist (click the campaign in the sidebar → persist({...state,…})).
    api.saveState.mockClear();
    const campBtn = container.querySelector('.gsm-campaign') as HTMLButtonElement;
    await act(async () => { campBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await tick();
    const lastSave = api.saveState.mock.calls.at(-1)?.[0] as GhostState;
    expect(lastSave).toBeTruthy();
    expect(lastSave.autoPostArmed).toBe(false); // resynced — no stale true persisted
  });

  it('unmounting within the 30ms open defer cancels the deferred browserOpenAccount (Finding 4)', async () => {
    await mount();
    await unlock();
    api.browserOpenAccount.mockClear();
    // Click the account to schedule the deferred open, then unmount synchronously BEFORE 30ms.
    clickText(/@one/);
    act(() => { root.unmount(); });
    // Wait past the defer window: the deferred call must have been cancelled by unmount.
    await act(async () => { await new Promise((r) => setTimeout(r, 90)); });
    expect(api.browserOpenAccount).not.toHaveBeenCalled();
  });
});

describe('Ghost Social — recovery export (constraint 2) + composer prepare-only (G5)', () => {
  it('recovery export routes through the native save-dialog IPC, never an auto-write', async () => {
    await mount({ vaultIsConfigured: vi.fn(async () => false) });
    // First-run setup path → recovery screen.
    const inputs = () => [...container.querySelectorAll('input[type="password"]')] as HTMLInputElement[];
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      const [pw, cf] = inputs();
      setter.call(pw, 'hunter2'); pw.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(cf, 'hunter2'); cf.dispatchEvent(new Event('input', { bubbles: true }));
    });
    clickText(/CREATE VAULT/);
    await tick();
    expect(container.textContent).toContain('RECOVERY KEY');
    clickText(/EXPORT TO FILE/);
    await tick();
    expect(api.vaultSaveRecoveryKey).toHaveBeenCalledWith('GSMM-TEST-KEY-0001');
  });

  it('manual Composer publish is PREPARE-ONLY — never arms, never clicks Publish', async () => {
    await mount();
    await unlock();
    clickText(/Compose/);
    await tick();
    const ta = container.querySelector('.gsm-composer textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'hello world'); ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    clickText(/PREPARE IN OPEN TILES/);
    await tick();
    expect(api.publishPrepare).toHaveBeenCalled();
    expect(api.armSet).not.toHaveBeenCalled();
    expect(api.scheduledRunNow).not.toHaveBeenCalled();
  });
});
