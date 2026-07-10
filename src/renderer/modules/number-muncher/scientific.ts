/**
 * Scientific calculator engine — pure functions, no DOM/state.
 *
 * Trig functions accept an angle unit (deg/rad/grad) and internally convert to
 * radians via `toRadians`. Inverse trig functions return their result in the
 * same angle unit that was passed in, so a round trip (sin then asin) is
 * consistent for the caller's chosen unit. No `Date.now()` / `Math.random()`.
 */

export type Angle = 'deg' | 'rad' | 'grad';

export function toRadians(x: number, unit: Angle): number {
  if (unit === 'rad') return x;
  if (unit === 'grad') return (x * Math.PI) / 200;
  return (x * Math.PI) / 180;
}

/** Convert a radian value back into the given angle unit. */
function fromRadians(x: number, unit: Angle): number {
  if (unit === 'rad') return x;
  if (unit === 'grad') return (x * 200) / Math.PI;
  return (x * 180) / Math.PI;
}

export type SciFn =
  | 'sin' | 'cos' | 'tan'
  | 'asin' | 'acos' | 'atan'
  | 'log' | 'ln' | 'exp' | 'tenx'
  | 'pow' | 'fact' | 'sqrt' | 'inv';

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Evaluate a scientific function. `unit` governs trig/inverse-trig angle
 * interpretation; `y` is the second operand for binary functions (`pow`).
 */
export function sci(fn: SciFn, x: number, unit: Angle, y?: number): number {
  switch (fn) {
    case 'sin': return Math.sin(toRadians(x, unit));
    case 'cos': return Math.cos(toRadians(x, unit));
    case 'tan': return Math.tan(toRadians(x, unit));
    case 'asin': return fromRadians(Math.asin(x), unit);
    case 'acos': return fromRadians(Math.acos(x), unit);
    case 'atan': return fromRadians(Math.atan(x), unit);
    case 'log': return Math.log10(x);
    case 'ln': return Math.log(x);
    case 'exp': return Math.exp(x);
    case 'tenx': return Math.pow(10, x);
    case 'pow': return Math.pow(x, y ?? 0);
    case 'fact': return factorial(x);
    case 'sqrt': return Math.sqrt(x);
    case 'inv': return 1 / x;
    default: return NaN;
  }
}
