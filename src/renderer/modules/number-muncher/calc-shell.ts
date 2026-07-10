/**
 * Shared calculator-shell helpers — pure functions the NumberMuncher shell uses
 * to manage the memory register and the bounded history log. No DOM, no state.
 */

export type MemOp = 'MC' | 'MR' | 'MS' | 'M+' | 'M-';

/** Apply a memory operation to the register. MR/MC ignore `current`. */
export function memoryOp(reg: number, op: MemOp, current: number): number {
  switch (op) {
    case 'MC':
      return 0;
    case 'MR':
      return reg;
    case 'MS':
      return current;
    case 'M+':
      return reg + current;
    case 'M-':
      return reg - current;
  }
}

/** Prepend an entry to the history list, bounded to the 100 most recent. */
export function pushHistory(list: string[], entry: string): string[] {
  return [entry, ...list].slice(0, 100);
}
