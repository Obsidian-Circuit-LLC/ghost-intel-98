import { describe, it, expect } from 'vitest';
import { harvestedItemId } from '@main/socmint/utils';
import { defaultSettings } from '@shared/types';

describe('harvestedItemId', () => {
  it('is stable across calls for the same inputs', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    const b = harvestedItemId('telegram', '-100', '42');
    expect(a).toBe(b);
  });

  it('is a 64-character hex string (SHA-256)', () => {
    const id = harvestedItemId('telegram', '-100', '42');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different channelId', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    const b = harvestedItemId('telegram', '-999', '42');
    expect(a).not.toBe(b);
  });

  it('differs for different messageId', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    const b = harvestedItemId('telegram', '-100', '99');
    expect(a).not.toBe(b);
  });

  it('differs for different platform', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    // 'signal' is not in SocmintPlatform; cast to prove the hash changes when the prefix changes
    const b = harvestedItemId('signal' as any, '-100', '42');
    expect(a).not.toBe(b);
  });
});

describe('defaultSettings.socmint', () => {
  it('has socmint.networkEnabled === false by default', () => {
    expect(defaultSettings.socmint.networkEnabled).toBe(false);
  });
});
