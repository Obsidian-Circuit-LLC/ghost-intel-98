import { describe, it, expect } from 'vitest';
import { resolveSweepSelection } from '../src/renderer/modules/searchlight/sweep-selection';

const j = (id: string) => ({ id });

describe('resolveSweepSelection', () => {
  it('keeps a selection that belongs to the current case', () => {
    expect(resolveSweepSelection([j('a'), j('b')], 'a')).toBe('a');
  });

  it('falls back to the most recent sweep when nothing is selected', () => {
    expect(resolveSweepSelection([j('a'), j('b')], null)).toBe('b');
  });

  it('drops a stale cross-case selection and restores this case last sweep', () => {
    // selectedJobId 'x' belongs to a different case; current case has a, b
    expect(resolveSweepSelection([j('a'), j('b')], 'x')).toBe('b');
  });

  it('returns null for a stale selection when the current case has no sweeps', () => {
    expect(resolveSweepSelection([], 'x')).toBeNull();
  });

  it('returns null for an empty case with no selection', () => {
    expect(resolveSweepSelection([], null)).toBeNull();
  });
});
