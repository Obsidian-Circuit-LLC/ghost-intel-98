import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

/**
 * Task 4: new opt-in clearnet host-resolution settings.
 *
 * geoint.cctvResolveClearnet (default false) and geoint.cctvResolveClearnetAck (default false)
 * must survive an on-disk geoint block that predates them — same bug class as
 * settings-merge-searchlight.test.ts (mergeSettings deep-merges geoint at json-fs.ts:935).
 */
describe('mergeSettings — geoint.cctvResolveClearnet / cctvResolveClearnetAck survive a stale persisted geoint block', () => {
  it('fills in the new clearnet-resolve fields as false when a partial geoint block omits them', () => {
    const onDisk = {
      geoint: { networkEnabled: true }
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    expect(merged.geoint.cctvResolveClearnet).toBe(false);
    expect(merged.geoint.cctvResolveClearnetAck).toBe(false);
    // user override kept
    expect(merged.geoint.networkEnabled).toBe(true);
  });

  it('reads the defaults directly (off by default) when no on-disk geoint block is present at all', () => {
    const merged = mergeSettings(defaultSettings, {} as unknown as Partial<typeof defaultSettings>);

    expect(merged.geoint.cctvResolveClearnet).toBe(false);
    expect(merged.geoint.cctvResolveClearnetAck).toBe(false);
  });
});
