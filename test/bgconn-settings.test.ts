import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';

describe('bgconn settings defaults', () => {
  it('exist and are fail-safe', () => {
    expect(defaultSettings.bgconn.idleTeardownAfterMinutes).toBe(120); // 2h default
    expect(defaultSettings.bgconn.defaultRouting).toBe('tor');
    expect(defaultSettings.bgconn.maxReconnects).toBeGreaterThan(0);
  });
});
