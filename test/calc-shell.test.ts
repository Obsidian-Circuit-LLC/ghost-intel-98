import { describe, it, expect } from 'vitest';
import { memoryOp, pushHistory } from '../src/renderer/modules/number-muncher/calc-shell';
describe('memory + history', () => {
  it('MS stores, MR recalls, M+ adds, MC clears', () => {
    let reg = memoryOp(0, 'MS', 5); expect(reg).toBe(5);
    reg = memoryOp(reg, 'M+', 3); expect(reg).toBe(8);
    expect(memoryOp(reg, 'MR', 99)).toBe(8);  // MR does not change the register
    expect(memoryOp(reg, 'MC', 0)).toBe(0);
  });
  it('pushHistory prepends + is bounded to 100', () => {
    let h: string[] = [];
    for (let i = 0; i < 120; i++) h = pushHistory(h, `e${i}`);
    expect(h.length).toBe(100); expect(h[0]).toBe('e119');
  });
});
