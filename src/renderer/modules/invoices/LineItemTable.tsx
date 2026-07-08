/** Editable line-item table: each row is date + start/end time + description; hours + amount are derived
 *  live from the row's time range and the invoice's flat rate. Presentational — emits the new list up. */
import type { InvoiceLine } from '@shared/invoice-types';
import { lineHours, round2, formatMoney } from './calc';

let seq = 0;
const newLine = (): InvoiceLine => ({ id: `l${++seq}-${Date.now()}`, date: '', start: '', end: '', description: '' });

export function LineItemTable(
  { lines, rate, currency, onChange }:
  { lines: InvoiceLine[]; rate: number; currency: string; onChange: (lines: InvoiceLine[]) => void }
): JSX.Element {
  const set = (i: number, patch: Partial<InvoiceLine>): void => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <table className="ga98-invoice-lines">
      <thead><tr><th>Date</th><th>Start</th><th>End</th><th>Description</th><th>Hours</th><th>Amount</th><th /></tr></thead>
      <tbody>
        {lines.map((l, i) => {
          const h = lineHours(l);
          return (
            <tr key={l.id}>
              <td><input type="date" className="ga98-text" value={l.date} onChange={(e) => set(i, { date: e.target.value })} /></td>
              <td><input type="time" className="ga98-text" value={l.start} onChange={(e) => set(i, { start: e.target.value })} /></td>
              <td><input type="time" className="ga98-text" value={l.end} onChange={(e) => set(i, { end: e.target.value })} /></td>
              <td><input className="ga98-text" value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td className="num">{h}</td>
              <td className="num">{formatMoney(round2(h * rate), currency)}</td>
              <td><button aria-label="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          );
        })}
      </tbody>
      <tfoot><tr><td colSpan={7}><button onClick={() => onChange([...lines, newLine()])}>Add line</button></td></tr></tfoot>
    </table>
  );
}
