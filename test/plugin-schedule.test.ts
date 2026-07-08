import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  schedulePluginTask,
  disposePluginSchedules,
  disposeAllSchedules,
  _resetSchedulesForTest,
  MIN_SCHEDULE_MS
} from '../src/main/plugins/schedule';

/**
 * Host-owned background-timer registry for plugins holding the `background-tasks` capability.
 * Timers are keyed by plugin id so a per-plugin teardown (or app quit) can clear them without
 * orphaning anything running on the host event loop. A min-interval clamp keeps a plugin from
 * busy-spinning the host; a throwing task must never crash the interval (or the host loop).
 */
describe('plugin schedule registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSchedulesForTest();
  });
  afterEach(() => {
    _resetSchedulesForTest();
    vi.useRealTimers();
  });

  it('fires fn on every interval tick', () => {
    const fn = vi.fn();
    schedulePluginTask('p', 60_000, fn);
    vi.advanceTimersByTime(180_000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('dispose() stops further calls', () => {
    const fn = vi.fn();
    const handle = schedulePluginTask('p', 60_000, fn);
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    handle.dispose();
    vi.advanceTimersByTime(180_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clamps an interval below MIN_SCHEDULE_MS up to MIN_SCHEDULE_MS', () => {
    const fn = vi.fn();
    schedulePluginTask('p', 1000, fn);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN_SCHEDULE_MS - 1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing task — the interval keeps firing on later ticks', () => {
    const fn = vi.fn(() => {
      throw new Error('boom');
    });
    schedulePluginTask('p', 60_000, fn);
    expect(() => vi.advanceTimersByTime(180_000)).not.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('disposePluginSchedules(id) clears all of that plugin\'s timers, leaving another plugin unaffected', () => {
    const fnP1 = vi.fn();
    const fnP2 = vi.fn();
    const fnQ = vi.fn();
    schedulePluginTask('p', 60_000, fnP1);
    schedulePluginTask('p', 60_000, fnP2);
    schedulePluginTask('q', 60_000, fnQ);

    disposePluginSchedules('p');
    vi.advanceTimersByTime(180_000);

    expect(fnP1).not.toHaveBeenCalled();
    expect(fnP2).not.toHaveBeenCalled();
    expect(fnQ).toHaveBeenCalledTimes(3);
  });

  it('disposeAllSchedules() clears every plugin\'s timers', () => {
    const fnP = vi.fn();
    const fnQ = vi.fn();
    schedulePluginTask('p', 60_000, fnP);
    schedulePluginTask('q', 60_000, fnQ);

    disposeAllSchedules();
    vi.advanceTimersByTime(180_000);

    expect(fnP).not.toHaveBeenCalled();
    expect(fnQ).not.toHaveBeenCalled();
  });
});
