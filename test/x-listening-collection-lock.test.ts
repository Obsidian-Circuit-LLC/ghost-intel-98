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
