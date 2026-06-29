import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

/**
 * Regression: a persisted settings.json written by a pre-v3.23.0 build contains a
 * `searchlight` block with no `scorer` field (the scorer config did not exist yet).
 * mergeSettings must deep-merge `searchlight` so the new `scorer` sub-object is
 * restored from defaults — otherwise `searchlight.scorer` is `undefined` for every
 * upgrading user and the sweep IPC handler (which reads `scorer.foundThreshold`)
 * throws, silently breaking the username sweep and the Learning tab.
 */
describe('mergeSettings — searchlight.scorer survives an old on-disk searchlight block', () => {
  it('restores scorer defaults when the persisted searchlight block predates scorer', () => {
    // Simulate a pre-scorer settings.json: searchlight present but no `scorer` key.
    const onDisk = {
      searchlight: { networkEnabled: true, torConcurrency: 8, clearnetConcurrency: 16 },
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    // scorer must NOT be undefined — it must fall back to the default scorer block.
    expect(merged.searchlight.scorer).toBeDefined();
    expect(merged.searchlight.scorer).toEqual(defaultSettings.searchlight.scorer);
    // The user's persisted toggle is preserved.
    expect(merged.searchlight.networkEnabled).toBe(true);
  });

  it('deep-merges a partial scorer block, keeping untouched scorer defaults', () => {
    const onDisk = {
      searchlight: { networkEnabled: true, torConcurrency: 8, clearnetConcurrency: 16, scorer: { useMl: true } },
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    expect(merged.searchlight.scorer.useMl).toBe(true);                 // user override kept
    expect(merged.searchlight.scorer.foundThreshold).toBeNull();        // default preserved
    expect(merged.searchlight.scorer.maybeFloor).toBeNull();            // default preserved
    expect(merged.searchlight.scorer.lightweightMode).toBe(false);      // default preserved
  });
});

/**
 * Same bug class beyond searchlight: any fixed-shape nested settings object must be
 * deep-merged so a sub-field added to defaults in a later build survives an older
 * persisted block that predates it. (plugins is a dynamic Record and is excluded —
 * wholesale replace is its correct semantics.)
 */
describe('mergeSettings — fixed-shape nested settings objects survive a stale persisted block', () => {
  it('keeps a default sub-field that an old persisted block is missing, for chat/offensive/x', () => {
    // Each on-disk block carries only its oldest field; newer default sub-fields are absent.
    const onDisk = {
      chat: {} as unknown,
      offensive: { confirmMode: 'per-session' } as unknown,
      x: { networkEnabled: true } as unknown,
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    // chat: the only default field is restored.
    expect(merged.chat.networkEnabled).toBe(defaultSettings.chat.networkEnabled);
    // offensive: user override kept, missing default sub-fields restored.
    expect(merged.offensive.confirmMode).toBe('per-session');
    expect(merged.offensive.rateLimitPerSec).toBe(defaultSettings.offensive.rateLimitPerSec);
    expect(merged.offensive.requireSignedAuthorization).toBe(defaultSettings.offensive.requireSignedAuthorization);
    // x: user override kept, missing default sub-field restored.
    expect(merged.x.networkEnabled).toBe(true);
    expect(merged.x.clearnetAcknowledged).toBe(defaultSettings.x.clearnetAcknowledged);
  });
});
