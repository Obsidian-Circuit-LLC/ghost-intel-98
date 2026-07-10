/**
 * Programmer-mode engine — pure BigInt arithmetic, no DOM/state.
 *
 * All values are clamped to a 64-bit unsigned range (mirrors the Windows
 * calculator's Programmer mode). Base conversion is BigInt-exact — no
 * precision loss from routing through `Number`. No `Date.now()` /
 * `Math.random()`.
 */

export type Base = 'HEX' | 'DEC' | 'OCT' | 'BIN';

export type BitOpKind = 'AND' | 'OR' | 'XOR' | 'NOT' | 'SHL' | 'SHR' | 'MOD';

const RADIX: Record<Base, number> = { HEX: 16, DEC: 10, OCT: 8, BIN: 2 };

/** 2^64 — the modulus for the 64-bit unsigned range this mode operates in. */
const MASK64 = (1n << 64n) - 1n;

/** Clamp a (possibly negative or oversized) BigInt into the unsigned 64-bit range. */
function clamp64(n: bigint): bigint {
  return n & MASK64;
}

/** Render a 64-bit-clamped BigInt in the given base, uppercase for hex. */
export function toBase(n: bigint, base: Base): string {
  const v = clamp64(n);
  return v.toString(RADIX[base]).toUpperCase();
}

/** Parse a string in the given base into a 64-bit-clamped BigInt. */
export function fromBase(str: string, base: Base): bigint {
  const radix = RADIX[base];
  const clean = str.trim();
  if (clean === '') return 0n;
  let acc = 0n;
  const r = BigInt(radix);
  for (const ch of clean) {
    const digit = parseInt(ch, radix);
    if (Number.isNaN(digit)) continue;
    acc = acc * r + BigInt(digit);
  }
  return clamp64(acc);
}

/** Apply a bitwise/shift/mod operation, clamped to the 64-bit unsigned range. */
export function bitOp(op: BitOpKind, a: bigint, b: bigint): bigint {
  const x = clamp64(a);
  const y = clamp64(b);
  switch (op) {
    case 'AND': return clamp64(x & y);
    case 'OR': return clamp64(x | y);
    case 'XOR': return clamp64(x ^ y);
    case 'NOT': return clamp64(~x);
    // x is already clamped to 64 bits, so a shift of 64 or more always
    // vacates every bit — short-circuit rather than let BigInt materialise
    // an intermediate with `y` (attacker/user-reachable up to 2^64-1) bits,
    // which throws "Maximum BigInt size exceeded" (RangeError).
    case 'SHL': return y >= 64n ? 0n : clamp64(x << y);
    case 'SHR': return y >= 64n ? 0n : clamp64(x >> y);
    case 'MOD': return y === 0n ? 0n : clamp64(x % y);
    default: return 0n;
  }
}
