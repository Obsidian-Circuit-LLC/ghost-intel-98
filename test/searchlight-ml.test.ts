import { describe, it, expect } from 'vitest';
import { predict, blend } from '../src/shared/searchlight/ml';
import type { MlModel } from '../src/shared/searchlight/types';

/** Minimal 2-feature model — deterministic, hand-computable. */
const M: MlModel = {
  version: 't',
  feature_schema: ['a', 'b'],
  mean: [0, 0],
  scale: [1, 1],
  coef: [1, 0],
  intercept: 0,
  ml_weight: 0.6,
  thresholds: { found: 0.5559, not_found: 0.3224 },
};

describe('predict', () => {
  it('predict = sigmoid(coef·z)', () => {
    // a=2: z=(2-0)/1=2, coef[0]*z=2; b=0: coef[1]*0=0; sum+intercept=2
    expect(predict({ a: 2, b: 0 }, M)).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
  });

  it('missing feature uses mean (neutral — standardizes to 0)', () => {
    // Feature 'a' is missing → x=mean[0]=3 → z=(3-3)/1=0, coef=1 → contribution 0
    // Feature 'b' present=5 → z=(5-0)/1=5, coef=0 → contribution 0
    // sum = 0 → sigmoid(0) = 0.5
    expect(predict({ b: 5 }, { ...M, mean: [3, 0] })).toBeCloseTo(0.5, 6);
  });

  it('scale 0 guarded (no divide-by-zero, returns a number)', () => {
    // scale[0]=0 for feature 'a' → guard replaces with 1
    expect(predict({ a: 1 }, { ...M, scale: [0, 1] })).toBeDefined();
    expect(typeof predict({ a: 1 }, { ...M, scale: [0, 1] })).toBe('number');
  });

  it('determinism: same input → identical output', () => {
    expect(predict({ a: 2 }, M)).toBe(predict({ a: 2 }, M));
  });

  it('output is strictly between 0 and 1 for non-saturating input', () => {
    // a=5: z=(5-0)/1=5, contribution=1*5=5; sigmoid(5) ≈ 0.9933
    const p = predict({ a: 5, b: 0 }, M);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('intercept shifts output', () => {
    // With coef=[0,0] and intercept=1, predict = sigmoid(1) regardless of input
    const m2 = { ...M, coef: [0, 0], intercept: 1 };
    expect(predict({}, m2)).toBeCloseTo(1 / (1 + Math.exp(-1)), 6);
  });
});

describe('blend', () => {
  it('blend respects ml_weight', () => {
    expect(blend(1, 0, 0.6)).toBeCloseTo(0.6, 6);
  });

  it('blend(0, 1, 0.6) = 0.4', () => {
    expect(blend(0, 1, 0.6)).toBeCloseTo(0.4, 6);
  });

  it('blend(0.8, 0.4, 0.5) = 0.6', () => {
    expect(blend(0.8, 0.4, 0.5)).toBeCloseTo(0.6, 6);
  });

  it('weight=0 → pure heuristic', () => {
    expect(blend(0.9, 0.3, 0)).toBeCloseTo(0.3, 6);
  });

  it('weight=1 → pure ML', () => {
    expect(blend(0.9, 0.3, 1)).toBeCloseTo(0.9, 6);
  });
});
