import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
describe('memory default-on', () => {
  it('useMemory defaults to true so memory works out of the box', () => {
    expect(defaultSettings.ai.useMemory).toBe(true);
    expect(defaultSettings.ai.autoReindex).toBe(true); // live reindex on by default
  });
});
