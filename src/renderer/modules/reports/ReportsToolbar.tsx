/** ReportsToolbar — the Reports shell's Win98 button toolbar (New / Open / Save / Save As /
 *  Export PDF / Export DOCX / Print / Options / Help), grouped with separators. Uses the shared
 *  `ga98-toolbar` class; each button dispatches a `ReportsActionId` via `onAction(id)`. Editor-only
 *  actions (Save/Save As/Export/Print) are `disabled` unless a report is open (`hasOpenReport`);
 *  New/Open/Options/Help are always available. The action-id union is shared with `ReportsMenuBar`
 *  and the Task 6 dispatcher. */
import type { ReportsActionId } from './ReportsMenuBar';

export interface ReportsToolbarProps {
  hasOpenReport: boolean;
  onAction: (id: ReportsActionId) => void;
}

interface ToolButton {
  action?: ReportsActionId;
  label?: string;
  icon?: string;
  editorOnly?: boolean;
}

const SEP: ToolButton = {};

const BUTTONS: ToolButton[] = [
  { action: 'new', label: 'New', icon: '📄' },
  { action: 'open', label: 'Open', icon: '📂' },
  SEP,
  { action: 'save', label: 'Save', icon: '💾', editorOnly: true },
  { action: 'saveAs', label: 'Save As', icon: '🖫', editorOnly: true },
  SEP,
  { action: 'exportPdf', label: 'Export PDF', icon: '📕', editorOnly: true },
  { action: 'exportDocx', label: 'Export DOCX', icon: '📘', editorOnly: true },
  { action: 'print', label: 'Print', icon: '🖨️', editorOnly: true },
  SEP,
  { action: 'options', label: 'Options', icon: '⚙️' },
  { action: 'about', label: 'Help', icon: '❓' }
];

export function ReportsToolbar({ hasOpenReport, onAction }: ReportsToolbarProps): JSX.Element {
  return (
    <div className="ga98-toolbar ga98-report-toolbar" role="toolbar" aria-label="Reports">
      {BUTTONS.map((btn, i) => {
        if (btn.action === undefined) {
          return <span key={`sep-${i}`} className="ga98-report-toolbar-sep" />;
        }
        const action = btn.action;
        return (
          <button
            key={`${btn.action}-${i}`}
            type="button"
            className="ga98-report-toolbar-btn"
            data-tool-action={btn.action}
            disabled={btn.editorOnly === true && !hasOpenReport}
            onClick={() => onAction(action)}
          >
            {btn.icon ? <span className="ga98-report-btn-ico" aria-hidden="true">{btn.icon}</span> : null}
            {btn.label}
          </button>
        );
      })}
    </div>
  );
}
