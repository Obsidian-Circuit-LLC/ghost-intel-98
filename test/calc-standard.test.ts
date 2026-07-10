import { describe, it, expect } from 'vitest';
import { INIT, inputDigit, inputDot, setOp, equals, unary, clearAll, clearEntry, backspace } from '../src/renderer/modules/number-muncher/standard';

const seq = (...fns: ((s: any) => any)[]) => fns.reduce((s, f) => f(s), INIT);
describe('standard calculator', () => {
  it('2 + 3 = 5', () => {
    const s = seq((s)=>inputDigit(s,'2'), (s)=>setOp(s,'+'), (s)=>inputDigit(s,'3'), equals);
    expect(s.display).toBe('5');
  });
  it('7 - 2 * 3 chains left-to-right (7-2=5, *3=15)', () => {
    const s = seq((s)=>inputDigit(s,'7'), (s)=>setOp(s,'-'), (s)=>inputDigit(s,'2'), (s)=>setOp(s,'*'), (s)=>inputDigit(s,'3'), equals);
    expect(s.display).toBe('15');
  });
  it('divide by zero → Error, cleared by C', () => {
    const s = seq((s)=>inputDigit(s,'5'), (s)=>setOp(s,'/'), (s)=>inputDigit(s,'0'), equals);
    expect(s.error).toBe(true);
    expect(clearAll(s).display).toBe('0');
  });
  it('unary: sqrt(9)=3, square(4)=16, 1/x of 4 = 0.25', () => {
    expect(unary(seq((s)=>inputDigit(s,'9')), 'sqrt').display).toBe('3');
    expect(unary(seq((s)=>inputDigit(s,'4')), 'square').display).toBe('16');
    expect(unary(seq((s)=>inputDigit(s,'4')), 'inv').display).toBe('0.25');
  });
  it('decimal + backspace + CE', () => {
    expect(seq((s)=>inputDigit(s,'1'), inputDot, (s)=>inputDigit(s,'5')).display).toBe('1.5');
    expect(backspace(seq((s)=>inputDigit(s,'1'),(s)=>inputDigit(s,'2'))).display).toBe('1');
    expect(clearEntry(seq((s)=>inputDigit(s,'9'))).display).toBe('0');
  });
});
