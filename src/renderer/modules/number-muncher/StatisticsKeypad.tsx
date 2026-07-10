/**
 * Statistics-mode keypad — pure presentational numeric entry plus an
 * add-value / clear-dataset control and the aggregate-stats readout. No
 * statistics math lives here; `statistics.ts` owns the pure `stats()`
 * engine the shell calls whenever the dataset changes.
 */

import type { Stats } from './statistics';

export interface StatisticsKeypadProps {
  entry: string;
  dataset: number[];
  result: Stats;
  onDigit(d: string): void;
  onDot(): void;
  onBackspace(): void;
  onAddValue(): void;
  onClearEntry(): void;
  onClearDataset(): void;
}

export function StatisticsKeypad(props: StatisticsKeypadProps): JSX.Element {
  const digit = (d: string): JSX.Element => (
    <button type="button" className="ga98-calc-key ga98-calc-digit" onClick={() => props.onDigit(d)}>
      {d}
    </button>
  );
  const r = props.result;
  return (
    <div className="ga98-calc-keypad ga98-calc-keypad-statistics">
      <div className="ga98-calc-stats-dataset" aria-label="Dataset">
        {props.dataset.length === 0 ? (
          <span className="ga98-calc-stats-empty">No values yet.</span>
        ) : (
          props.dataset.join(', ')
        )}
      </div>

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClearEntry}>CE</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onClearDataset}>Clear Data</button>
      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onBackspace}>←</button>
      <div />

      {digit('7')}{digit('8')}{digit('9')}
      <div />

      {digit('4')}{digit('5')}{digit('6')}
      <div />

      {digit('1')}{digit('2')}{digit('3')}
      <div />

      <button type="button" className="ga98-calc-key ga98-calc-fn" onClick={props.onDot}>.</button>
      {digit('0')}
      <button type="button" className="ga98-calc-key ga98-calc-equals ga98-calc-stats-add" onClick={props.onAddValue}>Add</button>
      <div />

      <div className="ga98-calc-stats-readout" aria-label="Statistics readout">
        <dl className="ga98-calc-info-grid">
          <dt>Count</dt><dd>{r.count}</dd>
          <dt>Sum</dt><dd>{r.sum}</dd>
          <dt>Mean</dt><dd>{r.count ? r.mean : '—'}</dd>
          <dt>Median</dt><dd>{r.count ? r.median : '—'}</dd>
          <dt>Mode</dt><dd>{r.mode.length ? r.mode.join(', ') : '—'}</dd>
          <dt>Min</dt><dd>{r.count ? r.min : '—'}</dd>
          <dt>Max</dt><dd>{r.count ? r.max : '—'}</dd>
          <dt>Std Dev (pop)</dt><dd>{r.count ? r.stdevPop : '—'}</dd>
          <dt>Std Dev (sample)</dt><dd>{r.count ? r.stdevSample : '—'}</dd>
        </dl>
      </div>
    </div>
  );
}
