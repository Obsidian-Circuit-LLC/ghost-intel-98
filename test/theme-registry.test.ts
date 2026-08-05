import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, isKnownTheme, resolveTheme } from '../src/renderer/styles/themes';
describe('theme registry', () => {
  it('ships classic + amethyst with the locked label/slug', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['classic', 'amethyst']);
    expect(THEMES.find((t) => t.id === 'amethyst')!.label).toBe('QUIET AMETHYST');
  });
  it('resolveTheme falls back to classic for unknown/undefined', () => {
    expect(resolveTheme('amethyst')).toBe('amethyst');
    expect(resolveTheme('nope')).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(isKnownTheme('classic')).toBe(true);
    expect(isKnownTheme('x')).toBe(false);
  });
});
