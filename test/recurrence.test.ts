import { describe, it, expect } from 'vitest';
import { nextOccurrence, occurrencesInLocalMonth } from '../src/shared/recurrence';

// A local anchor: Thu 2026-07-16 18:00.
const anchor = new Date(2026, 6, 16, 18, 0, 0, 0).getTime();

describe('nextOccurrence', () => {
  it('returns null for none', () => {
    expect(nextOccurrence(anchor, 'none', anchor)).toBeNull();
  });
  it('daily/weekly step to the first occurrence strictly after `after`', () => {
    expect(new Date(nextOccurrence(anchor, 'daily', anchor)!).getDate()).toBe(17);
    expect(new Date(nextOccurrence(anchor, 'weekly', anchor)!).getDate()).toBe(23);
  });
  it('monthly skips months without the anchor day', () => {
    const jan31 = new Date(2026, 0, 31, 9, 0, 0, 0).getTime();
    // next after Jan 31 is Mar 31 (Feb has no 31st)
    const n = new Date(nextOccurrence(jan31, 'monthly', jan31)!);
    expect(n.getMonth()).toBe(2); // March
    expect(n.getDate()).toBe(31);
  });
});

describe('occurrencesInLocalMonth', () => {
  it('weekly: every Thursday on/after the anchor in July 2026', () => {
    const days = occurrencesInLocalMonth(anchor, 'weekly', 2026, 6).map((ms) => new Date(ms).getDate());
    expect(days).toEqual([16, 23, 30]); // nothing before the 16th; Thursdays 16/23/30
  });
  it('daily: every day on/after the anchor', () => {
    const days = occurrencesInLocalMonth(anchor, 'daily', 2026, 6).map((ms) => new Date(ms).getDate());
    expect(days[0]).toBe(16);
    expect(days[days.length - 1]).toBe(31);
    expect(days.length).toBe(16);
  });
  it('monthly: the anchor day only, and nothing in a month before the anchor', () => {
    expect(occurrencesInLocalMonth(anchor, 'monthly', 2026, 7).map((ms) => new Date(ms).getDate())).toEqual([16]); // Aug 16
    expect(occurrencesInLocalMonth(anchor, 'monthly', 2026, 5)).toEqual([]); // June is before the anchor
  });
  it('none yields nothing', () => {
    expect(occurrencesInLocalMonth(anchor, 'none', 2026, 6)).toEqual([]);
  });
});
