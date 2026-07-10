import { describe, it, expect } from 'vitest';
import { toRadians, sci } from '../src/renderer/modules/number-muncher/scientific';
describe('scientific', () => {
  it('toRadians honors deg/rad/grad', () => {
    expect(toRadians(180, 'deg')).toBeCloseTo(Math.PI, 10);
    expect(toRadians(Math.PI, 'rad')).toBeCloseTo(Math.PI, 10);
    expect(toRadians(200, 'grad')).toBeCloseTo(Math.PI, 10);
  });
  it('sin(30deg)=0.5, cos(0)=1, ln(e)=1, 5!=120, 2^10=1024', () => {
    expect(sci('sin', 30, 'deg')).toBeCloseTo(0.5, 10);
    expect(sci('cos', 0, 'deg')).toBeCloseTo(1, 10);
    expect(sci('ln', Math.E, 'rad')).toBeCloseTo(1, 10);
    expect(sci('fact', 5, 'deg')).toBe(120);
    expect(sci('pow', 2, 'deg', 10)).toBe(1024);
  });
  it('factorial rejects negatives/non-integers → NaN', () => { expect(Number.isNaN(sci('fact', -1, 'deg'))).toBe(true); });
});
