import { describe, it, expect } from 'vitest';
import { _resetLoaderForTest, getHandlers } from '../src/main/plugins/loader';
import { invokePluginHandler } from '../src/main/plugins/invoke';

describe('invokePluginHandler', () => {
  it('dispatches to a registered handler by id+name', async () => {
    _resetLoaderForTest();
    getHandlers().set('osint:ping', (...a: unknown[]) => `pong:${String(a[0])}`);
    expect(await invokePluginHandler('osint', 'ping', ['hi'])).toBe('pong:hi');
  });
  it('throws for an unknown handler', async () => {
    _resetLoaderForTest();
    await expect(invokePluginHandler('osint', 'nope', [])).rejects.toThrow(/no handler/);
  });
});
