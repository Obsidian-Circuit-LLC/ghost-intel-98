/**
 * Phase-2 review fix: `normalizeXSourceKey` is the ONE canonicalization both the renderer's
 * `sourceGroups` card grouping and the main-side `removeSource` matcher call, so a source card and
 * its cascade-delete agree. Regression: the renderer keyed cards by the raw handle (case-sensitive)
 * while removeSource matched case-insensitively, so `@DaveX` and `davex` drew two cards but removing
 * either deleted both cards' posts — silent evidence loss. This pins the shared contract.
 */
import { describe, it, expect } from 'vitest';
import { normalizeXSourceKey, displayXHandle } from '../src/shared/x-listening-source';

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

/**
 * FIELD BUG (GhostExodus, v3.72.2): the COMMON FOLLOWERS / FOLLOWING pair line rendered
 * "@@ADanielHill ↔ @@TodayDarkweb" — the renderer prefixed '@' onto a value that already carried
 * one. Handles reach the UI from several places (capture, analysis, store), some with '@' and some
 * without, so display formatting must be idempotent rather than assuming a convention.
 */
describe('displayXHandle', () => {
  it('adds exactly one @ to a bare handle', () => {
    expect(displayXHandle('ADanielHill')).toBe('@ADanielHill');
  });

  it('does not double the @ on a handle that already carries one', () => {
    expect(displayXHandle('@ADanielHill')).toBe('@ADanielHill');
  });

  it('collapses an already-doubled prefix', () => {
    expect(displayXHandle('@@ADanielHill')).toBe('@ADanielHill');
  });

  it('preserves the handle case (display is not a lookup key)', () => {
    expect(displayXHandle('@TodayDarkweb')).toBe('@TodayDarkweb');
  });

  it('returns empty for an absent handle rather than a bare @', () => {
    expect(displayXHandle('')).toBe('');
    expect(displayXHandle(undefined)).toBe('');
    expect(displayXHandle('   ')).toBe('');
  });
});
