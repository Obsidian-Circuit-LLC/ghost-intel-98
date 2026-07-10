/**
 * Scientific-mode keypad — pure presentational buttons that dispatch semantic
 * actions to the shell. No calculator logic lives here; `scientific.ts` owns
 * the math, `standard.ts` still owns digit entry/display editing (Scientific
 * reuses the same display/entry primitives as Standard, layered with trig/
 * log/pow/factorial function keys and a deg/rad/grad angle-unit toggle).
 */

import type { Op } from './standard';
import type { Angle, SciFn } from './scientific';

export interface ScientificKeypadProps {
  angle: Angle;
  onAngleChange(unit: Angle): void;
  onDigit(d: string): void;
  onDot(): void;
  onOp(op: Op): void;
  onEquals(): void;
  onSci(fn: SciFn): void;
  onClear(): void;
  onClearEntry(): void;
  onBackspace(): void;
}

const ANGLE_UNITS: Angle[] = ['deg', 'rad', 'grad'];

export function ScientificKeypad(props: ScientificKeypadProps): JSX.Element {
  const digit = (d: string): JSX.Element => (
    <button type="button" className="ga98-calc-key ga98-calc-digit" onClick={() => props.onDigit(d)}>
      {d}
    </button>
  );
  const sciKey = (fn: SciFn, label: string): JSX.Element => (
    <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={() => props.onSci(fn)}>
      {label}
    </button>
  );
  return (
    <div className="ga98-calc-keypad ga98-calc-keypad-scientific">
      <div className="ga98-calc-angle-toggle" role="group" aria-label="Angle unit">
        {ANGLE_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            className="ga98-calc-key ga98-calc-angle"
            data-active={props.angle === u}
            onClick={() => props.onAngleChange(u)}
          >
            {u.toUpperCase()}
          </button>
        ))}
      </div>

      {sciKey('sin', 'sin')}
      {sciKey('cos', 'cos')}
      {sciKey('tan', 'tan')}
      {sciKey('pow', 'x^y')}

      {sciKey('asin', 'asin')}
      {sciKey('acos', 'acos')}
      {sciKey('atan', 'atan')}
      {sciKey('fact', 'x!')}

      {sciKey('log', 'log')}
      {sciKey('ln', 'ln')}
      {sciKey('exp', 'e^x')}
      {sciKey('tenx', '10^x')}

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

      {sciKey('sqrt', '√')}
      {digit('0')}
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onDot}>.</button>
      <button type="button" className="ga98-calc-key ga98-calc-equals" onClick={props.onEquals}>=</button>
    </div>
  );
}
