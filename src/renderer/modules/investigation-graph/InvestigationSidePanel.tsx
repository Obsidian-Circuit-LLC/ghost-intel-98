/**
 * InvestigationSidePanel — the docked, collapsible cockpit beside the graph (spec §3, §1).
 *
 * A Run/Report segmented switch (default Run) composes `RunPanel` and `ReportPanel`, plus a
 * collapse toggle so the analyst can reclaim graph width. "Open report" from a terminal run
 * (RunPanel's `onOpenReport`) flips the switch to the Report section pre-scoped to that runId,
 * so the report opens already scoped to the run that just finished (spec §4 terminal → §5 scope).
 *
 * Run UI state lives in the per-case run store (survives an unmount); the report is a
 * request/response snapshot held by ReportPanel (not persisted, v1). Only the active section is
 * mounted — RunPanel rehydrates from the store on return, so section-switching is safe.
 */

import { useState } from 'react';
import { RunPanel, type SeedNode } from './RunPanel';
import { ReportPanel } from './ReportPanel';

export interface InvestigationSidePanelProps {
  caseId: string;
  /** Scene nodes offered as run seeds (bubbled up from GraphPane by the shell). */
  nodes: SeedNode[];
}

type Section = 'run' | 'report';

export function InvestigationSidePanel({ caseId, nodes }: InvestigationSidePanelProps): JSX.Element {
  const [section, setSection] = useState<Section>('run');
  const [collapsed, setCollapsed] = useState(false);
  const [reportRunId, setReportRunId] = useState<string | undefined>(undefined);

  const openReport = (runId?: string): void => {
    setReportRunId(runId);
    setSection('report');
  };

  if (collapsed) {
    return (
      <div className="investigation-side-panel investigation-side-panel--collapsed">
        <button
          type="button"
          className="investigation-side-panel__expand"
          aria-label="Expand panel"
          onClick={() => setCollapsed(false)}
        >
          ‹
        </button>
      </div>
    );
  }

  return (
    <div className="investigation-side-panel">
      <div className="investigation-side-panel__header">
        <div
          className="investigation-side-panel__switch"
          role="group"
          aria-label="Panel section"
        >
          <button
            type="button"
            className={
              section === 'run'
                ? 'investigation-side-panel__tab investigation-side-panel__tab--on'
                : 'investigation-side-panel__tab'
            }
            aria-pressed={section === 'run'}
            onClick={() => setSection('run')}
          >
            Run
          </button>
          <button
            type="button"
            className={
              section === 'report'
                ? 'investigation-side-panel__tab investigation-side-panel__tab--on'
                : 'investigation-side-panel__tab'
            }
            aria-pressed={section === 'report'}
            onClick={() => setSection('report')}
          >
            Report
          </button>
        </div>
        <button
          type="button"
          className="investigation-side-panel__collapse"
          aria-label="Collapse panel"
          onClick={() => setCollapsed(true)}
        >
          ›
        </button>
      </div>

      <div className="investigation-side-panel__body">
        {section === 'run' ? (
          <RunPanel caseId={caseId} nodes={nodes} onOpenReport={openReport} />
        ) : (
          <ReportPanel caseId={caseId} runId={reportRunId} />
        )}
      </div>
    </div>
  );
}
