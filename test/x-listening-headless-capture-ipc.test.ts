import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Headless capture — the IPC wiring passes the hidden-window option through.
 *
 * `connectXSession` gained `{ visible?: boolean }` (see `x-listening-headless-session.test.ts`).
 * This pins the WIRING: the `captureTimeline` handler's ensure-window path must open the capture
 * window HIDDEN (`{ visible: false }`) so a one-click capture never pops up the Chromium browser,
 * while the explicit `openSession` sign-in action must still open it VISIBLE (the default — no
 * `visible:false`).
 *
 * The whole `./session` module is mocked so the handler's calls are inspectable without a real
 * BrowserWindow; capture/collection-settings/image-policy/storage are mocked to the minimum the
 * handler touches after the ensure-window step.
 */

const rec = vi.hoisted(() => ({
  connectCalls: [] as Array<{ caseId: string; clearnet: boolean; opts: unknown }>,
  window: { __fake: 'win' } as unknown,
}));

vi.mock('../src/main/x-listening/session', () => ({
  connectXSession: vi.fn(async (caseId: string, clearnet: boolean, opts?: unknown) => {
    rec.connectCalls.push({ caseId, clearnet, opts });
    return { blocked: false };
  }),
  getXStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
  clearXSession: vi.fn(() => ({ cleared: true })),
  getXWindow: vi.fn(() => rec.window),
  navigateXToProfile: vi.fn(async () => ({ ready: true, blocked: false })),
}));

vi.mock('../src/main/x-listening/capture', () => ({
  captureTimeline: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] })),
  captureNetwork: vi.fn(async () => ({ blocked: false, kind: 'followers', target: '@target', observed: 0, added: 0, completedPasses: 1, reachedEnd: true })),
  verifyPost: vi.fn(),
  openInX: vi.fn(),
}));

vi.mock('../src/main/x-listening/collection-settings', () => ({
  getCollectionSettings: vi.fn(async () => ({
    collectReplies: false,
    collectReposts: false,
    collectComments: false,
    retrieveImages: true,
  })),
  saveCollectionSettings: vi.fn(),
}));

vi.mock('../src/main/x-listening/image-policy', () => ({
  getImagePolicy: vi.fn(),
  setProfileImageMode: vi.fn(),
  resolveEffectiveImageCollection: vi.fn(async () => true),
}));

vi.mock('../src/main/x-listening/scheduler', () => ({
  restartSchedule: vi.fn(async () => undefined),
  stopSchedule: vi.fn(),
  scheduleStatus: vi.fn(() => ({})),
}));

vi.mock('../src/main/x-listening/avatar-repair', () => ({
  repairAvatars: vi.fn(async () => undefined),
  buildAvatarLookup: vi.fn(async () => ({})),
  primeEntityAvatarsForCase: vi.fn(async () => undefined),
}));
// v3.72.3: the post-capture avatar work now runs as MAINTENANCE — repair + entity priming under the
// collection mutex, scheduled so it starts only after the capture's own lock is released.
vi.mock('../src/main/x-listening/avatar-maintenance', () => ({
  scheduleAvatarMaintenance: vi.fn(),
}));

// `loadClearnetEnabled` dynamically imports this; return the default (Tor mode, clearnet off).
vi.mock('../src/main/storage/json-fs', () => ({
  settingsStore: { read: vi.fn(async () => ({ xListening: { clearnet: false } })) },
}));

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
}));

import { channels } from '../src/shared/ipc-contracts';
import { registerXListeningIpc } from '../src/main/x-listening/ipc';
import { connectXSession, getXWindow } from '../src/main/x-listening/session';
import { scheduleAvatarMaintenance } from '../src/main/x-listening/avatar-maintenance';

const TRUSTED = { senderFrame: { url: 'file:///app/index.html' } };

function fakeIpcMain() {
  const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const handle = (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
    registered.set(channel, (e, ...args) => fn(e, ...args));
  };
  return { registered, handle };
}

beforeEach(() => {
  rec.connectCalls = [];
  rec.window = { __fake: 'win' };
  vi.mocked(connectXSession).mockClear();
  vi.mocked(getXWindow).mockReturnValue(rec.window as never);
});

describe('captureTimeline handler — headless ensure-window', () => {
  it('opens the ensure-window HIDDEN ({ visible: false }) when no window is open yet', async () => {
    // No live window for this case → the handler must ENSURE one, hidden.
    vi.mocked(getXWindow).mockReturnValueOnce(undefined as never).mockReturnValue(rec.window as never);
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle as never });
    const caseId = randomUUID();

    await ipc.registered.get(channels.xListening.captureTimeline)!(TRUSTED, {
      caseId,
      channelId: 'target',
      targetUsername: 'target',
    });

    expect(rec.connectCalls).toHaveLength(1);
    expect(rec.connectCalls[0]!.caseId).toBe(caseId);
    expect(rec.connectCalls[0]!.opts).toMatchObject({ visible: false });
  });

  it('does not re-open (or show) a window when one is already live', async () => {
    // getXWindow returns a live window from the start → no ensure-window call at all.
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle as never });
    const caseId = randomUUID();

    await ipc.registered.get(channels.xListening.captureTimeline)!(TRUSTED, {
      caseId,
      channelId: 'target',
      targetUsername: 'target',
    });

    expect(rec.connectCalls).toHaveLength(0);
  });

  // v3.72.1 display-pics fix: a sweep discovers new author handles whose avatars were never fetched
  // (repair otherwise runs only on session-open). Both capture paths must re-run the idempotent repair.
  it('schedules avatar maintenance after a successful timeline capture', async () => {
    vi.mocked(scheduleAvatarMaintenance).mockClear();
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle as never });
    const caseId = randomUUID();
    await ipc.registered.get(channels.xListening.captureTimeline)!(TRUSTED, {
      caseId, channelId: 'target', targetUsername: 'target',
    });
    expect(vi.mocked(scheduleAvatarMaintenance)).toHaveBeenCalledWith(caseId);
  });

  it('schedules avatar maintenance after a successful network extraction', async () => {
    vi.mocked(scheduleAvatarMaintenance).mockClear();
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle as never });
    const caseId = randomUUID();
    await ipc.registered.get(channels.xListening.captureNetwork)!(TRUSTED, {
      caseId, channelId: 'target', targetUsername: 'target', kind: 'followers',
    });
    expect(vi.mocked(scheduleAvatarMaintenance)).toHaveBeenCalledWith(caseId);
  });
});

describe('openSession handler — visible sign-in stays visible', () => {
  it('opens the session window VISIBLE (no { visible: false })', async () => {
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle as never });
    const caseId = randomUUID();

    await ipc.registered.get(channels.xListening.openSession)!(TRUSTED, caseId);

    expect(rec.connectCalls).toHaveLength(1);
    expect(rec.connectCalls[0]!.caseId).toBe(caseId);
    // Either no opts at all, or an opts that does NOT force visible:false.
    const opts = rec.connectCalls[0]!.opts as { visible?: boolean } | undefined;
    expect(opts?.visible === false).toBe(false);
  });
});
