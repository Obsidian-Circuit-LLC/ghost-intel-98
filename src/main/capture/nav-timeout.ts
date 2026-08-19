/**
 * Bounded navigation for hardened capture windows.
 *
 * Every X Listening collection operation runs inside the app-wide collection mutex and awaits a
 * navigation. `webContents.loadURL()` has no inherent deadline, and over Tor a navigation can stall
 * indefinitely (a dead exit, a hanging subresource). A stalled navigation therefore held the mutex
 * for the rest of the session, and every later collection op — manual follower extraction, live
 * verify, archive tick — was refused with "Another collection operation is already running" until
 * the app was restarted (GhostExodus field report, v3.72.2).
 *
 * Bounding the navigation converts that silent wedge into an ordinary failure: the mutex is released
 * by the caller's existing `finally`, and the operation reports blocked — the module's established
 * fail-closed posture. Timers are injected so the behaviour is testable without wall-clock waits.
 */

/** Ceiling for one capture-window navigation. Generous, because Tor is slow — but finite. */
export const NAVIGATION_TIMEOUT_MS = 90_000;

type Schedule = (fn: () => void, ms: number) => unknown;
type Cancel = (handle: unknown) => void;

/**
 * Run `navigate` with a deadline. Resolves with its result, propagates its failure unchanged, or
 * rejects with a timeout naming `target` if it never settles. The timer is always cancelled, so a
 * settled navigation never leaves a handle pending.
 */
export async function withNavigationTimeout<T>(
  navigate: () => Promise<T>,
  ms: number = NAVIGATION_TIMEOUT_MS,
  target = '',
  schedule: Schedule = setTimeout,
  cancel: Cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
): Promise<T> {
  let handle: unknown;
  const deadline = new Promise<never>((_resolve, reject) => {
    handle = schedule(() => {
      reject(new Error(`Navigation timed out after ${Math.round(ms / 1000)}s${target ? `: ${target}` : ''}`));
    }, ms);
  });
  try {
    return await Promise.race([navigate(), deadline]);
  } finally {
    cancel(handle);
  }
}
