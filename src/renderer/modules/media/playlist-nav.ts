/**
 * Pure playlist-navigation logic for the Jukebox — kept free of React/DOM so it can be
 * unit-tested headlessly. The component owns playback + a shuffle "back" history stack;
 * this module only answers "given the queue state, which index plays next?".
 *
 * Shuffle uses an injectable RNG (defaults to Math.random) so tests are deterministic.
 * This is UI sequencing, not a correctness-critical path, so Math.random is appropriate
 * at runtime.
 */

export type RepeatMode = 'off' | 'all' | 'one';

export interface NavState {
  /** Index currently playing, or -1 if nothing has played yet. */
  current: number;
  /** Number of items in the queue. */
  length: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Injectable [0,1) source for shuffle; defaults to Math.random. */
  rng?: () => number;
}

/** Pick a random index in [0,length) that differs from `avoid` when possible. */
export function pickRandom(length: number, avoid: number, rng: () => number): number {
  if (length <= 1) return 0;
  const r = Math.floor(rng() * length);
  // Clamp (guards against rng() returning exactly 1) and skip an immediate repeat.
  const safe = r >= length ? length - 1 : r;
  return safe === avoid ? (safe + 1) % length : safe;
}

/** The index to play when the user presses Next, or null to stop. */
export function nextIndex(s: NavState): number | null {
  if (s.length <= 0) return null;
  if (s.shuffle) return pickRandom(s.length, s.current, s.rng ?? Math.random);
  const n = s.current + 1;
  if (n < s.length) return n;
  return s.repeat === 'all' ? 0 : null;
}

/** The index to play when the current track ends, or null to stop. */
export function endedIndex(s: NavState): number | null {
  if (s.repeat === 'one' && s.current >= 0 && s.current < s.length) return s.current;
  return nextIndex(s);
}

/**
 * The index to play when the user presses Previous (sequential fallback).
 * Shuffle "back" history is handled by the component; here, prev with repeat:all
 * wraps to the end.
 */
export function prevIndex(s: NavState): number | null {
  if (s.length <= 0) return null;
  const p = s.current - 1;
  if (p >= 0) return p;
  return s.repeat === 'all' ? s.length - 1 : null;
}

/** Cycle the repeat button: off → all → one → off. */
export function cycleRepeat(r: RepeatMode): RepeatMode {
  return r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
}
