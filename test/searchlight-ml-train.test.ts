/**
 * Task 8 — Train orchestrator: pure core unit tests.
 *
 * Tests the pure `trainModel` function from train-core.ts.
 * The orchestrator script (train.ts) does I/O and is not tested here.
 */

import { describe, it, expect } from 'vitest';
import { trainModel } from '../src/shared/searchlight/ml/train-core';

describe('trainModel', () => {
  it('produces a valid self-describing model, deterministically', () => {
    const rows = [
      { features: [-2], label: 0 },
      { features: [-1], label: 0 },
      { features: [1],  label: 1 },
      { features: [2],  label: 1 },
    ];
    const m = trainModel(rows, ['x']);
    expect(m.feature_schema).toEqual(['x']);
    expect(m.coef.length).toBe(1);
    expect(typeof m.intercept).toBe('number');
    expect(m.thresholds.found).toBeGreaterThan(m.thresholds.not_found);
    expect(trainModel(rows, ['x'])).toEqual(m); // deterministic
  });

  it('respects an explicit targetRecall and produces different thresholds than the default', () => {
    const rows = [
      { features: [-2], label: 0 },
      { features: [-1], label: 0 },
      { features: [1],  label: 1 },
      { features: [2],  label: 1 },
    ];
    // At a higher targetRecall (0.99) the found threshold must be lower (more permissive)
    // so that more positives are caught.
    const mDefault = trainModel(rows, ['x'], 0.8);
    const mHighRecall = trainModel(rows, ['x'], 0.99);
    // Both must be valid self-describing models.
    expect(mDefault.thresholds.found).toBeGreaterThan(mDefault.thresholds.not_found);
    expect(mHighRecall.thresholds.found).toBeGreaterThan(mHighRecall.thresholds.not_found);
    // Higher recall target → lower or equal found threshold.
    expect(mHighRecall.thresholds.found).toBeLessThanOrEqual(mDefault.thresholds.found);
  });
});
