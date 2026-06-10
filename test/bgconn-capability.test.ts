import { describe, it, expect } from 'vitest';
import { CAPABILITIES } from '../src/shared/plugin-types';
import { setBgConnManager, getBgConnManager, _resetBgConnSingletonForTest } from '../src/main/bgconn/singleton';
import { BackgroundConnectionManager } from '../src/main/bgconn/manager';

describe('persistent-background-connection capability', () => {
  it('is a known capability', () => {
    expect([...CAPABILITIES]).toContain('persistent-background-connection');
  });
  it('singleton holds + returns the manager', () => {
    _resetBgConnSingletonForTest();
    expect(getBgConnManager()).toBeNull();
    const m = new BackgroundConnectionManager({ isTorBootstrapped: () => false, now: () => 0, isVaultUnlocked: () => true,
      socksHost: '127.0.0.1', socksPort: 9250, idleTeardownAfterMs: null, maxReconnects: 20, maxSessionAgeMs: 720 * 60000 });
    setBgConnManager(m);
    expect(getBgConnManager()).toBe(m);
  });
});
