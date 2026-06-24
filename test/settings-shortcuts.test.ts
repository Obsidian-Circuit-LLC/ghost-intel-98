import { describe, it, expect } from 'vitest';
import { defaultShortcuts, REQUIRED_MODULE_SHORTCUTS } from '@shared/types';

describe('default shortcuts', () => {
  it('includes a Searchlight module shortcut', () => {
    expect(defaultShortcuts.some((s) => s.target === 'searchlight')).toBe(true);
    expect(REQUIRED_MODULE_SHORTCUTS.some((s) => s.target === 'searchlight')).toBe(true);
  });
});
