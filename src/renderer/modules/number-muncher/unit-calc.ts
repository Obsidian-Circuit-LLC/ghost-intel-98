/**
 * Unit Calc engine — pure conversion for area/volume/temperature, no DOM/state.
 *
 * Area and volume are ordinary factor-table conversions (value expressed in
 * terms of the category's base unit — m² for area, m³ for volume). Temperature
 * is NOT a bare multiplicative factor — Celsius/Fahrenheit/Kelvin are related
 * by affine (offset + scale) formulas, so it's handled by dedicated
 * to-Celsius / from-Celsius conversion functions instead of a factor table.
 */

export type UnitCategory = 'area' | 'volume' | 'temperature';

export const UNIT_CATEGORIES: Record<Exclude<UnitCategory, 'temperature'>, Record<string, number>> & {
  temperature: readonly string[];
} = {
  area: {
    m2: 1,
    km2: 1_000_000,
    ft2: 0.09290304,
    yd2: 0.83612736,
    acre: 4046.8564224,
    hectare: 10000,
  },
  volume: {
    L: 1,
    mL: 0.001,
    m3: 1000,
    gal: 3.785411784,
    qt: 0.946352946,
    ft3: 28.316846592,
  },
  temperature: ['C', 'F', 'K'],
};

/** Convert a temperature value (in `unit`) to Celsius. */
function toCelsius(v: number, unit: string): number {
  switch (unit) {
    case 'C':
      return v;
    case 'F':
      return ((v - 32) * 5) / 9;
    case 'K':
      return v - 273.15;
    default:
      return NaN;
  }
}

/** Convert a Celsius value to the given unit. */
function fromCelsius(c: number, unit: string): number {
  switch (unit) {
    case 'C':
      return c;
    case 'F':
      return (c * 9) / 5 + 32;
    case 'K':
      return c + 273.15;
    default:
      return NaN;
  }
}

/** Convert `value` from unit `from` to unit `to` within category `cat`. */
export function unitConvert(value: number, from: string, to: string, cat: UnitCategory): number {
  if (cat === 'temperature') {
    return fromCelsius(toCelsius(value, from), to);
  }
  const table = UNIT_CATEGORIES[cat];
  const fFrom = table[from];
  const fTo = table[to];
  if (fFrom === undefined || fTo === undefined) return NaN;
  return (value * fFrom) / fTo;
}
