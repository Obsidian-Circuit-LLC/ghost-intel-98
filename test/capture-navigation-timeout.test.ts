/**
 * Bounded navigation for every capture window.
 *
 * FIELD BUG (GhostExodus, v3.72.2): "EXTRACT FOLLOWERS" always answered "Another collection
 * operation is already running." Every collection op runs inside the app-wide collection mutex and
 * awaits `loadURL`, which had NO timeout — so a single navigation that stalls (routinely possible
 * over Tor: a dead exit, a hanging subresource) holds the mutex for the rest of the session and
 * disables all collection until the app restarts.
 *
 * A navigation must therefore FAIL rather than hang. Failing releases the mutex through the existing
 * `finally`, and the operation is reported as blocked — the module's established fail-closed posture.
 */
import { describe, it, expect, vi } from 'vitest';
import { withNavigationTimeout } from '../src/main/capture/nav-timeout';

/** A scheduler whose pending timers fire only when the test says so. */
function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false };
      pending.push(t);
      return t as unknown;
    },
    cancel: (h: unknown) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
    fireAll: () => pending.filter((t) => !t.cancelled).forEach((t) => t.fn()),
    pending,
  };
}

describe('withNavigationTimeout', () => {
  it('returns the navigation result when it settles in time', async () => {
    const t = fakeTimers();
    const out = await withNavigationTimeout(async () => 'loaded', 90_000, 'https://x.com/acme', t.schedule, t.cancel);
    expect(out).toBe('loaded');
  });

  it('cancels its timer once the navigation settles (no leaked handle)', async () => {
    const t = fakeTimers();
    await withNavigationTimeout(async () => 'loaded', 90_000, 'https://x.com/acme', t.schedule, t.cancel);
    expect(t.pending.every((p) => p.cancelled)).toBe(true);
  });

  it('REJECTS a navigation that never settles, instead of hanging forever', async () => {
    const t = fakeTimers();
    const hang = new Promise<string>(() => {}); // never resolves — the wedged Tor navigation
    const p = withNavigationTimeout(() => hang, 90_000, 'https://x.com/acme', t.schedule, t.cancel);
    t.fireAll();
    await expect(p).rejects.toThrow(/timed out/i);
  });

  it('names the target in the timeout error so a wedged load is diagnosable', async () => {
    const t = fakeTimers();
    const p = withNavigationTimeout(() => new Promise<string>(() => {}), 1_000, 'https://x.com/acme/followers', t.schedule, t.cancel);
    t.fireAll();
    await expect(p).rejects.toThrow(/x\.com\/acme\/followers/);
  });

  it('propagates a real navigation failure unchanged', async () => {
    const t = fakeTimers();
    await expect(
      withNavigationTimeout(async () => { throw new Error('ERR_CONNECTION_REFUSED'); }, 90_000, 'https://x.com/a', t.schedule, t.cancel),
    ).rejects.toThrow('ERR_CONNECTION_REFUSED');
  });
});
