/**
 * Standard-mode keypad — pure presentational buttons that dispatch semantic
 * actions to the shell. No calculator logic lives here; the shell owns the FSM.
 */

import type { Op } from './standard';

export interface StandardKeypadProps {
  onDigit(d: string): void;
  onDot(): void;
  onOp(op: Op): void;
  onEquals(): void;
  onUnary(kind: 'sqrt' | 'square' | 'inv' | 'neg' | 'pct'): void;
  onClear(): void;
  onClearEntry(): void;
  onBackspace(): void;
}

export function StandardKeypad(props: StandardKeypadProps): JSX.Element {
  const digit = (d: string): JSX.Element => (
    <button type="button" className="ga98-calc-key ga98-calc-digit" onClick={() => props.onDigit(d)}>
      {d}
    </button>
  );
  return (
    <div className="ga98-calc-keypad ga98-calc-keypad-standard">
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClearEntry}>CE</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClear}>C</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onBackspace}>←</button>
      <button type="button" className="ga98-calc-key ga98-calc-op" onClick={() => props.onOp('/')}>÷</button>

      {digit('7')}{digit('8')}{digit('9')}
      <button type="button" className="ga98-calc-key ga98-calc-op" onClick={() => props.onOp('*')}>×</button>

      {digit('4')}{digit('5')}{digit('6')}
      <button type="button" className="ga98-calc-key ga98-calc-op" onClick={() => props.onOp('-')}>-</button>

      {digit('1')}{digit('2')}{digit('3')}
      <button type="button" className="ga98-calc-key ga98-calc-op" onClick={() => props.onOp('+')}>+</button>

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onUnary('inv')}>1/x</button>
      {digit('0')}
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onDot}>.</button>
      <button type="button" className="ga98-calc-key ga98-calc-equals" onClick={props.onEquals}>=</button>

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onUnary('sqrt')}>√</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onUnary('square')}>x²</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onUnary('neg')}>±</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onUnary('pct')}>%</button>
    </div>
  );
}
