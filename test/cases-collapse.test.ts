import { describe, it, expect } from 'vitest';
import { resolveCollapsed, toggleCollapsed } from '../src/renderer/modules/cases/collapse';

describe('resolveCollapsed', () => {
  it('defaults an unknown category to collapsed', () => {
    expect(resolveCollapsed({}, 'Investigations')).toBe(true);
  });
  it('honors an explicit expanded (false) entry', () => {
    expect(resolveCollapsed({ Investigations: false }, 'Investigations')).toBe(false);
  });
  it('honors an explicit collapsed (true) entry', () => {
    expect(resolveCollapsed({ Investigations: true }, 'Investigations')).toBe(true);
  });
});

describe('toggleCollapsed', () => {
  it('flips an unknown (collapsed) category to expanded explicitly', () => {
    expect(toggleCollapsed({}, 'Field Ops')).toEqual({ 'Field Ops': false });
  });
  it('flips an expanded category back to collapsed', () => {
    expect(toggleCollapsed({ 'Field Ops': false }, 'Field Ops')).toEqual({ 'Field Ops': true });
  });
  it('does not mutate the input map', () => {
    const input = { A: false };
    toggleCollapsed(input, 'A');
    expect(input).toEqual({ A: false });
  });
});
