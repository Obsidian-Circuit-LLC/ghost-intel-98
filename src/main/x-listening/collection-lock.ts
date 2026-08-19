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

/** Injectable clock so staleness is testable without wall-clock sleeps (determinism rule). */
export type Now = () => number;
const wallClock: Now = () => Date.now();

/**
 * A holder that has not reported progress for this long is treated as STALE and may be broken by the
 * next contender. Every collection op reports progress between targets / scroll passes, and every
 * navigation is itself bounded, so a healthy op never approaches this — only a wedged one does.
 *
 * FIELD BUG (v3.72.2): with no staleness notion, one hung navigation held this mutex for the rest of
 * the session and EVERY later collection op ("EXTRACT FOLLOWERS", live verify, archive) was refused
 * with an opaque "Another collection operation is already running." until the app was restarted.
 */
export const STALE_HOLD_MS = 3 * 60_000;

interface Holder {
  owner: string;
  acquiredAt: number;
  lastProgressAt: number;
}

let holder: Holder | null = null;

/** True iff a collection operation currently holds the global lock. */
export function isCollectionInProgress(): boolean {
  return holder !== null;
}

/** Who holds the lock, how long they have held it, and whether they have gone stale. */
export function describeCollectionHolder(
  now: Now = wallClock,
): { owner: string; heldMs: number; stale: boolean } | null {
  if (!holder) return null;
  const t = now();
  return {
    owner: holder.owner,
    heldMs: t - holder.acquiredAt,
    stale: t - holder.lastProgressAt > STALE_HOLD_MS,
  };
}

/** Report progress, so a long BUT HEALTHY operation is never mistaken for a wedged one. */
export function touchCollectionLock(now: Now = wallClock): void {
  if (holder) holder.lastProgressAt = now();
}

/**
 * Atomically acquire the global collection lock, or return `false` if another operation holds it —
 * the SKIP path a background timer takes. A holder that has gone STALE is broken and replaced, so a
 * wedged operation cannot disable collection for the rest of the session.
 *
 * Still atomic: no `await` between the read and the write, and the process is single-threaded.
 */
export function tryAcquireCollectionLock(owner = 'collection', now: Now = wallClock): boolean {
  const t = now();
  if (holder && t - holder.lastProgressAt <= STALE_HOLD_MS) return false;
  holder = { owner, acquiredAt: t, lastProgressAt: t };
  return true;
}

/** Release the global collection lock. Idempotent — releasing an already-free lock is a no-op. */
export function releaseCollectionLock(): void {
  holder = null;
}

/** Human-readable age, e.g. `47s` / `4m12s` — for the contention message the operator actually reads. */
function humanAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Run `fn` while holding the global collection lock, releasing it in `finally` (even if `fn` throws).
 * On contention this THROWS, naming the holder and its age — an opaque "already running" left the
 * operator with nothing to act on when the lock was wedged.
 */
export async function withCollectionLock<T>(
  fn: () => Promise<T> | T,
  owner = 'collection',
  now: Now = wallClock,
): Promise<T> {
  const held = describeCollectionHolder(now);
  if (!tryAcquireCollectionLock(owner, now)) {
    throw new Error(
      held
        ? `Another collection operation is already running (${held.owner}, running ${humanAge(held.heldMs)}).`
        : 'Another collection operation is already running.',
    );
  }
  try {
    return await fn();
  } finally {
    releaseCollectionLock();
  }
}


/** Poll interval while a manual op waits for the lock. Short enough to feel responsive, long enough
 *  not to spin — the wait is idle, not a busy loop. */
export const QUEUE_POLL_MS = 500;
/** How long a queued manual op waits before giving up with a NAMED error. */
export const QUEUE_MAX_WAIT_MS = 5 * 60_000;

export interface QueuedLockOptions {
  /** Idle for `ms`; injected so queueing is testable without wall-clock waits. */
  wait?: (ms: number) => Promise<void>;
  now?: Now;
  /** Called while waiting, with a human message naming the holder — drives the renderer's indicator. */
  onWait?: (message: string) => void;
  maxWaitMs?: number;
}

/**
 * Run `fn` under the collection lock, QUEUEING behind a live holder instead of failing immediately
 * (operator decision, 2026-08-19: a manual press should not lose a race with a background sweep).
 * While waiting it reports the holder and its age through `onWait`, so ordinary contention is
 * visibly different from a wedge; if the holder never frees the lock within `maxWaitMs` it rejects
 * with that same naming rather than waiting forever. A stale holder is broken by `tryAcquire`, so a
 * wedged operation cannot make this wait out its full budget.
 */
export async function withQueuedCollectionLock<T>(
  fn: () => Promise<T> | T,
  owner = 'collection',
  opts: QueuedLockOptions = {},
): Promise<T> {
  const now = opts.now ?? wallClock;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxWaitMs = opts.maxWaitMs ?? QUEUE_MAX_WAIT_MS;
  const startedAt = now();
  let last: { owner: string; heldMs: number } | null = null;

  while (!tryAcquireCollectionLock(owner, now)) {
    const held = describeCollectionHolder(now);
    if (held) {
      last = held;
      opts.onWait?.(`Waiting for ${held.owner} (running ${humanAge(held.heldMs)})…`);
    }
    if (now() - startedAt >= maxWaitMs) {
      throw new Error(
        last
          ? `Gave up waiting for ${last.owner} (still running after ${humanAge(now() - startedAt)}).`
          : 'Another collection operation is already running.',
      );
    }
    await wait(QUEUE_POLL_MS);
  }
  try {
    return await fn();
  } finally {
    releaseCollectionLock();
  }
}

/** Test-only: force the lock free so each test starts clean. */
export function __resetCollectionLockForTests(): void {
  holder = null;
}
