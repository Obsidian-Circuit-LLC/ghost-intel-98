/**
 * Date Calc-mode keypad — pure presentational date inputs plus a
 * numeric day-count entry pad. No date math lives here; `date-calc.ts` owns
 * the pure `daysBetween()`/`addDays()` engine the shell calls whenever the
 * inputs change.
 */

export interface DateCalcKeypadProps {
  startDate: string;
  endDate: string;
  onStartDateChange(date: string): void;
  onEndDateChange(date: string): void;
  daysBetweenResult: number;

  baseDate: string;
  onBaseDateChange(date: string): void;
  daysEntry: string;
  onDigit(d: string): void;
  onBackspace(): void;
  onClearEntry(): void;
  onAddDays(): void;
  onSubtractDays(): void;
  addResult: string;
}

export function DateCalcKeypad(props: DateCalcKeypadProps): JSX.Element {
  const digit = (d: string): JSX.Element => (
    <button type="button" className="ga98-calc-key ga98-calc-digit" onClick={() => props.onDigit(d)}>
      {d}
    </button>
  );
  return (
    <div className="ga98-calc-keypad ga98-calc-keypad-date">
      <div className="ga98-calc-date-row">
        <label className="ga98-calc-conv-label">
          From
          <input
            type="date"
            className="ga98-text"
            value={props.startDate}
            onChange={(e) => props.onStartDateChange(e.target.value)}
          />
        </label>
        <label className="ga98-calc-conv-label">
          To
          <input
            type="date"
            className="ga98-text"
            value={props.endDate}
            onChange={(e) => props.onEndDateChange(e.target.value)}
          />
        </label>
      </div>
      <div className="ga98-calc-date-readout" aria-label="Days between">
        {props.daysBetweenResult} day{props.daysBetweenResult === 1 ? '' : 's'} apart
      </div>

      <div className="ga98-calc-date-row">
        <label className="ga98-calc-conv-label">
          Base date
          <input
            type="date"
            className="ga98-text"
            value={props.baseDate}
            onChange={(e) => props.onBaseDateChange(e.target.value)}
          />
        </label>
      </div>

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClearEntry}>CE</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onBackspace}>←</button>
      <div />
      <div />

      {digit('7')}{digit('8')}{digit('9')}
      <div />

      {digit('4')}{digit('5')}{digit('6')}
      <div />

      {digit('1')}{digit('2')}{digit('3')}
      <div />

      <div />
      {digit('0')}
      <button type="button" className="ga98-calc-key ga98-calc-equals" onClick={props.onAddDays}>+ Days</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onSubtractDays}>− Days</button>

      <div className="ga98-calc-date-readout" aria-label="Date result">
        Days to add/subtract: {props.daysEntry} → {props.addResult}
      </div>
    </div>
  );
}
