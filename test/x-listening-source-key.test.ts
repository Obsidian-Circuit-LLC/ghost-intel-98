/**
 * Phase-2 review fix: `normalizeXSourceKey` is the ONE canonicalization both the renderer's
 * `sourceGroups` card grouping and the main-side `removeSource` matcher call, so a source card and
 * its cascade-delete agree. Regression: the renderer keyed cards by the raw handle (case-sensitive)
 * while removeSource matched case-insensitively, so `@DaveX` and `davex` drew two cards but removing
 * either deleted both cards' posts — silent evidence loss. This pins the shared contract.
 */
import { describe, it, expect } from 'vitest';
import { normalizeXSourceKey } from '../src/shared/x-listening-source';

describe('normalizeXSourceKey — shared source-card / removeSource canonicalization', () => {
  it('strips a leading @, trims, and lowercases', () => {
    expect(normalizeXSourceKey('@DaveX')).toBe('davex');
    expect(normalizeXSourceKey('  DaveX  ')).toBe('davex');
    expect(normalizeXSourceKey('@@davex')).toBe('davex');
  });

  it('collapses every casing/@-form of one handle to a single key (so grouping == delete)', () => {
    const forms = ['@DaveX', 'davex', 'DAVEX', ' @DaveX ', 'daveX'];
    const keys = new Set(forms.map(normalizeXSourceKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('davex');
  });

  it('keeps distinct handles distinct and tolerates empty/nullish input', () => {
    expect(normalizeXSourceKey('alice')).not.toBe(normalizeXSourceKey('bob'));
    expect(normalizeXSourceKey('')).toBe('');
    expect(normalizeXSourceKey(null)).toBe('');
    expect(normalizeXSourceKey(undefined)).toBe('');
  });
});
