import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

describe('themeName settings upgrade', () => {
  it('yields classic for an old blob lacking themeName', () => {
    // Simulate a settings.json persisted before themeName existed.
    const oldBlob = { ...defaultSettings } as Record<string, unknown>;
    delete oldBlob.themeName;
    const merged = mergeSettings(defaultSettings, oldBlob as any);
    expect(merged.themeName).toBe('classic');
  });
  it('carries an explicit themeName through the merge', () => {
    expect(mergeSettings(defaultSettings, { themeName: 'amethyst' } as any).themeName).toBe('amethyst');
  });
});
