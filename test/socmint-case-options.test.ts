import { describe, it, expect } from 'vitest';
import { buildCaseOptions } from '../src/renderer/modules/socmint/case-options';

describe('buildCaseOptions', () => {
  it('shapes id→value and title(+reference)→label', () => {
    const out = buildCaseOptions([{ id: 'c1', title: 'Charles Davis', reference: 'Upwork 0001', category: 'Upwork' }]);
    expect(out).toEqual([{ value: 'c1', label: 'Charles Davis — Upwork 0001', category: 'Upwork' }]);
  });
  it('omits the reference suffix when empty', () => {
    const out = buildCaseOptions([{ id: 'c1', title: 'No Ref', reference: '', category: 'Agency' }]);
    expect(out[0].label).toBe('No Ref');
  });
  it('buckets missing category as Uncategorized', () => {
    const out = buildCaseOptions([{ id: 'c1', title: 'X', reference: '', category: undefined }]);
    expect(out[0].category).toBe('Uncategorized');
  });
  it('sorts by category, then title, then id — deterministically', () => {
    const out = buildCaseOptions([
      { id: 'b', title: 'Zulu', reference: '', category: 'Agency' },
      { id: 'a', title: 'Alpha', reference: '', category: 'Agency' },
      { id: 'c', title: 'Mike', reference: '', category: 'Bravo' },
    ]);
    expect(out.map((o) => o.value)).toEqual(['a', 'b', 'c']);
  });
});
