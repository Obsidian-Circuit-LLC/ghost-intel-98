/**
 * Task 10: station reachability — withTimeout + testStation.
 *
 * `testStation` goes through the SAME egress gate as playback (resolveSource): when streaming is
 * off it must return 'off' without ever touching the network (no Hls/Audio construction).
 */
import { describe, it, expect, vi } from 'vitest';
import { withTimeout, testStation } from '../src/renderer/modules/media/station-test';

describe('withTimeout', () => {
  it('rejects with timeout when the promise is slow', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 8000);
    const expectation = expect(p).rejects.toBe('timeout');
    vi.advanceTimersByTime(8000);
    await expectation;
    vi.useRealTimers();
  });
});

describe('testStation', () => {
  it('short-circuits to "off" when streaming is disabled', async () => {
    expect(await testStation('https://s/x.m3u8', false)).toBe('off');
  });
});
