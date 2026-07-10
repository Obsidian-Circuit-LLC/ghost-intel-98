import { describe, it, expect } from 'vitest';
import { toBase, fromBase, bitOp } from '../src/renderer/modules/number-muncher/programmer';
describe('programmer', () => {
  it('base conversion (BigInt-exact, 64-bit)', () => {
    expect(toBase(255n, 'HEX')).toBe('FF'); expect(toBase(255n, 'BIN')).toBe('11111111'); expect(toBase(255n, 'OCT')).toBe('377');
    expect(fromBase('FF', 'HEX')).toBe(255n); expect(fromBase('11111111', 'BIN')).toBe(255n);
  });
  it('bitwise AND/OR/XOR/NOT/shifts', () => {
    expect(bitOp('AND', 12n, 10n)).toBe(8n); expect(bitOp('OR', 12n, 10n)).toBe(14n); expect(bitOp('XOR', 12n, 10n)).toBe(6n);
    expect(bitOp('SHL', 1n, 4n)).toBe(16n); expect(bitOp('SHR', 16n, 2n)).toBe(4n); expect(bitOp('MOD', 17n, 5n)).toBe(2n);
  });
  it('SHL/SHR with an ordinary-digit-entry shift count (>=64) yields 0 instead of throwing', () => {
    // 9999999999n is a plain 10-digit decimal a user can type as the second
    // operand — well under the 64-bit value ceiling, but far past a 64-bit
    // shift width. Pre-fix this threw RangeError ("Maximum BigInt size
    // exceeded") inside the pure engine.
    expect(() => bitOp('SHL', 1n, 9999999999n)).not.toThrow();
    expect(bitOp('SHL', 1n, 9999999999n)).toBe(0n);
    expect(() => bitOp('SHR', 0xffffffffffffffffn, 9999999999n)).not.toThrow();
    expect(bitOp('SHR', 0xffffffffffffffffn, 9999999999n)).toBe(0n);
    expect(bitOp('SHL', 1n, 64n)).toBe(0n);
    expect(bitOp('SHL', 1n, 63n)).toBe(1n << 63n);
  });
});
