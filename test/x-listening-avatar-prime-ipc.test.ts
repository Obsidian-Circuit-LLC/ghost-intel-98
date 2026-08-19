/**
 * Display pics have failed silently across three releases (GhostExodus: "It's still not extracting
 * the display photos… it was a back and forth pain"). The pipeline is fire-and-forget: every pass
 * runs in the background and DISCARDS its result, so a fail-closed gate, an empty candidate list, or
 * a fetch failure all look identical from the UI — monograms, no message, nothing to report.
 *
 * The gate is the leading suspect, because the app uses TWO different clearnet gates:
 *   manual capture  → settings.xListening.clearnet
 *   avatar passes   → clearnet AND clearnetAck   (requireAckedClearnet)
 * so an install with clearnet on but the acknowledgement never recorded captures happily while every
 * avatar pass resolves to Tor, finds it absent, and refuses — invisibly.
 *
 * This makes the pass OBSERVABLE and user-triggerable: it reports what happened, in the user's words,
 * whatever the reason turns out to be.
 */
import { describe, it, expect, vi } from 'vitest';
import { summarizeAvatarRun, fetchDisplayPicturesNow } from '../src/main/x-listening/avatar-maintenance';

describe('summarizeAvatarRun — the pass explains itself', () => {
  it('names the acknowledgement as the blocker when clearnet is on but unacknowledged', () => {
    const s = summarizeAvatarRun(
      { scanned: 22, skipped: 0, visited: 0, cached: 0, blocked: true, reason: 'Tor is not ready — X capture is blocked.' },
      { clearnet: true, clearnetAck: false },
    );
    expect(s.ok).toBe(false);
    expect(s.message).toMatch(/acknowledg/i);
    expect(s.needsClearnetAck).toBe(true);
  });

  it('reports a plain Tor block when clearnet was never enabled at all', () => {
    const s = summarizeAvatarRun(
      { scanned: 5, skipped: 0, visited: 0, cached: 0, blocked: true, reason: 'Tor is not ready.' },
      { clearnet: false, clearnetAck: false },
    );
    expect(s.ok).toBe(false);
    expect(s.needsClearnetAck).toBe(false);
    expect(s.message).toMatch(/Tor/i);
  });

  it('reports how many pictures it actually fetched', () => {
    const s = summarizeAvatarRun(
      { scanned: 22, skipped: 4, visited: 18, cached: 14, blocked: false },
      { clearnet: true, clearnetAck: true },
    );
    expect(s.ok).toBe(true);
    expect(s.message).toMatch(/14/);
  });

  it('says plainly when there was nothing to fetch, rather than looking like success', () => {
    const s = summarizeAvatarRun(
      { scanned: 0, skipped: 0, visited: 0, cached: 0, blocked: false },
      { clearnet: true, clearnetAck: true },
    );
    expect(s.ok).toBe(true);
    expect(s.message).toMatch(/no accounts|nothing/i);
  });

  it('distinguishes "already had them all" from "found none"', () => {
    const s = summarizeAvatarRun(
      { scanned: 22, skipped: 22, visited: 0, cached: 0, blocked: false },
      { clearnet: true, clearnetAck: true },
    );
    expect(s.message).toMatch(/already/i);
  });

  it('reports visits that yielded no readable picture instead of silently counting them as done', () => {
    const s = summarizeAvatarRun(
      { scanned: 9, skipped: 0, visited: 9, cached: 0, blocked: false },
      { clearnet: true, clearnetAck: true },
    );
    expect(s.ok).toBe(false);
    expect(s.message).toMatch(/9/);
    expect(s.message).toMatch(/no picture|could not/i);
  });
});

/**
 * The manual "Fetch display pictures" action. Unlike the background maintenance pass (which skips
 * when the collection mutex is busy), a user-initiated fetch QUEUES behind a live holder — the same
 * decision applied to the other manual collection entrypoints — and always returns a readable result.
 */
describe('fetchDisplayPicturesNow', () => {
  const CASE = '55555555-5555-4555-8555-555555555555';

  function deps(over: Partial<Parameters<typeof fetchDisplayPicturesNow>[1]> = {}) {
    return {
      repair: vi.fn(async () => ({ scanned: 3, skipped: 1, visited: 2, cached: 2, blocked: false })),
      prime: vi.fn(async () => ({ scanned: 22, skipped: 4, visited: 18, cached: 12, blocked: false })),
      readSettings: vi.fn(async () => ({ clearnet: true, clearnetAck: true })),
      ...over,
    };
  }

  it('combines both passes and reports the total fetched', async () => {
    const d = deps();
    const s = await fetchDisplayPicturesNow(CASE, d);
    expect(d.repair).toHaveBeenCalledWith(CASE);
    expect(d.prime).toHaveBeenCalledWith(CASE);
    expect(s.outcome.cached).toBe(14);
    expect(s.message).toMatch(/14/);
    expect(s.ok).toBe(true);
  });

  it('surfaces a blocked gate with the acknowledgement wording', async () => {
    const d = deps({
      repair: vi.fn(async () => ({ scanned: 3, skipped: 0, visited: 0, cached: 0, blocked: true, reason: 'Tor is not ready.' })),
      prime: vi.fn(async () => ({ scanned: 22, skipped: 0, visited: 0, cached: 0, blocked: true, reason: 'Tor is not ready.' })),
      readSettings: vi.fn(async () => ({ clearnet: true, clearnetAck: false })),
    });
    const s = await fetchDisplayPicturesNow(CASE, d);
    expect(s.ok).toBe(false);
    expect(s.needsClearnetAck).toBe(true);
    expect(s.message).toMatch(/acknowledg/i);
  });

  it('still reports when one pass is blocked and the other is not', async () => {
    const d = deps({
      repair: vi.fn(async () => ({ scanned: 3, skipped: 0, visited: 0, cached: 0, blocked: true, reason: 'Tor is not ready.' })),
    });
    const s = await fetchDisplayPicturesNow(CASE, d);
    expect(s.outcome.cached).toBe(12);
    expect(s.ok).toBe(true);
  });

  it('never throws at the IPC boundary — a failed pass becomes a readable message', async () => {
    const d = deps({ prime: vi.fn(async () => { throw new Error('window gone'); }) });
    const s = await fetchDisplayPicturesNow(CASE, d);
    expect(s.message).toBeTruthy();
    expect(s.outcome.cached).toBe(2);
  });
});
