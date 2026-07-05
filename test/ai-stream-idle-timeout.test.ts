import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readWithIdleTimeout, CHAT_IDLE_TIMEOUT_MS } from '../src/main/services/ai-stream-util';

/**
 * Root cause (GhostExodus "assistant stops responding" hang): the chat stream loop awaited
 * reader.read() with NO inactivity bound, so a silently-stalled Ollama generation blocked forever
 * and never emitted `done`. This helper puts a wall-clock idle ceiling on each read so a stall
 * surfaces as a rejection (→ the chat catch emits {error, done:true}) instead of an infinite hang.
 */
describe('readWithIdleTimeout — chat stall watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rejects when the reader produces no data within the idle window', async () => {
    const reader = { read: () => new Promise(() => {}), cancel: vi.fn(() => Promise.resolve()) } as never;
    const p = readWithIdleTimeout(reader, 1000);
    const assertion = expect(p).rejects.toThrow(/stopped responding|no output|idle/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('resolves with the chunk when the reader responds in time', async () => {
    const chunk = { value: new Uint8Array([1, 2, 3]), done: false };
    const reader = { read: () => Promise.resolve(chunk) } as never;
    await expect(readWithIdleTimeout(reader, 1000)).resolves.toEqual(chunk);
  });

  it('clears its timer once the read resolves (no late rejection / unhandled rejection)', async () => {
    const reader = { read: () => Promise.resolve({ value: undefined, done: true }) } as never;
    const res = await readWithIdleTimeout(reader, 1000);
    expect(res.done).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); // timer already cleared — nothing fires
  });

  it('ships a sane default idle ceiling (survives a cold model load, still bounded)', () => {
    expect(CHAT_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(CHAT_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});
