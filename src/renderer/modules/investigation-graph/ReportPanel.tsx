/**
 * ReportPanel — the Report half of the per-case investigation cockpit (spec §5).
 *
 * A scope toggle (This case / This run — the latter enabled only when a runId is in play, e.g. the
 * user arrived from a terminal run), a primary Generate button that calls
 * report.generate(caseId, {runId?}) per scope, the ReportView preview, and a secondary Export PDF
 * action calling report.save(caseId, {runId?}) (main renders the PDF + OS save dialog).
 *
 * Request/response, not persisted (v1): the panel holds { report, loading, scope, exporting }
 * locally. Switching scope re-generates when a report is already on screen. When arriving pre-scoped
 * to a runId the panel defaults to run scope. Empty model → empty state (ReportView renders it).
 *
 * CHARTER: the report renders as React (ReportView), never an embedded HTML doc/iframe. `report.save`
 * UUID-gates the caseId main-side; runId is a bounded filter string. No new egress, no telemetry.
 */

import { useState } from 'react';
import type { IntelReport } from '@shared/investigation-report';
import { ReportView } from './ReportView';

export interface ReportPanelProps {
  caseId: string;
  /** When set (arriving from a terminal run), enables + defaults to run scope. */
  runId?: string;
}

type Scope = 'case' | 'run';

export function ReportPanel({ caseId, runId }: ReportPanelProps): JSX.Element {
  const [scope, setScope] = useState<Scope>(runId ? 'run' : 'case');
  const [report, setReport] = useState<IntelReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  /** Scope → the opts passed to generate/save. `case` passes no second arg (matches the IPC default). */
  const optsFor = (s: Scope): [] | [{ runId: string }] =>
    s === 'run' && runId ? [{ runId }] : [];

  const generate = async (s: Scope): Promise<void> => {
    setLoading(true);
    setSavedPath(null);
    try {
      const r = await window.api.investigation.report.generate(caseId, ...optsFor(s));
      setReport(r);
    } finally {
      setLoading(false);
    }
  };

  const chooseScope = (s: Scope): void => {
    if (s === scope) return;
    setScope(s);
    // Re-generate on scope switch only when a report is already on screen (spec §5).
    if (report) void generate(s);
  };

  const exportPdf = async (): Promise<void> => {
    setExporting(true);
    try {
      const path = await window.api.investigation.report.save(caseId, ...optsFor(scope));
      setSavedPath(path);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="report-panel">
      <div className="report-panel__scope" role="group" aria-label="Report scope">
        <button
          type="button"
          className={scope === 'case' ? 'report-panel__scope-btn report-panel__scope-btn--on' : 'report-panel__scope-btn'}
          aria-pressed={scope === 'case'}
          onClick={() => chooseScope('case')}
        >
          This case
        </button>
        <button
          type="button"
          className={scope === 'run' ? 'report-panel__scope-btn report-panel__scope-btn--on' : 'report-panel__scope-btn'}
          aria-pressed={scope === 'run'}
          disabled={!runId}
          title={runId ? undefined : 'Open a report from a finished run to scope to that run'}
          onClick={() => chooseScope('run')}
        >
          This run
        </button>
      </div>

      <div className="report-panel__actions">
        <button
          type="button"
          className="report-panel__primary"
          disabled={loading}
          onClick={() => void generate(scope)}
        >
          {loading ? 'Generating…' : 'Generate report'}
        </button>
        <button
          type="button"
          className="report-panel__export"
          disabled={exporting}
          onClick={() => void exportPdf()}
        >
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {savedPath ? <p className="report-panel__saved">Saved to {savedPath}</p> : null}

      <div className="report-panel__preview">
        {report ? (
          <ReportView report={report} />
        ) : (
          <p className="report-panel__hint">
            Generate the INTELREPORT to preview key actors, findings, and methodology.
          </p>
        )}
      </div>
    </div>
  );
}
