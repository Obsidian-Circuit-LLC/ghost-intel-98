/**
 * X Listening Station — global collection mutex (Task PC1 / audit M5).
 *
 * Enterprise runs a single app-wide `sweepRunning` boolean (`electron/main.cjs:56`) that EVERY
 * collection entrypoint (manual sweep, scheduled sweep, archive cycle, network capture, live verify)
 * acquires before it opens a capture window and releases in `finally` — so only ONE collection op
 * ever egresses to X at a time. Our rebuild had per-campaign `sweepRunning`/`archiveRunning` guards
 * with NO cross-guard, so two campaigns' background timers (or a manual op racing a background sweep)
 * could open two hardened capture windows and egress simultaneously (rate-limit / detection risk).
 *
 * This exercises the module-level mutex primitive directly: acquisition is exclusive, release frees
 * it, `withCollectionLock` throws on contention (Enterprise's manual "already running" throw) and
 * releases even when the guarded body throws.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  tryAcquireCollectionLock,
  releaseCollectionLock,
  isCollectionInProgress,
  withCollectionLock,
  withQueuedCollectionLock,
  describeCollectionHolder,
  touchCollectionLock,
  STALE_HOLD_MS,
  __resetCollectionLockForTests,
} from '../src/main/x-listening/collection-lock';

beforeEach(() => {
  __resetCollectionLockForTests();
});

describe('collection-lock — the single app-wide collection mutex (M5)', () => {
  it('a second acquire while held is refused; release frees it', () => {
    expect(isCollectionInProgress()).toBe(false);
    expect(tryAcquireCollectionLock()).toBe(true);
    expect(isCollectionInProgress()).toBe(true);
    // Contention: a second op cannot acquire while the first holds it.
    expect(tryAcquireCollectionLock()).toBe(false);
    releaseCollectionLock();
    expect(isCollectionInProgress()).toBe(false);
    // Freed — the next op can acquire.
    expect(tryAcquireCollectionLock()).toBe(true);
    releaseCollectionLock();
  });

  it('withCollectionLock runs the body exclusively and releases after it settles', async () => {
    let ran = false;
    const out = await withCollectionLock(async () => {
      ran = true;
      // While the body runs the lock is held — a contending op is refused.
      expect(isCollectionInProgress()).toBe(true);
      expect(tryAcquireCollectionLock()).toBe(false);
      return 42;
    });
    expect(ran).toBe(true);
    expect(out).toBe(42);
    expect(isCollectionInProgress()).toBe(false);
  });

  it('withCollectionLock THROWS on contention (Enterprise manual "already running")', async () => {
    expect(tryAcquireCollectionLock()).toBe(true);
    await expect(withCollectionLock(async () => 'nope')).rejects.toThrow(/already running/i);
    releaseCollectionLock();
  });

  it('withCollectionLock releases the lock even when the guarded body throws', async () => {
    await expect(
      withCollectionLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // finally-released — not left stuck locked.
    expect(isCollectionInProgress()).toBe(false);
    expect(tryAcquireCollectionLock()).toBe(true);
    releaseCollectionLock();
  });

  it('two overlapping withCollectionLock bodies never run concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    // First op enters and PARKS inside the lock until we release the gate.
    const first = withCollectionLock(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return 'first';
    });

    // Second op attempts while the first holds the lock → refused (throws), never runs its body.
    await expect(withCollectionLock(async () => 'second')).rejects.toThrow(/already running/i);
    expect(maxActive).toBe(1);

    release();
    await expect(first).resolves.toBe('first');
    expect(isCollectionInProgress()).toBe(false);
  });
});

/**
 * FIELD BUG (GhostExodus, v3.72.2): every EXTRACT FOLLOWERS / FOLLOWING press returned
 * "Another collection operation is already running." with nothing else visibly running.
 *
 * The mutex is correct in isolation (every holder releases in `finally`), so a permanently-held
 * lock means a holder is HUNG inside it — every collection op awaits `loadURL`, which had no
 * timeout, so one stalled navigation over Tor wedges collection for the rest of the session.
 *
 * Two defences: the lock names its holder and its age so the failure is self-describing rather
 * than opaque, and a holder that has stopped making progress goes STALE and can be broken instead
 * of wedging the module until the app restarts.
 */
describe('collection-lock — self-describing holder + stale-hold recovery', () => {
  it('names the holder and its age when a manual op is refused', async () => {
    let clock = 1_000;
    tryAcquireCollectionLock('scheduled sweep of @acme', () => clock);
    clock += 47_000;
    await expect(withCollectionLock(async () => 'x', 'network capture', () => clock)).rejects.toThrow(
      /scheduled sweep of @acme/,
    );
    await expect(withCollectionLock(async () => 'x', 'network capture', () => clock)).rejects.toThrow(/47s/);
  });

  it('reports who holds the lock and for how long', () => {
    let clock = 5_000;
    expect(describeCollectionHolder(() => clock)).toBeNull();
    tryAcquireCollectionLock('archive tick', () => clock);
    clock += 3_000;
    expect(describeCollectionHolder(() => clock)).toEqual({ owner: 'archive tick', heldMs: 3_000, stale: false });
  });

  it('a holder that stops making progress goes stale and is broken by the next contender', async () => {
    let clock = 0;
    tryAcquireCollectionLock('hung sweep', () => clock);
    clock += STALE_HOLD_MS - 1;
    expect(tryAcquireCollectionLock('later op', () => clock)).toBe(false);
    clock += 2; // now past the stale threshold
    expect(describeCollectionHolder(() => clock)?.stale).toBe(true);
    // The contender takes the lock rather than being refused for the rest of the session.
    const out = await withCollectionLock(async () => 'ran', 'network capture', () => clock);
    expect(out).toBe('ran');
  });

  it('a holder that keeps touching the lock never goes stale', () => {
    let clock = 0;
    tryAcquireCollectionLock('long but healthy sweep', () => clock);
    for (let i = 0; i < 10; i += 1) {
      clock += STALE_HOLD_MS - 1;
      touchCollectionLock(() => clock);
    }
    clock += 1_000;
    expect(describeCollectionHolder(() => clock)?.stale).toBe(false);
    expect(tryAcquireCollectionLock('other', () => clock)).toBe(false);
  });

  it('a stale break does not corrupt the lock — the breaker still owns it exclusively', () => {
    let clock = 0;
    tryAcquireCollectionLock('hung sweep', () => clock);
    clock += STALE_HOLD_MS + 1;
    expect(tryAcquireCollectionLock('breaker', () => clock)).toBe(true);
    expect(tryAcquireCollectionLock('third', () => clock)).toBe(false);
    expect(describeCollectionHolder(() => clock)?.owner).toBe('breaker');
  });
});

/**
 * Operator decision (2026-08-19): a MANUAL collection op contending with a legitimately-running
 * background sweep should QUEUE behind it rather than fail, while the holder is named (and aged) so
 * a wedge is still distinguishable from ordinary contention.
 */
describe('collection-lock — manual ops queue behind a live holder', () => {
  /** A scheduler whose pending waits fire only when the test advances them. */
  function fakeWaits() {
    const pending: Array<() => void> = [];
    return {
      wait: (_ms: number) => new Promise<void>((resolve) => pending.push(resolve)),
      flush: async () => {
        const due = pending.splice(0, pending.length);
        due.forEach((r) => r());
        await Promise.resolve();
        await Promise.resolve();
      },
      count: () => pending.length,
    };
  }

  it('runs immediately when the lock is free', async () => {
    const w = fakeWaits();
    const out = await withQueuedCollectionLock(async () => 'ran', 'network capture', { wait: w.wait });
    expect(out).toBe('ran');
    expect(w.count()).toBe(0);
  });

  it('waits for a live holder and then runs, instead of throwing', async () => {
    const w = fakeWaits();
    let clock = 0;
    tryAcquireCollectionLock('scheduled sweep', () => clock);
    let ran = false;
    const p = withQueuedCollectionLock(async () => { ran = true; return 'ran'; }, 'network capture', {
      wait: w.wait,
      now: () => clock,
    });
    await w.flush();
    expect(ran, 'must not run while the sweep holds the lock').toBe(false);
    releaseCollectionLock();
    await w.flush();
    await expect(p).resolves.toBe('ran');
  });

  it('reports what it is waiting for, naming the holder and its age', async () => {
    const w = fakeWaits();
    let clock = 0;
    tryAcquireCollectionLock('scheduled sweep', () => clock);
    const seen: string[] = [];
    const p = withQueuedCollectionLock(async () => 'ran', 'network capture', {
      wait: w.wait,
      now: () => clock,
      onWait: (msg) => seen.push(msg),
    });
    clock += 47_000;
    await w.flush();
    releaseCollectionLock();
    await w.flush();
    await p;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/scheduled sweep/);
    expect(seen.join(' ')).toMatch(/47s|0s/);
  });

  it('gives up with a NAMED error rather than waiting forever', async () => {
    const w = fakeWaits();
    let clock = 0;
    tryAcquireCollectionLock('scheduled sweep', () => clock);
    const p = withQueuedCollectionLock(async () => 'ran', 'network capture', {
      wait: w.wait,
      now: () => clock,
      maxWaitMs: 10_000,
    });
    const rejected = expect(p).rejects.toThrow(/scheduled sweep/);
    clock += 11_000;
    await w.flush();
    await rejected;
  });

  it('still releases the lock when the queued body throws', async () => {
    const w = fakeWaits();
    await expect(
      withQueuedCollectionLock(async () => { throw new Error('boom'); }, 'network capture', { wait: w.wait }),
    ).rejects.toThrow('boom');
    expect(isCollectionInProgress()).toBe(false);
  });
});
