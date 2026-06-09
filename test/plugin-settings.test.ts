import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';

describe('plugin settings defaults', () => {
  it('plugins block exists and defaults to empty', () => {
    expect(defaultSettings.plugins).toEqual({});
  });
});
