import { describe, it, expect } from 'vitest';
import type { BookmarkCategory } from '@shared/post-mvp-types';
import { toColumns, assignColumns, needsMigration, newColumn, placeCategory, effectiveColumn } from '../src/renderer/modules/bookmarks/layout';

function cat(id: string, links = 0, column?: number): BookmarkCategory {
  return { id, title: id, links: Array.from({ length: links }, (_, i) => ({ id: `${id}-l${i}`, name: 'x', url: 'https://x' })), ...(column != null ? { column } : {}) };
}

describe('bookmarks layout — column placement', () => {
  it('toColumns groups placed categories by their column, preserving array order (vertical order)', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 1), cat('C', 0, 0), cat('D', 0, 1)];
    const cols = toColumns(cats, 2);
    expect(cols[0].map((c) => c.id)).toEqual(['A', 'C']); // col 0, in array order
    expect(cols[1].map((c) => c.id)).toEqual(['B', 'D']); // col 1
  });

  it('effectiveColumn clamps a placed card into the last visible column on a narrow window', () => {
    expect(effectiveColumn(cat('X', 0, 3), 2)).toBe(1); // stored col 3, only 2 columns → last
    expect(effectiveColumn(cat('X', 0, 3), 5)).toBe(3); // wide again → springs back to 3
    expect(effectiveColumn(cat('X', 0), 4)).toBeNull(); // unplaced
  });

  it('a card placed in a far column folds into the last column when narrowed, springs back when widened', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 3)];
    expect(toColumns(cats, 2)[1].map((c) => c.id)).toEqual(['B']); // B (col3) folds into col1 (last of 2)
    const wide = toColumns(cats, 4);
    expect(wide[3].map((c) => c.id)).toEqual(['B']); // springs back to col 3
    expect(wide[0].map((c) => c.id)).toEqual(['A']);
  });

  it('unplaced (legacy) categories fall into the shortest column so a pre-migration board still renders', () => {
    const cats = [cat('big', 10), cat('a', 0), cat('b', 0)]; // no columns set
    const cols = toColumns(cats, 2);
    // "big" (tall) goes to col 0; the two short ones balance, not all pile on col 0.
    expect(cols.flat().map((c) => c.id).sort()).toEqual(['a', 'b', 'big']);
    expect(cols[0].length + cols[1].length).toBe(3);
    expect(cols[1].length).toBeGreaterThan(0); // did NOT stack everything in one column
  });

  it('needsMigration detects a legacy board and assignColumns places every category', () => {
    const legacy = [cat('A', 5), cat('B', 0), cat('C', 0)];
    expect(needsMigration(legacy)).toBe(true);
    const placed = assignColumns(legacy, 2);
    expect(needsMigration(placed)).toBe(false);
    expect(placed.every((c) => typeof c.column === 'number')).toBe(true);
  });

  it('newColumn picks the column with the fewest categories', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 0), cat('C', 0, 1)]; // col0 has 2, col1 has 1
    expect(newColumn(cats, 2)).toBe(1); // fewest → col 1
    expect(newColumn(cats, 3)).toBe(2); // empty col 2 is fewest
  });

  it('placeCategory drops a card ABOVE the target (before it in its column)', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 0), cat('C', 0, 1)];
    // drag C above B → C joins column 0, immediately above B
    const next = placeCategory(cats, 'C', 0, 'B');
    const col0 = toColumns(next, 2)[0].map((c) => c.id);
    expect(col0).toEqual(['A', 'C', 'B']);
  });

  it('placeCategory with beforeId=null appends to the BOTTOM of the target column', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 0), cat('C', 0, 1)];
    const next = placeCategory(cats, 'C', 0, null); // C → bottom of column 0
    expect(toColumns(next, 2)[0].map((c) => c.id)).toEqual(['A', 'B', 'C']);
    expect(toColumns(next, 2)[1].map((c) => c.id)).toEqual([]);
  });

  it('placeCategory is a no-op when dropping a card on itself', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 0)];
    expect(placeCategory(cats, 'A', 0, 'A')).toBe(cats);
  });

  it('assignColumns re-spreads a board stuck in one column (Auto-arrange recovery)', () => {
    // The v3.59.0 bug migrated at colCount=1, piling everything into column 0. Auto-arrange re-runs
    // assignColumns at the real column count to spread them back out.
    const stuck = [cat('A', 3, 0), cat('B', 0, 0), cat('C', 0, 0), cat('D', 0, 0)];
    const spread = assignColumns(stuck, 3);
    const cols = toColumns(spread, 3);
    expect(cols.every((c) => c.length > 0)).toBe(true); // no longer all in one column
    expect(cols.flat().length).toBe(4);
  });

  it('moving a card between columns does not disturb the order of other columns', () => {
    const cats = [cat('A', 0, 0), cat('B', 0, 1), cat('C', 0, 0), cat('D', 0, 1)];
    const next = placeCategory(cats, 'A', 1, 'D'); // A moves to col1, above D
    expect(toColumns(next, 2)[1].map((c) => c.id)).toEqual(['B', 'A', 'D']);
    expect(toColumns(next, 2)[0].map((c) => c.id)).toEqual(['C']); // col0 order intact
  });
});
