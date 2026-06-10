import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';

describe('offensive settings defaults', () => {
  it('exist and are fail-safe', () => {
    expect(defaultSettings.offensive.confirmMode).toBe('per-scan');
    expect(defaultSettings.offensive.requireSignedAuthorization).toBe(false);
    expect(defaultSettings.offensive.downstreamProxy ?? null).toBe(null);
    expect(Array.isArray(defaultSettings.offensive.issuerKeys ?? [])).toBe(true);
  });
});
