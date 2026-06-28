import { describe, it, expect } from 'vitest';
import { fit, predictProba, standardize } from '../src/shared/searchlight/ml/logreg';

describe('logreg', () => {
  it('standardize: mean/scale, scale 0 guarded', () => {
    const { mean, scale } = standardize([[0,5],[2,5]]);
    expect(mean).toEqual([1,5]);
    expect(scale[1]).toBe(1);
  });

  it('learns a separable 1-D boundary', () => {
    const X = [[-2],[-1],[1],[2]], y = [0,0,1,1];
    const m = fit(X, y, { iters: 5000 });
    expect(predictProba(m, [-2])).toBeLessThan(0.5);
    expect(predictProba(m, [2])).toBeGreaterThan(0.5);
  });

  it('is deterministic: identical data → identical weights', () => {
    const X = [[-2],[-1],[1],[2]], y = [0,0,1,1];
    expect(fit(X,y)).toEqual(fit(X,y));
  });
});
