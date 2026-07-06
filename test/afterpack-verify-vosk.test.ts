import { describe, it, expect } from 'vitest';
import { sufficientVoskModel, VOSK_MODEL_MIN_BYTES } from '../scripts/afterpack-verify.cjs';

describe('sufficientVoskModel size-floor', () => {
  it('rejects an empty/truncated model', () => {
    expect(sufficientVoskModel(0)).toBe(false);
    expect(sufficientVoskModel(VOSK_MODEL_MIN_BYTES - 1)).toBe(false);
  });
  it('accepts a full-size model (floor inclusive)', () => {
    expect(sufficientVoskModel(VOSK_MODEL_MIN_BYTES)).toBe(true);
    expect(sufficientVoskModel(40 * 1024 * 1024)).toBe(true);
  });
});
