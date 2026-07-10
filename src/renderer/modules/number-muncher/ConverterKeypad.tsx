/**
 * Converter-mode keypad — pure presentational category/unit selectors plus a
 * numeric entry pad. No conversion math lives here; `converter.ts` owns the
 * factor-table `convert()` the shell calls whenever category/units/value
 * change.
 */

import type { Category } from './converter';
import { CATEGORIES } from './converter';

export interface ConverterKeypadProps {
  category: Category;
  onCategoryChange(cat: Category): void;
  fromUnit: string;
  toUnit: string;
  onFromChange(unit: string): void;
  onToChange(unit: string): void;
  onSwap(): void;
  onDigit(d: string): void;
  onDot(): void;
  onClear(): void;
  onClearEntry(): void;
  onBackspace(): void;
}

const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export function ConverterKeypad(props: ConverterKeypadProps): JSX.Element {
  const units = Object.keys(CATEGORIES[props.category]);
  const digit = (d: string): JSX.Element => (
    <button type="button" className="ga98-calc-key ga98-calc-digit" onClick={() => props.onDigit(d)}>
      {d}
    </button>
  );
  return (
    <div className="ga98-calc-keypad ga98-calc-keypad-converter">
      <div className="ga98-calc-conv-row">
        <label className="ga98-calc-conv-label">
          Category
          <select
            className="ga98-text"
            value={props.category}
            onChange={(e) => props.onCategoryChange(e.target.value as Category)}
          >
            {CATEGORY_KEYS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ga98-calc-conv-row">
        <label className="ga98-calc-conv-label">
          From
          <select className="ga98-text" value={props.fromUnit} onChange={(e) => props.onFromChange(e.target.value)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ga98-calc-key ga98-calc-fn ga98-calc-conv-swap" onClick={props.onSwap}>
          ⇄
        </button>
        <label className="ga98-calc-conv-label">
          To
          <select className="ga98-text" value={props.toUnit} onChange={(e) => props.onToChange(e.target.value)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClearEntry}>CE</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClear}>C</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onBackspace}>←</button>
      <div />

      {digit('7')}{digit('8')}{digit('9')}
      <div />

      {digit('4')}{digit('5')}{digit('6')}
      <div />

      {digit('1')}{digit('2')}{digit('3')}
      <div />

      <div />
      {digit('0')}
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onDot}>.</button>
      <div />
    </div>
  );
}
