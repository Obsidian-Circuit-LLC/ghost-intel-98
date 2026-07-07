export const SEEK_STEP = 10;

/** Clamp a seek to [0, dur]. NaN/≤0 duration → return the unchanged current time (nothing to seek). */
export function clampSeek(cur: number, delta: number, dur: number): number {
  if (!Number.isFinite(dur) || dur <= 0) return cur;
  return Math.max(0, Math.min(dur, cur + delta));
}
