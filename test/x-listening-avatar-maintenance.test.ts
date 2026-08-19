/**
 * Background avatar maintenance (repair + entity priming) must respect the collection mutex.
 *
 * The post-capture avatar repair was fire-and-forget INSIDE the locked body, so its capture window
 * opened and egressed after the mutex had already been released — precisely the concurrent-egress
 * the mutex exists to prevent. Maintenance now takes the lock itself and SKIPS when busy (background
 * work, so skipping is correct — the next capture retries), and entity priming (operator decision,
 * 2026-08-19) rides the same acquisition rather than opening a second window of its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAvatarMaintenance } from '../src/main/x-listening/avatar-maintenance';
import {
  tryAcquireCollectionLock,
  releaseCollectionLock,
  isCollectionInProgress,
  __resetCollectionLockForTests,
} from '../src/main/x-listening/collection-lock';

const CASE = '44444444-4444-4444-8444-444444444444';

beforeEach(() => __resetCollectionLockForTests());

function deps(over: Partial<Parameters<typeof runAvatarMaintenance>[1]> = {}) {
  return {
    repair: vi.fn(async () => undefined),
    prime: vi.fn(async () => undefined),
    warn: vi.fn(),
    ...over,
  };
}

describe('runAvatarMaintenance', () => {
  it('repairs and primes when the collection lock is free', async () => {
    const d = deps();
    await runAvatarMaintenance(CASE, d);
    expect(d.repair).toHaveBeenCalledWith(CASE);
    expect(d.prime).toHaveBeenCalledWith(CASE);
  });

  it('SKIPS entirely while another collection op holds the lock (no second window)', async () => {
    const d = deps();
    tryAcquireCollectionLock('scheduled sweep');
    await runAvatarMaintenance(CASE, d);
    expect(d.repair).not.toHaveBeenCalled();
    expect(d.prime).not.toHaveBeenCalled();
  });

  it('releases the lock afterwards so the next operation is not blocked', async () => {
    await runAvatarMaintenance(CASE, deps());
    expect(isCollectionInProgress()).toBe(false);
  });

  it('releases the lock even when repair throws, and still attempts priming', async () => {
    const d = deps({ repair: vi.fn(async () => { throw new Error('repair boom'); }) });
    await runAvatarMaintenance(CASE, d);
    expect(d.prime).toHaveBeenCalled();
    expect(isCollectionInProgress()).toBe(false);
    expect(d.warn).toHaveBeenCalled();
  });

  it('never throws at its caller — maintenance is best-effort', async () => {
    const d = deps({
      repair: vi.fn(async () => { throw new Error('a'); }),
      prime: vi.fn(async () => { throw new Error('b'); }),
    });
    await expect(runAvatarMaintenance(CASE, d)).resolves.toBeUndefined();
    expect(isCollectionInProgress()).toBe(false);
  });

  it('holds the lock while it runs (proved by observing it from inside)', async () => {
    let heldDuring = false;
    const d = deps({ repair: vi.fn(async () => { heldDuring = isCollectionInProgress(); }) });
    await runAvatarMaintenance(CASE, d);
    expect(heldDuring).toBe(true);
  });
});
