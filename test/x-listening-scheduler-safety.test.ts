/**
 * X Listening Station — scheduler safety + pacing (Task PC1 / audit M5 + M6).
 *
 * M5 GLOBAL COLLECTION MUTEX: Enterprise's single app-wide `sweepRunning` (`main.cjs:56`) lets only ONE
 * collection op run at a time. `runScheduledSweep`/`runScheduledArchive` must acquire the SAME global
 * lock (`collection-lock`) that the manual entrypoints use, and SKIP (background-timer behaviour) when a
 * collection op already holds it — so two campaigns' timers, or a manual op + a background sweep, can
 * never open two hardened capture windows and egress to X simultaneously.
 *
 * M6 PER-TARGET 1500ms SWEEP SPACING: Enterprise `refreshAll` sleeps 1500ms between targets
 * (`main.cjs:1907`) to look less bot-like. `runScheduledSweep` must sleep `interTargetDelayMs`
 * (default 1500) between profiles via the injectable `sleep` seam (testable without real time), and
 * NOT after the last target (nor after a fail-closed halt).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runScheduledSweep, runScheduledArchive, type XSchedulerDeps } from '../src/main/x-listening/scheduler';
import {
  tryAcquireCollectionLock,
  releaseCollectionLock,
  isCollectionInProgress,
  __resetCollectionLockForTests,
} from '../src/main/x-listening/collection-lock';
import { DEFAULT_COLLECTION_SETTINGS } from '../src/shared/x-listening-collection-settings';

const CASE = '22222222-2222-4222-8222-222222222222';

function baseDeps(over: Partial<XSchedulerDeps> = {}): Partial<XSchedulerDeps> {
  return {
    loadSettings: async () => ({ ...DEFAULT_COLLECTION_SETTINGS }),
    isConnected: async () => true,
    listSources: async () => [{ channelId: 'alice', channelLabel: '@alice', targetUsername: 'alice' }],
    sweepProfile: async () => ({ blocked: false, added: 1, skipped: 0, posts: [] }),
    archiveRotate: async () => ({ ran: true, blocked: false, added: 0 }),
    now: () => 1_700_000_000_000,
    sleep: async () => {},
    ...over,
  };
}

beforeEach(() => {
  __resetCollectionLockForTests();
});

describe('M5 — scheduled ops acquire the single global collection mutex', () => {
  it('a scheduled sweep SKIPS when a collection op already holds the global lock (no concurrent egress)', async () => {
    // Simulate a manual capture (or another campaign's sweep) already egressing.
    expect(tryAcquireCollectionLock()).toBe(true);
    let captured = false;
    const res = await runScheduledSweep(
      CASE,
      baseDeps({ sweepProfile: async () => ((captured = true), { blocked: false, added: 1, skipped: 0, posts: [] }) }),
    );
    expect(captured).toBe(false); // never opened a window — the lock was held
    expect(res.swept).toBe(false);
    releaseCollectionLock();
  });

  it('a scheduled archive SKIPS when a collection op already holds the global lock', async () => {
    expect(tryAcquireCollectionLock()).toBe(true);
    let rotated = false;
    const res = await runScheduledArchive(
      CASE,
      baseDeps({ archiveRotate: async () => ((rotated = true), { ran: true, blocked: false, added: 0 }) }),
    );
    expect(rotated).toBe(false);
    expect(res.swept).toBe(false);
    releaseCollectionLock();
  });

  it('two scheduled sweeps cannot run concurrently — the second is refused while the first is in-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let firstCaptures = 0;
    let secondCaptures = 0;

    const first = runScheduledSweep(
      CASE,
      baseDeps({
        sweepProfile: async () => {
          firstCaptures += 1;
          await gate; // park inside the sweep, holding the global lock
          return { blocked: false, added: 1, skipped: 0, posts: [] };
        },
      }),
    );
    // Let the first sweep reach its (parked) capture and take the lock.
    await Promise.resolve();
    await Promise.resolve();

    const second = await runScheduledSweep(
      '33333333-3333-4333-8333-333333333333',
      baseDeps({ sweepProfile: async () => ((secondCaptures += 1), { blocked: false, added: 1, skipped: 0, posts: [] }) }),
    );
    expect(secondCaptures).toBe(0); // refused — first still holds the lock
    expect(second.swept).toBe(false);

    release();
    await first;
    expect(firstCaptures).toBe(1);
    expect(isCollectionInProgress()).toBe(false); // released after the first sweep finished
  });

  it('the lock is released after a normal scheduled sweep so the next op can run', async () => {
    await runScheduledSweep(CASE, baseDeps());
    expect(isCollectionInProgress()).toBe(false);
    await runScheduledArchive(CASE, baseDeps());
    expect(isCollectionInProgress()).toBe(false);
  });

  it('the lock is released even if the sweep throws mid-pass', async () => {
    await expect(
      runScheduledSweep(
        CASE,
        baseDeps({
          sweepProfile: async () => {
            throw new Error('capture blew up');
          },
        }),
      ),
    ).rejects.toThrow('capture blew up');
    expect(isCollectionInProgress()).toBe(false);
  });
});

describe('M6 — per-target 1500ms sweep spacing', () => {
  it('sleeps interTargetDelayMs (default 1500) BETWEEN targets, not after the last', async () => {
    const sleeps: number[] = [];
    await runScheduledSweep(
      CASE,
      baseDeps({
        listSources: async () => [
          { channelId: 'a', channelLabel: '@a', targetUsername: 'a' },
          { channelId: 'b', channelLabel: '@b', targetUsername: 'b' },
          { channelId: 'c', channelLabel: '@c', targetUsername: 'c' },
        ],
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      }),
    );
    // 3 targets → exactly 2 inter-target gaps, each the default 1500ms; none trailing the last.
    expect(sleeps).toEqual([1500, 1500]);
  });

  it('honours an injected interTargetDelayMs override', async () => {
    const sleeps: number[] = [];
    await runScheduledSweep(
      CASE,
      baseDeps({
        interTargetDelayMs: 700,
        listSources: async () => [
          { channelId: 'a', channelLabel: '@a', targetUsername: 'a' },
          { channelId: 'b', channelLabel: '@b', targetUsername: 'b' },
        ],
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      }),
    );
    expect(sleeps).toEqual([700]);
  });

  it('does NOT sleep after a fail-closed halt (blocked source stops the pass, no trailing gap)', async () => {
    const sleeps: number[] = [];
    await runScheduledSweep(
      CASE,
      baseDeps({
        listSources: async () => [
          { channelId: 'a', channelLabel: '@a', targetUsername: 'a' },
          { channelId: 'b', channelLabel: '@b', targetUsername: 'b' },
        ],
        sweepProfile: async () => ({ blocked: true, reason: 'Tor down', added: 0, skipped: 0, posts: [] }),
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      }),
    );
    expect(sleeps).toEqual([]); // halted on the first (blocked) source, no spacing sleep
  });

  it('a single-target sweep sleeps zero times', async () => {
    const sleeps: number[] = [];
    await runScheduledSweep(
      CASE,
      baseDeps({ sleep: async (ms: number) => void sleeps.push(ms) }),
    );
    expect(sleeps).toEqual([]);
  });
});
