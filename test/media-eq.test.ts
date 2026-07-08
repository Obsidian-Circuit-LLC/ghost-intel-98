import { describe, it, expect } from 'vitest';
import { EQ_BANDS, EQ_FLAT_GAINS, clampGain, EQ_PRESETS, presetGains } from '../src/renderer/modules/media/eq';

describe('eq tables', () => {
  it('has 10 ISO octave bands', () => {
    expect(EQ_BANDS).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  });
  it('flat gains are ten zeros', () => { expect(EQ_FLAT_GAINS).toEqual(new Array(10).fill(0)); });
  it('clampGain bounds to [-12, 12]', () => {
    expect(clampGain(-99)).toBe(-12); expect(clampGain(99)).toBe(12); expect(clampGain(3)).toBe(3);
  });
  it('every preset has one gain per band', () => {
    for (const g of Object.values(EQ_PRESETS)) expect(g).toHaveLength(EQ_BANDS.length);
  });
  it('presetGains falls back to Flat on an unknown name', () => {
    expect(presetGains('nope')).toEqual(EQ_FLAT_GAINS);
    expect(presetGains('Flat')).toEqual(EQ_FLAT_GAINS);
  });
});
