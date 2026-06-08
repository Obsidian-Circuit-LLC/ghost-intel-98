/**
 * Pinball physics — pure, UI-free, testable. 2D top-down model of a raked table: gravity pulls
 * straight down-screen. Collision response is closest-point ball-vs-segment and ball-vs-circle with
 * restitution and an optional surface/kick velocity (flipper tip speed, slingshot/bumper kick).
 * All functions are pure: they take pos/vel and return new pos/vel (or null for "no contact"), so the
 * chaotic part of the game is unit-testable without a canvas.
 */

export interface V { x: number; y: number }
export interface Seg { a: V; b: V }

export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
export const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y;
export const len = (a: V): number => Math.hypot(a.x, a.y);
export const norm = (a: V): V => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const clampLen = (v: V, max: number): V => { const l = len(v); return l > max ? mul(v, max / l) : v; };

/** Closest point on segment ab to point p. */
export function closest(p: V, a: V, b: V): V {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return add(a, mul(ab, t));
}

export interface Hit { pos: V; vel: V }

/**
 * Reflect a ball of radius r off a (zero-width) wall segment. `surfaceV` is the wall's own velocity
 * at the contact (flipper tip speed; zero for static walls). Returns the corrected pos+vel, or null
 * if the ball isn't touching the segment.
 */
export function collideSegment(pos: V, vel: V, seg: Seg, r: number, restitution: number, surfaceV: V = { x: 0, y: 0 }): Hit | null {
  const c = closest(pos, seg.a, seg.b);
  const d = sub(pos, c);
  const dist = len(d);
  if (dist >= r || dist <= 1e-4) return null;
  const n = norm(d);
  const outPos = add(pos, mul(n, r - dist)); // push out of the wall
  const rel = sub(vel, surfaceV);
  const vn = dot(rel, n);
  if (vn >= 0) return { pos: outPos, vel }; // separating already
  const reflected = sub(rel, mul(n, (1 + restitution) * vn));
  return { pos: outPos, vel: add(reflected, surfaceV) };
}

/**
 * Reflect a ball of radius r off a circle (bumper) of radius cr centered at `center`, adding an
 * outward `kick` impulse on contact (what gives pop bumpers / slingshots their energy). Returns
 * corrected pos+vel, or null if not touching.
 */
export function collideCircle(pos: V, vel: V, center: V, cr: number, r: number, restitution: number, kick: number): Hit | null {
  const d = sub(pos, center);
  const dist = len(d);
  if (dist >= r + cr || dist <= 1e-4) return null;
  const n = norm(d);
  const outPos = add(center, mul(n, r + cr));
  const vn = dot(vel, n);
  let v = vel;
  if (vn < 0) v = sub(vel, mul(n, (1 + restitution) * vn)); // reflect
  v = add(v, mul(n, kick)); // outward kick
  return { pos: outPos, vel: v };
}

/** Plunger launch velocity for a charge in [0,1]: monotonic up-the-lane speed with slight randomness. */
export function plungerLaunch(power: number, jitter = 0): V {
  const p = Math.max(0, Math.min(1, power));
  const speed = 7 + p * 8; // 7..15
  return { x: -0.4 - jitter, y: -speed };
}

/** A ball has drained once it falls below the playfield bottom. */
export const isDrained = (pos: V, bottom: number): boolean => pos.y > bottom;
