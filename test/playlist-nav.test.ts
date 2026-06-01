import { describe, it, expect } from 'vitest';
import {
  nextIndex,
  prevIndex,
  endedIndex,
  pickRandom,
  cycleRepeat,
  type NavState
} from '../src/renderer/modules/media/playlist-nav';

const base = (over: Partial<NavState> = {}): NavState => ({
  current: 0,
  length: 5,
  repeat: 'off',
  shuffle: false,
  rng: () => 0,
  ...over
});

describe('playlist-nav', () => {
  it('sequential next advances by one', () => {
    expect(nextIndex(base({ current: 0 }))).toBe(1);
    expect(nextIndex(base({ current: 3 }))).toBe(4);
  });

  it('sequential next at the end stops when repeat is off', () => {
    expect(nextIndex(base({ current: 4 }))).toBeNull();
  });

  it('repeat:all wraps next back to 0', () => {
    expect(nextIndex(base({ current: 4, repeat: 'all' }))).toBe(0);
  });

  it('empty queue yields null for next and prev', () => {
    expect(nextIndex(base({ current: -1, length: 0 }))).toBeNull();
    expect(prevIndex(base({ current: -1, length: 0 }))).toBeNull();
  });

  it('prev steps back and stops at the start when repeat is off', () => {
    expect(prevIndex(base({ current: 3 }))).toBe(2);
    expect(prevIndex(base({ current: 0 }))).toBeNull();
  });

  it('prev at the start wraps to the end with repeat:all', () => {
    expect(prevIndex(base({ current: 0, repeat: 'all' }))).toBe(4);
  });

  it('endedIndex replays the current track on repeat:one', () => {
    expect(endedIndex(base({ current: 2, repeat: 'one' }))).toBe(2);
  });

  it('endedIndex otherwise advances like next', () => {
    expect(endedIndex(base({ current: 2 }))).toBe(3);
    expect(endedIndex(base({ current: 4, repeat: 'all' }))).toBe(0);
  });

  it('shuffle uses the injected rng and skips an immediate repeat', () => {
    // 0.4 * 5 -> floor 2, equals current(2) -> bumped to (2+1)%5 = 3
    expect(nextIndex(base({ current: 2, shuffle: true, rng: () => 0.4 }))).toBe(3);
    // 0 -> index 0, differs from current(2) -> kept
    expect(nextIndex(base({ current: 2, shuffle: true, rng: () => 0 }))).toBe(0);
  });

  it('pickRandom clamps a degenerate rng()===1 and handles a single item', () => {
    expect(pickRandom(5, -1, () => 1)).toBe(4);
    expect(pickRandom(1, 0, () => 0.5)).toBe(0);
  });

  it('cycleRepeat cycles off -> all -> one -> off', () => {
    expect(cycleRepeat('off')).toBe('all');
    expect(cycleRepeat('all')).toBe('one');
    expect(cycleRepeat('one')).toBe('off');
  });
});
