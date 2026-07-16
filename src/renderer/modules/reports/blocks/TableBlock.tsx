/** TableBlock — one editable grid in a report's body (Task 8). The block stores a rectangular
 *  `string[][]` of sanitized cell HTML; the pure `addRow/addCol/removeRow/removeCol` helpers keep it
 *  rectangular (and never delete the last row/column) so the validator's rectangular-grid invariant
 *  holds at every keystroke. Each cell is a contentEditable whose innerHTML runs through
 *  `sanitizeReportHtml` before it reaches `onChange` — the same security spine every other block
 *  edit passes through, so table cells are never a bypass around the sanitizer. */
import type { ReportBlock } from '@shared/reports-types';
import { sanitizeReportHtml } from '../rich-text';

type TableData = Extract<ReportBlock, { kind: 'table' }>;

// Mirror the main-process validator caps (validate.ts MAX_TABLE_ROWS/MAX_TABLE_COLS). The editor
// must never let the grid exceed them: the validator clamps oversize grids on save, so an
// unbounded editor would silently drop the truncated cells on the next autosave.
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLS = 12;

export function addRow(cells: string[][]): string[][] { if (cells.length >= MAX_TABLE_ROWS) return cells; const w = cells[0]?.length ?? 1; return [...cells, Array(w).fill('')]; }
export function addCol(cells: string[][]): string[][] { if ((cells[0]?.length ?? 0) >= MAX_TABLE_COLS) return cells; return cells.map((r) => [...r, '']); }
export function removeRow(cells: string[][], i: number): string[][] { return cells.length <= 1 ? cells : cells.filter((_, x) => x !== i); }
export function removeCol(cells: string[][], j: number): string[][] { return (cells[0]?.length ?? 0) <= 1 ? cells : cells.map((r) => r.filter((_, x) => x !== j)); }

export interface TableBlockProps { block: TableData; onChange: (cells: string[][]) => void; onRemove?: () => void; }

export function TableBlock({ block, onChange, onRemove }: TableBlockProps): JSX.Element {
  function setCell(i: number, j: number, html: string): void {
    onChange(block.cells.map((row, x) => x === i ? row.map((c, y) => (y === j ? sanitizeReportHtml(html) : c)) : row));
  }
  return (
    <div className="ga98-report-tableblock">
      <div className="ga98-report-tableblock-toolbar">
        <button type="button" disabled={block.cells.length >= MAX_TABLE_ROWS} onClick={() => onChange(addRow(block.cells))}>+ Row</button>
        <button type="button" disabled={(block.cells[0]?.length ?? 0) >= MAX_TABLE_COLS} onClick={() => onChange(addCol(block.cells))}>+ Col</button>
        {onRemove ? <button type="button" aria-label="Remove table" onClick={onRemove}>✕</button> : null}
      </div>
      <table className="ga98-report-doc-table">
        <tbody>
          {block.cells.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>
                  <div contentEditable suppressContentEditableWarning role="textbox" aria-label={`Cell ${i + 1},${j + 1}`}
                    dangerouslySetInnerHTML={{ __html: cell }}
                    onInput={(e) => setCell(i, j, (e.target as HTMLElement).innerHTML)}
                    onBlur={(e) => setCell(i, j, (e.target as HTMLElement).innerHTML)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
