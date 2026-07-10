/**
 * Programmer-mode keypad — pure presentational buttons that dispatch semantic
 * actions to the shell. No calculator logic lives here; `programmer.ts` owns
 * the BigInt base conversion and bitwise math. Digit buttons are enabled per
 * the active base (HEX unlocks A–F, OCT locks out 8/9, BIN only allows 0/1).
 */

import type { Base, BitOpKind } from './programmer';

export interface ProgrammerKeypadProps {
  base: Base;
  onBaseChange(base: Base): void;
  onDigit(d: string): void;
  onBitOp(op: BitOpKind): void;
  onEquals(): void;
  onClear(): void;
  onClearEntry(): void;
  onBackspace(): void;
}

const BASES: Base[] = ['HEX', 'DEC', 'OCT', 'BIN'];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

function digitAllowed(d: string, base: Base): boolean {
  const n = parseInt(d, 16);
  if (base === 'HEX') return true;
  if (base === 'DEC') return n <= 9;
  if (base === 'OCT') return n <= 7;
  return n <= 1; // BIN
}

export function ProgrammerKeypad(props: ProgrammerKeypadProps): JSX.Element {
  return (
    <div className="ga98-calc-keypad ga98-calc-keypad-programmer">
      <div className="ga98-calc-base-toggle" role="group" aria-label="Base">
        {BASES.map((b) => (
          <button
            key={b}
            type="button"
            className="ga98-calc-key ga98-calc-base"
            data-active={props.base === b}
            onClick={() => props.onBaseChange(b)}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="ga98-calc-bitops" role="group" aria-label="Bitwise operations">
        {(['AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'MOD'] as BitOpKind[]).map((op) => (
          <button key={op} type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onBitOp(op)}>
            {op}
          </button>
        ))}
      </div>

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClearEntry}>CE</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClear}>C</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onBackspace}>←</button>

      <div className="ga98-calc-digit-grid">
        {DIGITS.map((d) => (
          <button
            key={d}
            type="button"
            className="ga98-calc-key ga98-calc-digit"
            disabled={!digitAllowed(d, props.base)}
            onClick={() => props.onDigit(d)}
          >
            {d}
          </button>
        ))}
      </div>

      <button type="button" className="ga98-calc-key ga98-calc-equals" onClick={props.onEquals}>=</button>
    </div>
  );
}
