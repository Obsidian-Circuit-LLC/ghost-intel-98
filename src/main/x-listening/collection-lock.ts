/**
 * X Listening Station — the single app-wide COLLECTION MUTEX (audit M5).
 *
 * Enterprise runs one process-global `sweepRunning` boolean (`electron/main.cjs:56`). Every collection
 * entrypoint acquires it before opening a capture window and releases it in `finally`:
 *   - `refreshProfile` / `refreshAll` (manual + auto sweep)  `main.cjs:1836,1869,1907`
 *   - `runArchiveCycle`   (manual + auto incremental archive) `main.cjs:1962,1971,2053`
 *   - `verifyPostLive` / relationship capture (live verify + network) `main.cjs:2425,2427,2452`
 * so ONLY ONE collection operation ever egresses to X at a time. A manual op contending with a held
 * lock THROWS ("already running", `main.cjs:1836`); a background TIMER simply SKIPS the tick
 * (`if (!sweepRunning && …)`, `main.cjs:1919,2065`).
 *
 * Our rebuild had scattered per-campaign `sweepRunning`/`archiveRunning` guards with NO cross-guard, so
 * two campaigns' background timers — or a manual capture racing a background sweep — could open two
 * hardened capture windows and egress to X simultaneously (rate-limit / bot-detection risk). This
 * module restores the single global mutex ALL collection entrypoints share.
 *
 * This is a plain module-level boolean, which is sufficient and correct: the renderer/main process is
 * single-threaded and there is NO `await` between the read and the write in `tryAcquireCollectionLock`,
 * so the check-then-set is atomic — no two callers can both observe `false` and both acquire.
 *
 * Quarantine-clean: no electron / Tor / bgconn / secure-fs import — pure in-process state.
 */

let running = false;

/** True iff a collection operation currently holds the global lock. */
export function isCollectionInProgress(): boolean {
  return running;
}

/**
 * Atomically acquire the global collection lock. Returns `true` if acquired (the caller now OWNS the
 * lock and MUST `releaseCollectionLock()` in a `finally`), or `false` if another operation already
 * holds it — the SKIP path a background timer takes (Enterprise `if (!sweepRunning && …)`).
 */
export function tryAcquireCollectionLock(): boolean {
  if (running) return false;
  running = true;
  return true;
}

/** Release the global collection lock. Idempotent — releasing an already-free lock is a no-op. */
export function releaseCollectionLock(): void {
  running = false;
}

/**
 * Run `fn` while holding the global collection lock, releasing it in `finally` (even if `fn` throws).
 * On contention this THROWS — the Enterprise manual-entrypoint behaviour ("Another collection operation
 * is already running.", `main.cjs:1836,1962`). Use this for user-initiated (manual) collection ops
 * that should surface a clear error rather than silently no-op; use `tryAcquireCollectionLock` for
 * background timers that should skip the tick.
 */
export async function withCollectionLock<T>(fn: () => Promise<T> | T): Promise<T> {
  if (!tryAcquireCollectionLock()) {
    throw new Error('Another collection operation is already running.');
  }
  try {
    return await fn();
  } finally {
    releaseCollectionLock();
  }
}

/** Test-only: force the lock free so each test starts clean. */
export function __resetCollectionLockForTests(): void {
  running = false;
}
