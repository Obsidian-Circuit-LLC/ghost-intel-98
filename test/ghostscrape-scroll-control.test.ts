/**
 * GhostScrape Task 3: scroll-continuation decision tests (pure).
 *
 * shouldContinueScroll stops when scrollsDone>=maxScrolls OR totalCaptured>=maxItems
 * OR emptyRoundsInARow>=2; otherwise continues.
 */

import { describe, it, expect } from 'vitest';
import { shouldContinueScroll, type ScrollState } from '../src/main/x/ghostscrape/scroll-control';

function state(overrides: Partial<ScrollState> = {}): ScrollState {
  return {
    scrollsDone: 0,
    newItemsLastRound: 0,
    totalCaptured: 0,
    maxScrolls: 10,
    maxItems: 100,
    emptyRoundsInARow: 0,
    ...overrides,
  };
}

describe('shouldContinueScroll', () => {
  it('continues mid-sweep', () => {
    expect(
      shouldContinueScroll(state({ scrollsDone: 3, totalCaptured: 20, emptyRoundsInARow: 0 }))
    ).toBe(true);
  });

  it('stops once scrollsDone reaches maxScrolls', () => {
    expect(shouldContinueScroll(state({ scrollsDone: 10, maxScrolls: 10 }))).toBe(false);
  });

  it('stops once scrollsDone exceeds maxScrolls', () => {
    expect(shouldContinueScroll(state({ scrollsDone: 11, maxScrolls: 10 }))).toBe(false);
  });

  it('stops once totalCaptured reaches maxItems', () => {
    expect(shouldContinueScroll(state({ totalCaptured: 100, maxItems: 100 }))).toBe(false);
  });

  it('stops after 2 empty rounds in a row', () => {
    expect(shouldContinueScroll(state({ emptyRoundsInARow: 2 }))).toBe(false);
  });

  it('does not stop after only 1 empty round', () => {
    expect(shouldContinueScroll(state({ emptyRoundsInARow: 1 }))).toBe(true);
  });

  it('stops after more than 2 empty rounds in a row', () => {
    expect(shouldContinueScroll(state({ emptyRoundsInARow: 3 }))).toBe(false);
  });
});
