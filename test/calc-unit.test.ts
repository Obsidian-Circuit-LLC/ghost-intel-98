import { describe, it, expect } from 'vitest';
import { unitConvert, UNIT_CATEGORIES } from '../src/renderer/modules/number-muncher/unit-calc';
describe('unit calc', () => {
  it('temperature uses offset formulas (0°C=32°F, 100°C=212°F, 0°C=273.15K)', () => {
    expect(unitConvert(0, 'C', 'F', 'temperature')).toBeCloseTo(32, 6);
    expect(unitConvert(100, 'C', 'F', 'temperature')).toBeCloseTo(212, 6);
    expect(unitConvert(0, 'C', 'K', 'temperature')).toBeCloseTo(273.15, 6);
  });
  it('area/volume via factors (1 m² = 10.7639 ft²)', () => { expect(unitConvert(1, 'm2', 'ft2', 'area')).toBeCloseTo(10.7639, 3); });
});
