import { it, expect } from 'vitest';
import { prf, thresholdForRecall, stratifiedFolds, gateVerdict } from '../src/shared/searchlight/ml/metrics';
it('prf hand-checked', () => { const m = prf([1,1,0,0],[1,0,1,0]); expect(m.precision).toBeCloseTo(0.5); expect(m.recall).toBeCloseTo(0.5); expect(m.f1).toBeCloseTo(0.5); });
it('thresholdForRecall picks smallest threshold meeting recall', () => { expect(thresholdForRecall([0.9,0.6,0.4,0.1],[1,1,0,0],1.0)).toBeLessThanOrEqual(0.6); });
it('stratifiedFolds balances each class deterministically', () => { const f = stratifiedFolds([1,1,1,0,0,0],3); expect(f).toEqual([0,1,2,0,1,2]); });
it('gate passes on margin, fails on small soft subset', () => {
  expect(gateVerdict({precH:0.5,f1H:0.5,precM:0.56,f1M:0.49,softN:100}).pass).toBe(true);
  expect(gateVerdict({precH:0.5,f1H:0.5,precM:0.7,f1M:0.7,softN:50}).pass).toBe(false);
});
