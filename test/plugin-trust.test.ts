import { describe, it, expect } from 'vitest';
import { isApiCompatible, PLUGIN_API_VERSION, MIN_SUPPORTED_API_VERSION, PINNED_KEYSETS } from '../src/main/plugins/trust';

describe('plugin trust', () => {
  it('current version is compatible; out-of-range and non-integers are not', () => {
    expect(isApiCompatible(PLUGIN_API_VERSION)).toBe(true);
    expect(isApiCompatible(MIN_SUPPORTED_API_VERSION)).toBe(true);
    expect(isApiCompatible(PLUGIN_API_VERSION + 1)).toBe(false);
    expect(isApiCompatible(0)).toBe(false);
    expect(isApiCompatible(1.5)).toBe(false);
  });

  it('PINNED_KEYSETS is an array (may be empty until the dev/release key is pinned)', () => {
    expect(Array.isArray(PINNED_KEYSETS)).toBe(true);
  });
});
