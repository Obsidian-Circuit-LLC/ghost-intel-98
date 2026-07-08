/** Pure EQ tables + helpers for the Jukebox 10-band graphic equalizer. No Web-Audio here — audio-graph.ts
 *  consumes these to build BiquadFilter peaking nodes. Kept pure so the band/preset math is unit-tested. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]; // Hz, ISO octave centres
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const EQ_FLAT_GAINS: number[] = new Array(EQ_BANDS.length).fill(0);

export function clampGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, db));
}

export const EQ_PRESETS: Record<string, number[]> = {
  Flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock:      [5, 4, 3, 1, -1, -1, 2, 3, 4, 5],
  Pop:       [-1, 1, 3, 4, 4, 2, 0, -1, -1, -2],
  Bass:      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  Vocal:     [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
};

export function presetGains(name: string): number[] {
  return (EQ_PRESETS[name] ?? EQ_PRESETS.Flat).map(clampGain);
}
