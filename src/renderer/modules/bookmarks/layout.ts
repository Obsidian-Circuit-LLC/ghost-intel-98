/**
 * Bookmarks board layout — start.me-style column placement.
 *
 * Categories carry an explicit `column` index (0-based). Their vertical order within a column is
 * their order in the `categories` array, so a drag that reorders the array + sets the column fully
 * determines placement — no height algorithm second-guesses the user (GhostExodus's ask; the v3.57
 * height-masonry auto-placement is what these functions replace).
 *
 * Column COUNT is derived from the live board width by the module. Stored columns are ABSOLUTE, so a
 * category placed in column 3 folds into the last visible column when the window narrows to 2, and
 * springs back to 3 when it widens again (`effectiveColumn` clamps; the stored value is untouched).
 *
 * A legacy board whose categories have no `column` yet still renders sensibly: `toColumns` folds the
 * unplaced ones in via a shortest-column fallback, and the module migrates them to explicit columns
 * once (see `assignColumns`) so every future drag is user-controlled.
 */
import type { BookmarkCategory } from '@shared/post-mvp-types';

const EST_HEADER = 26; // title bar
const EST_LINK_ROW = 22; // one link row
const EST_FOOTER = 32; // "+ Add link" + padding
const EST_GAP = 8; // inter-card gap

/** Rough rendered height of a card, from its link count — good enough to balance columns. */
export function estHeight(c: BookmarkCategory): number {
  return EST_HEADER + c.links.length * EST_LINK_ROW + EST_FOOTER;
}

/** The visible column a placed category renders in, clamped to what's on screen. null = unplaced. */
export function effectiveColumn(c: BookmarkCategory, columnCount: number): number | null {
  if (c.column == null || !Number.isFinite(c.column)) return null;
  return Math.max(0, Math.min(Math.trunc(c.column), Math.max(1, columnCount) - 1));
}

/** Index of the shortest of `n` columns given running heights (ties → leftmost). */
function shortest(heights: number[]): number {
  let t = 0;
  for (let i = 1; i < heights.length; i++) if (heights[i] < heights[t]) t = i;
  return t;
}

/**
 * Group categories into `columnCount` visible columns, preserving array order within each column.
 * Placed categories go to their (clamped) stored column; unplaced ones fall into the shortest column
 * so a not-yet-migrated board still looks balanced.
 */
export function toColumns(categories: BookmarkCategory[], columnCount: number): BookmarkCategory[][] {
  const n = Math.max(1, columnCount);
  const cols: BookmarkCategory[][] = Array.from({ length: n }, () => []);
  const heights = new Array<number>(n).fill(0);
  for (const c of categories) {
    let col = effectiveColumn(c, n);
    if (col == null) col = shortest(heights);
    cols[col].push(c);
    heights[col] += estHeight(c) + EST_GAP;
  }
  return cols;
}

/**
 * Assign an explicit `column` to EVERY category via shortest-column masonry (one-time migration of a
 * legacy board, or a reset). Deterministic; returns a new array, input untouched.
 */
export function assignColumns(categories: BookmarkCategory[], columnCount: number): BookmarkCategory[] {
  const n = Math.max(1, columnCount);
  const heights = new Array<number>(n).fill(0);
  return categories.map((c) => {
    const target = shortest(heights);
    heights[target] += estHeight(c) + EST_GAP;
    return { ...c, column: target };
  });
}

/** True if any category still lacks an explicit column (⇒ the board needs migrating). */
export function needsMigration(categories: BookmarkCategory[]): boolean {
  return categories.some((c) => c.column == null || !Number.isFinite(c.column));
}

/** The column a NEW category should join: the one with the fewest categories (ties → leftmost). */
export function newColumn(categories: BookmarkCategory[], columnCount: number): number {
  const n = Math.max(1, columnCount);
  const counts = new Array<number>(n).fill(0);
  for (const c of categories) {
    const col = effectiveColumn(c, n);
    if (col != null) counts[col]++;
  }
  let target = 0;
  for (let i = 1; i < n; i++) if (counts[i] < counts[target]) target = i;
  return target;
}

/**
 * Move `draggedId` into `targetColumn`. If `beforeId` is a category id, the dragged card lands
 * immediately ABOVE it (array order = vertical order, so inserting before it renders it above);
 * if `beforeId` is null it appends to the BOTTOM of the column (pushed to the end of the array, so
 * it is last among that column's cards). Pure; returns a new array. No-op if dragged == before.
 */
export function placeCategory(
  categories: BookmarkCategory[],
  draggedId: string,
  targetColumn: number,
  beforeId: string | null
): BookmarkCategory[] {
  if (draggedId === beforeId) return categories;
  const dragged = categories.find((c) => c.id === draggedId);
  if (!dragged) return categories;
  const placed: BookmarkCategory = { ...dragged, column: Math.max(0, Math.trunc(targetColumn)) };
  const rest = categories.filter((c) => c.id !== draggedId);
  if (beforeId == null) {
    rest.push(placed);
  } else {
    const idx = rest.findIndex((c) => c.id === beforeId);
    rest.splice(idx < 0 ? rest.length : idx, 0, placed);
  }
  return rest;
}
