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
});
