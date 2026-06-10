import { describe, it, expect } from 'vitest';
import { registerTeardown, disablePlugin, _resetTeardownsForTest } from '../src/main/plugins/loader';

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
