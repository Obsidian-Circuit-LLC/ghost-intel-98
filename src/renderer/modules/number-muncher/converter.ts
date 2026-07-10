/**
 * Unit converter engine — pure factor-table conversion, no DOM/state.
 *
 * Each category maps a unit name to a multiplicative factor that expresses
 * that unit in terms of the category's base unit (e.g. length's base is
 * meters, data's base is bytes). Converting from unit A to unit B is
 * `value * factor[A] / factor[B]` — no `Date.now()` / `Math.random()`.
 */

export type Category = 'length' | 'mass' | 'data' | 'time' | 'speed';

export const CATEGORIES: Record<Category, Record<string, number>> = {
  length: {
    mm: 0.001,
    cm: 0.01,
    m: 1,
    km: 1000,
    in: 0.0254,
    ft: 0.3048,
    yd: 0.9144,
    mi: 1609.344,
  },
  mass: {
    mg: 0.001,
    g: 1,
    kg: 1000,
    oz: 28.349523125,
    lb: 453.59237,
    ton: 1_000_000,
  },
  data: {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  },
  time: {
    ms: 0.001,
    s: 1,
    min: 60,
    hr: 3600,
    day: 86400,
  },
  speed: {
    'm/s': 1,
    'km/h': 1 / 3.6,
    mph: 0.44704,
    knot: 0.5144444444444445,
  },
};

/** Convert `value` from unit `from` to unit `to` within category `cat`. */
export function convert(value: number, from: string, to: string, cat: Category): number {
  const table = CATEGORIES[cat];
  const fFrom = table[from];
  const fTo = table[to];
  if (fFrom === undefined || fTo === undefined) return NaN;
  return (value * fFrom) / fTo;
}
