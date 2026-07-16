/** RecentReportsTable — the Dashboard's "Recent Reports" grid. A `ga98-report-recent` table with
 *  sortable headers (Name / Status / Last Modified / Created By), a highlighted selected row,
 *  single-click select, double-click open, and a right-click `ga98-context-menu`
 *  (Open/Rename/Duplicate/Export/Archive/Delete). Sort is local state driven by the pure
 *  `sortReports` (Task 2); the parent owns selection + the report list. Status cells carry a
 *  `ga98-report-status-{draft|completed|archived}` class so the theme (Task 7) can colour them.
 *  The 98.css native-table cascade paints every `<td>` white, so the class-restated backgrounds in
 *  theme.css beat the element rule on specificity — do not rely on the element default here. */
import { useState } from 'react';
import type { Report } from '@shared/reports-types';
import { sortReports } from './reports-filters';

export type ReportContextAction = 'open' | 'rename' | 'duplicate' | 'export' | 'archive' | 'delete';

type SortCol = 'title' | 'status' | 'updatedAt' | 'author';

export interface RecentReportsTableProps {
  reports: Report[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onContext: (id: string, action: ReportContextAction) => void;
  /** "View All Reports" footer button — Dashboard swaps the nav node to `all`. Optional. */
  onViewAll?: () => void;
}

const COLUMNS: { col: SortCol; label: string }[] = [
  { col: 'title', label: 'Name' },
  { col: 'status', label: 'Status' },
  { col: 'updatedAt', label: 'Last Modified' },
  { col: 'author', label: 'Created By' }
];

const CONTEXT_ITEMS: { action: ReportContextAction; label: string }[] = [
  { action: 'open', label: 'Open' },
  { action: 'rename', label: 'Rename' },
  { action: 'duplicate', label: 'Duplicate' },
  { action: 'export', label: 'Export' },
  { action: 'archive', label: 'Archive' },
  { action: 'delete', label: 'Delete' }
];

function fmtDate(iso: string): string {
  // updatedAt is an ISO stamp; show the date part only (deterministic, locale-independent).
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export function RecentReportsTable({ reports, selectedId, onSelect, onOpen, onContext, onViewAll }: RecentReportsTableProps): JSX.Element {
  const [sortCol, setSortCol] = useState<SortCol>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const rows = sortReports(reports, sortCol, sortDir);

  function toggleSort(col: SortCol): void {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  return (
    <div className="ga98-report-recent-wrap">
      <table className="ga98-report-recent">
        <thead>
          <tr>
            {COLUMNS.map(({ col, label }) => (
              <th
                key={col}
                aria-sort={sortCol === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onClick={() => toggleSort(col)}
              >
                {label}
                {sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-report-id={r.id}
              className={r.id === selectedId ? 'ga98-report-recent-selected' : ''}
              onClick={() => onSelect(r.id)}
              onDoubleClick={() => onOpen(r.id)}
              onContextMenu={(me) => {
                me.preventDefault();
                me.stopPropagation();
                onSelect(r.id);
                setCtxMenu({ id: r.id, x: me.clientX, y: me.clientY });
              }}
            >
              <td>{r.title}</td>
              <td className={`ga98-report-status-${r.status}`}>{r.status}</td>
              <td>{fmtDate(r.updatedAt)}</td>
              <td>{r.author}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="ga98-report-recent-empty">No reports yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="ga98-report-recent-actions">
        <button
          type="button"
          disabled={selectedId === null}
          onClick={() => { if (selectedId !== null) onOpen(selectedId); }}
        >
          Open Selected Report
        </button>
        <button type="button" onClick={() => onViewAll?.()}>View All Reports</button>
      </div>

      {ctxMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 29999 }} onMouseDown={() => setCtxMenu(null)} />
          <div className="ga98-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            {CONTEXT_ITEMS.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                className="ga98-context-menu-item"
                onClick={() => { const id = ctxMenu.id; setCtxMenu(null); onContext(id, action); }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
