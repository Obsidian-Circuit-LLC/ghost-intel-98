/**
 * GhostScrape (Task 7) — pure results-table view: row shaping + sort.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native
 * Electron primitives.
 *
 * No DOM, no React, no Electron — importable in the vitest node environment.
 * toRows/sortRows never mutate the input array; scraped text stays plain
 * data here (the module renders it as React text children — XSS-safe).
 */

import type { GhostScrapeResult, ScrapedTweet } from '@shared/ipc-contracts';

/** One results-table row — the same shape as a scraped tweet. */
export type ScrapeRow = ScrapedTweet;

export type SortKey = 'createdAt' | 'text' | 'likeCount' | 'retweetCount' | 'replyCount' | 'isRetweet';
export type SortDir = 'asc' | 'desc';

/** Flatten a GhostScrapeResult's tweets into table rows (profile is rendered separately). */
export function toRows(r: GhostScrapeResult): ScrapeRow[] {
  return r.tweets.map((t) => ({ ...t }));
}

function compareValues(a: ScrapeRow, b: ScrapeRow, key: SortKey): number {
  const av = a[key];
  const bv = b[key];
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  if (typeof av === 'boolean' && typeof bv === 'boolean') return Number(av) - Number(bv);
  return String(av).localeCompare(String(bv));
}

/**
 * Sort rows by key/direction, deterministically.
 *
 * Ties are broken by `id` ascending so repeated calls (and different JS
 * engines' sort stability guarantees) never reorder equal-key rows.
 */
export function sortRows(rows: ScrapeRow[], key: SortKey, dir: SortDir): ScrapeRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = compareValues(a, b, key);
    if (cmp !== 0) return cmp * mul;
    return a.id.localeCompare(b.id);
  });
}
