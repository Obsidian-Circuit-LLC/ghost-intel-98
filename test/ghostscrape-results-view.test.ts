/**
 * GhostScrape Task 7: renderer results-view tests (pure).
 *
 * toRows flattens a GhostScrapeResult's tweets into table rows; sortRows
 * sorts deterministically (ties broken by id) and never mutates its input.
 */

import { describe, it, expect } from 'vitest';
import { toRows, sortRows } from '../src/renderer/modules/ghostscrape/results-view';
import type { GhostScrapeResult, ScrapedTweet } from '@shared/ipc-contracts';

function tweet(overrides: Partial<ScrapedTweet>): ScrapedTweet {
  return {
    id: '1',
    text: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    isRetweet: false,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    url: 'https://x.com/u/status/1',
    ...overrides
  };
}

const RESULT: GhostScrapeResult = {
  tweets: [
    tweet({ id: 'b', text: 'bravo', createdAt: '2026-02-01T00:00:00.000Z', likeCount: 5 }),
    tweet({ id: 'a', text: 'alpha', createdAt: '2026-01-01T00:00:00.000Z', likeCount: 10 }),
    tweet({ id: 'c', text: 'charlie', createdAt: '2026-03-01T00:00:00.000Z', likeCount: 1, isRetweet: true })
  ],
  partial: false,
  captured: 3
};

describe('toRows', () => {
  it('flattens tweets into rows 1:1', () => {
    const rows = toRows(RESULT);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the source result', () => {
    const before = JSON.stringify(RESULT);
    toRows(RESULT);
    expect(JSON.stringify(RESULT)).toBe(before);
  });
});

describe('sortRows', () => {
  const rows = toRows(RESULT);

  it('sorts by createdAt ascending', () => {
    const sorted = sortRows(rows, 'createdAt', 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by createdAt descending', () => {
    const sorted = sortRows(rows, 'createdAt', 'desc');
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by likeCount numerically, not lexically', () => {
    const sorted = sortRows(rows, 'likeCount', 'desc');
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic and does not mutate the input array', () => {
    const before = rows.map((r) => r.id);
    const first = sortRows(rows, 'text', 'asc');
    const second = sortRows(rows, 'text', 'asc');
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('breaks ties on equal sort keys by id ascending', () => {
    const tied = [tweet({ id: 'z', likeCount: 5 }), tweet({ id: 'y', likeCount: 5 }), tweet({ id: 'x', likeCount: 5 })];
    const sorted = sortRows(tied, 'likeCount', 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['x', 'y', 'z']);
  });
});
