/** ReportsDashboard — the Reports shell's landing view (shown whenever no report is open in the
 *  editor). A welcome header over the dark workspace, a row of action tiles (Create New Report /
 *  Manage Contacts / Export or Print the selected report / a disabled "Use Template" tile), and the
 *  <RecentReportsTable> fed the nav-filtered report list. The module owns every handler and the
 *  report list; this component is presentational. Templates are deferred to sub-project B, so the
 *  "Use Template" tile is rendered `disabled` — greyed, never a no-op handler. Export/Print acts on
 *  the currently-selected row and is disabled when nothing is selected (no dead button). */
import type { Report } from '@shared/reports-types';
import { RecentReportsTable, type ReportContextAction } from './RecentReportsTable';

export interface ReportsDashboardProps {
  /** The nav-filtered report list (the shell applies `filterReports` before handing it down). */
  reports: Report[];
  /** The default author (settings.reports.author, resolved by the shell) — shown in the welcome line. */
  author: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onContext: (id: string, action: ReportContextAction) => void;
  onNewReport: () => void;
  onManageContacts: () => void;
  /** Export/Print the selected report (by id, main-side) — disabled when no row is selected. */
  onExportSelected: () => void;
  /** "View All Reports" footer — the shell switches the nav node to `all`. */
  onViewAll: () => void;
}

export function ReportsDashboard(props: ReportsDashboardProps): JSX.Element {
  const { reports, author, selectedId, onSelect, onOpen, onContext, onNewReport, onManageContacts, onExportSelected, onViewAll } = props;

  return (
    <div className="ga98-report-dashboard">
      <div className="ga98-report-dashboard-welcome">
        <h1 className="ga98-report-dashboard-title">Report Generator</h1>
        <p className="ga98-report-dashboard-sub">
          Signed in as <strong>{author || 'Investigator'}</strong>. Create a new chain-of-custody report or open a recent one below.
        </p>
      </div>

      <div className="ga98-report-tiles">
        <button type="button" className="ga98-report-tile" onClick={onNewReport}>
          <span className="ga98-report-tile-icon" aria-hidden="true">📄</span>
          <span className="ga98-report-tile-label">Create New Report</span>
        </button>
        <button type="button" className="ga98-report-tile" onClick={onManageContacts}>
          <span className="ga98-report-tile-icon" aria-hidden="true">👤</span>
          <span className="ga98-report-tile-label">Manage Contacts</span>
        </button>
        <button
          type="button"
          className="ga98-report-tile"
          disabled={selectedId === null}
          title={selectedId === null ? 'Select a report first' : 'Export the selected report'}
          onClick={onExportSelected}
        >
          <span className="ga98-report-tile-icon" aria-hidden="true">🖨️</span>
          <span className="ga98-report-tile-label">Export / Print</span>
        </button>
        {/* Templates deferred to sub-project B — rendered disabled, never a no-op handler. */}
        <button type="button" className="ga98-report-tile" disabled title="Templates coming soon">
          <span className="ga98-report-tile-icon" aria-hidden="true">🗂️</span>
          <span className="ga98-report-tile-label">Use Template</span>
        </button>
      </div>

      <div className="ga98-report-dashboard-recent">
        <div className="ga98-report-panel-title">Recent Reports</div>
        <RecentReportsTable
          reports={reports}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpen={onOpen}
          onContext={onContext}
          onViewAll={onViewAll}
        />
      </div>
    </div>
  );
}
