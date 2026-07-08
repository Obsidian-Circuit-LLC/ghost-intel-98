import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerTeardown, disablePlugin, _resetTeardownsForTest } from '../src/main/plugins/loader';
import { schedulePluginTask, _resetSchedulesForTest } from '../src/main/plugins/schedule';

describe('plugin teardown', () => {
  it('registers + invokes teardowns for a plugin, once', async () => {
    _resetTeardownsForTest();
    const calls: string[] = [];
    registerTeardown('osint', async () => { calls.push('a'); });
    registerTeardown('osint', async () => { calls.push('b'); });
    registerTeardown('other', async () => { calls.push('x'); });
    await disablePlugin('osint');
    expect(calls.sort()).toEqual(['a', 'b']); // not 'x'
    await disablePlugin('osint'); // teardowns cleared after first disable
    expect(calls.sort()).toEqual(['a', 'b']);
  });
});

describe('plugin teardown clears scheduled timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetTeardownsForTest();
    _resetSchedulesForTest();
  });
  afterEach(() => {
    _resetSchedulesForTest();
    vi.useRealTimers();
  });

  it('disablePlugin(id) clears that plugin\'s scheduled timers', async () => {
    const fn = vi.fn();
    schedulePluginTask('p', 60_000, fn);
    await disablePlugin('p');
    vi.advanceTimersByTime(180_000);
    expect(fn).not.toHaveBeenCalled();
  });
});
