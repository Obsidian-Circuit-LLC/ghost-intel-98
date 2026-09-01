// @vitest-environment node
/**
 * Two field defects from GhostExodus's v3.74.4 session, both real:
 *
 * 1. ORDER. `refreshOne` called `navigateXToProfile` BEFORE the ensure-window block added in
 *    v3.74.4 — and navigateXToProfile itself throws "No capture window is open for this campaign."
 *    when there is no window. So the ensure could never run, and his REFRESH button returned that
 *    exact error. The v3.74.4 fix was correct in substance and in the wrong place.
 *
 * 2. CLEAR SESSION LIED. `clearXSession` closed the window and returned `{cleared:true}` without
 *    touching the auth cookie — while `getXStatus.connected` is read FROM that cookie. So the
 *    station reported "X session cleared" and went straight on showing CONNECTED, because the
 *    login really was still there. His words: "it says X session cleared, but it didn't clear."
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const nav = vi.fn();
const sessionState = { window: null as unknown, connectCalls: 0 };

vi.mock('../src/main/x-listening/session', () => ({
  connectXSession: vi.fn(async () => { sessionState.connectCalls++; sessionState.window = { id: 'w' }; return { blocked: false }; }),
  getXStatus: vi.fn(),
  clearXSession: vi.fn(async () => ({ cleared: true })),
  resolveXTorGate: () => ({ blocked: false }),
  getXWindow: () => sessionState.window,
  // Faithful to the real one: it THROWS when no window exists.
  navigateXToProfile: (...args: unknown[]) => {
    nav(...args);
    if (!sessionState.window) throw new Error('No capture window is open for this campaign.');
    return Promise.resolve({ blocked: false, ready: true });
  },
}));
vi.mock('../src/main/x-listening/capture', () => ({
  captureTimeline: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] })),
  captureNetwork: vi.fn(), openInX: vi.fn(), verifyPost: vi.fn(),
}));
vi.mock('../src/main/x-listening/collection-lock', () => ({
  withQueuedCollectionLock: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/main/x-listening/ipc', () => ({ loadClearnetEnabled: async () => false }));
vi.mock('../src/main/x-listening/media', () => ({ readCachedMedia: vi.fn(), cacheRemoteMedia: vi.fn() }));
vi.mock('../src/main/capture/capture-window', () => ({ assertTrustedSender: () => undefined }));

import { registerXlsEmbedIpc } from '../src/main/xls-embed/ipc';
import { makeStationStore } from '../src/main/xls-embed/state-store';
import { XLS_CHANNELS } from '../src/shared/xls/channels';

function harness() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  let seq = 0;
  const files = new Map<string, string>();
  const store = makeStationStore({
    readFile: async (p: string) => {
      const v = files.get(p);
      if (!v) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return Buffer.from(v, 'utf8');
    },
    writeFile: async (p: string, d: string) => { files.set(p, d); },
    statePath: () => '/vault/s.json',
    now: () => '2026-09-01T00:00:00.000Z',
    makeId: () => `id-${++seq}`,
  });
  registerXlsEmbedIpc({
    handle: (c: string, fn: never) => handlers.set(c, fn),
    getWindow: () => null,
    store,
    ctx: { now: () => '2026-09-01T00:00:00.000Z', makeId: () => `id-${++seq}` },
  } as never);
  return { handlers, store };
}

describe('refresh with no capture window', () => {
  beforeEach(() => { nav.mockReset(); sessionState.window = null; sessionState.connectCalls = 0; });

  it('opens the window BEFORE navigating, not after', async () => {
    const { handlers, store } = harness();
    await (handlers.get(XLS_CHANNELS.addProfile) as never as Function)({}, 'exodusghost');
    const profileId = (await store.load()).profiles[0].id;

    // Must not throw his error: "No capture window is open for this campaign."
    await (handlers.get(XLS_CHANNELS.refreshProfile) as never as Function)({}, profileId);

    expect(sessionState.connectCalls, 'a window must be ensured').toBe(1);
    expect(nav, 'navigation must happen, i.e. the throw did not pre-empt it').toHaveBeenCalled();
  });
});
