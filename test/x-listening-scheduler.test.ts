/**
 * X Listening Station — automatic sweep + archive scheduler (Task G1).
 *
 * The scheduler restores Enterprise's free-running `autoSweep`/`archive` `setInterval` cadence
 * (`electron/main.cjs:1912-1922`, `2058-2069`) onto the hardened seams:
 *   - the timer is SOURCE-EXACT (fixed interval, no auto-pause) — but every scheduled sweep's
 *     capture still routes the SAME Tor gate as a manual capture (`captureProfileTimeline`, which
 *     resolves `resolveXTorGate` itself). In Tor mode with Tor down the sweep FAILS CLOSED — no
 *     capture, no clearnet egress. The clearnet path fires ONLY when clearnet AND clearnetAck are set.
 *   - the schedule only runs while an X session is connected;
 *   - disabling the schedule / disconnecting the session halts the timers.
 *
 * These tests drive the orchestration through injected deps (no electron/network) — the timer is a
 * manual injected harness so the cadence is asserted deterministically, and the gate is exercised
 * both at the `captureProfileTimeline` primitive and through a whole scheduled sweep.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  restartSchedule,
  stopSchedule,
  runScheduledSweep,
  scheduleStatus,
  __resetSchedulerForTests,
  type XSchedulerDeps,
} from '../src/main/x-listening/scheduler';
import { captureProfileTimeline } from '../src/main/x-listening/capture';
import { DEFAULT_COLLECTION_SETTINGS } from '../src/shared/x-listening-collection-settings';

const CASE = '11111111-1111-4111-8111-111111111111';

/** A manual timer harness — records every scheduled callback so a test can fire it on demand,
 *  instead of racing a real/fake `setInterval`. */
function timerHarness() {
  const timers: { id: number; fn: () => void; ms: number; cleared: boolean }[] = [];
  let nextId = 1;
  return {
    timers,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, fn, ms, cleared: false });
      return id as unknown as ReturnType<typeof setInterval>;
    },
    unschedule: (handle: ReturnType<typeof setInterval>) => {
      const t = timers.find((x) => (x.id as unknown) === handle);
      if (t) t.cleared = true;
    },
    /** Fire every live (non-cleared) sweep/archive callback once. */
    fireAll: () => {
      for (const t of timers) if (!t.cleared) t.fn();
    },
  };
}

function baseDeps(over: Partial<XSchedulerDeps> = {}): XSchedulerDeps {
  const h = timerHarness();
  return {
    loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS }),
    isConnected: async () => true,
    listSources: async () => [
      { channelId: 'alice', channelLabel: '@alice', targetUsername: 'alice' },
    ],
    sweepProfile: async () => ({ blocked: false, added: 1, skipped: 0, posts: [] }),
    archiveProfile: async () => ({ blocked: false, added: 0, skipped: 0, posts: [] }),
    schedule: h.schedule,
    unschedule: h.unschedule,
    now: () => 1_700_000_000_000,
    ...over,
    // Expose the harness for assertions via a non-interface escape hatch.
    __harness: h,
  } as unknown as XSchedulerDeps;
}

beforeEach(() => {
  __resetSchedulerForTests();
});

describe('G1 scheduler — free-running sweep cadence', () => {
  it('(1) enabling the schedule arms a sweep timer at sweepIntervalMinutes and firing it runs a sweep', async () => {
    const sweepProfile = vi.fn(async () => ({ blocked: false, added: 2, skipped: 0, posts: [] }));
    const deps = baseDeps({
      loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS, automaticSweeps: true, sweepIntervalMinutes: 30 }),
      sweepProfile,
    });
    const h = (deps as unknown as { __harness: ReturnType<typeof timerHarness> }).__harness;

    await restartSchedule(CASE, deps);

    // A single sweep timer, armed at 30 minutes (Enterprise minutes*60*1000).
    const live = h.timers.filter((t) => !t.cleared);
    expect(live).toHaveLength(1);
    expect(live[0].ms).toBe(30 * 60 * 1000);
    expect(sweepProfile).not.toHaveBeenCalled();

    // Fire the timer → the sweep runs against the (connected) session's one source.
    h.fireAll();
    await vi.waitFor(() => expect(sweepProfile).toHaveBeenCalledTimes(1));

    const status = scheduleStatus(CASE);
    expect(status.sweepEnabled).toBe(true);
    expect(status.sweepIntervalMinutes).toBe(30);
    expect(status.nextSweepAt).toBeTruthy();
  });

  it('automaticSweeps off arms NO sweep timer', async () => {
    const deps = baseDeps({ loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS, automaticSweeps: false }) });
    const h = (deps as unknown as { __harness: ReturnType<typeof timerHarness> }).__harness;
    await restartSchedule(CASE, deps);
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
    expect(scheduleStatus(CASE).sweepEnabled).toBe(false);
  });
});

describe('G1 scheduler — Tor gate is never bypassed', () => {
  it('(2) a scheduled sweep whose capture is Tor-gate-blocked does NOT capture and reports blocked (no clearnet egress)', async () => {
    // sweepProfile delegates to the real captureProfileTimeline with a blocked gate → no window opens.
    const openWindow = vi.fn();
    const sweepProfile = async (caseId: string, source: { channelId: string; channelLabel: string; targetUsername: string }) =>
      captureProfileTimeline(
        { caseId, channelId: source.channelId, channelLabel: source.channelLabel, targetUsername: source.targetUsername },
        {
          loadClearnetEnabled: async () => false, // Tor mode
          resolveGate: () => ({ blocked: true, reason: 'Tor is not ready — X capture is blocked (no clearnet fallback).' }),
          openWindow: openWindow as unknown as XSchedulerDeps['sweepProfile'] extends never ? never : any, // never called
          capture: vi.fn(),
        },
      );
    const deps = baseDeps({
      loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS, automaticSweeps: true }),
      sweepProfile: sweepProfile as unknown as XSchedulerDeps['sweepProfile'],
    });

    const res = await runScheduledSweep(CASE, deps);

    expect(openWindow).not.toHaveBeenCalled(); // fail closed — nothing egressed
    expect(res.blocked).toBe(true);
    expect(res.swept).toBe(false);
    expect(res.added).toBe(0);
  });

  it('captureProfileTimeline opens NO window when the gate is blocked (fail-closed primitive)', async () => {
    const openWindow = vi.fn();
    const capture = vi.fn();
    const res = await captureProfileTimeline(
      { caseId: CASE, channelId: 'bob', channelLabel: '@bob', targetUsername: 'bob' },
      {
        loadClearnetEnabled: async () => false,
        resolveGate: () => ({ blocked: true, reason: 'blocked' }),
        openWindow: openWindow as never,
        capture: capture as never,
      },
    );
    expect(openWindow).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(res.blocked).toBe(true);
    expect(res.added).toBe(0);
  });

  it('(3) captureProfileTimeline takes the clearnet (no-proxy) path ONLY when clearnet AND clearnetAck are set', async () => {
    const seen: (boolean)[] = [];
    const mkOpen = () => vi.fn(async () => ({ webContents: { setWebRTCIPHandlingPolicy() {} }, isDestroyed: () => false, destroy() {}, show() {}, focus() {} }) as never);
    const runOnce = async (clearnet: boolean, ack: boolean) => {
      const open = mkOpen();
      await captureProfileTimeline(
        { caseId: CASE, channelId: 'c', channelLabel: '@c', targetUsername: 'c' },
        {
          // Production default composes clearnet && clearnetAck; here we feed the composed value.
          loadClearnetEnabled: async () => clearnet && ack,
          resolveGate: (enabled) => {
            seen.push(enabled);
            return enabled ? { blocked: false } : { blocked: false, proxy: { socks: '127.0.0.1:9050' } };
          },
          openWindow: open as never,
          capture: async () => ({ blocked: false, added: 0, skipped: 0, posts: [] }),
        },
      );
      const call = open.mock.calls[0];
      return call ? call[1] : 'no-open';
    };

    // clearnet + ack → clearnet path (NO proxy passed to the window).
    expect(await runOnce(true, true)).toBeUndefined();
    // clearnet but NOT acked → treated as Tor mode (proxy passed).
    expect(await runOnce(true, false)).toEqual({ socks: '127.0.0.1:9050' });
    // no clearnet → Tor mode (proxy passed).
    expect(await runOnce(false, false)).toEqual({ socks: '127.0.0.1:9050' });
    expect(seen).toEqual([true, false, false]);
  });
});

describe('G1 scheduler — halts on disable / disconnect', () => {
  it('(4a) stopSchedule clears the armed timers and firing them is a no-op', async () => {
    const sweepProfile = vi.fn(async () => ({ blocked: false, added: 1, skipped: 0, posts: [] }));
    const deps = baseDeps({
      loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS, automaticSweeps: true }),
      sweepProfile,
    });
    const h = (deps as unknown as { __harness: ReturnType<typeof timerHarness> }).__harness;
    await restartSchedule(CASE, deps);
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);

    stopSchedule(CASE, deps);
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
    h.fireAll(); // all cleared — nothing runs
    await Promise.resolve();
    expect(sweepProfile).not.toHaveBeenCalled();
    expect(scheduleStatus(CASE).sweepEnabled).toBe(false);
  });

  it('(4b) a scheduled sweep while the session is DISCONNECTED captures nothing', async () => {
    const sweepProfile = vi.fn(async () => ({ blocked: false, added: 1, skipped: 0, posts: [] }));
    const deps = baseDeps({
      loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS, automaticSweeps: true }),
      isConnected: async () => false,
      sweepProfile,
    });
    const res = await runScheduledSweep(CASE, deps);
    expect(sweepProfile).not.toHaveBeenCalled();
    expect(res.swept).toBe(false);
    expect(res.reason).toBe('not-connected');
  });

  it('a blocked source halts the sweep before the next source (fail-closed, no further egress)', async () => {
    const sweepProfile = vi
      .fn()
      .mockResolvedValueOnce({ blocked: true, reason: 'Tor down', added: 0, skipped: 0, posts: [] })
      .mockResolvedValue({ blocked: false, added: 5, skipped: 0, posts: [] });
    const deps = baseDeps({
      loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS, automaticSweeps: true }),
      listSources: async () => [
        { channelId: 'a', channelLabel: '@a', targetUsername: 'a' },
        { channelId: 'b', channelLabel: '@b', targetUsername: 'b' },
      ],
      sweepProfile,
    });
    const res = await runScheduledSweep(CASE, deps);
    expect(sweepProfile).toHaveBeenCalledTimes(1); // stopped after the blocked first source
    expect(res.blocked).toBe(true);
    expect(res.swept).toBe(false);
  });
});
