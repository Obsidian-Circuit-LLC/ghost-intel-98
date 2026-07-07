/**
 * InvestigationGraphModule — the per-case investigation cockpit shell (spec §1, §3).
 *
 * A thin composition: `<GraphPane>` (the live SP-2/SP-4 graph, center) beside a docked,
 * collapsible `<InvestigationSidePanel>` (Run/Report). The graph body itself lives in GraphPane —
 * extracted behavior-preserving so this file stays a shell (`investigation-graph-render.pw.test.ts`
 * still guards the graph half). Scene nodes bubble up from GraphPane so the side panel's run form
 * can offer them as seeds; a single scene subscription feeds both halves.
 */
import { useEffect, useState } from 'react';
import { GraphPane } from './GraphPane';
import { InvestigationSidePanel } from './InvestigationSidePanel';
import type { SeedNode } from './RunPanel';
import { useInvestigationRunStore } from '../../state/investigation-run-store';
import { startRunStream } from '../../state/investigation-run-stream.singleton';
import './investigation.css';

export interface InvestigationGraphModuleProps {
  /** Optional at the type level because the module can be opened from the global OSINT AccessMenu,
   *  which supplies no props. A missing caseId renders the no-case hint (never the graph). */
  caseId?: string;
}

/** The investigation cockpit is per-case. Opened without a caseId (e.g. from the global OSINT menu)
 *  it must not touch the graph IPC — it points the operator at the case-scoped entry point instead
 *  of rendering a raw "Invalid caseId" error. Guard-only wrapper: no hooks here, so the early return
 *  is clean; all state/effects live in <InvestigationCockpit> which only ever sees a real caseId. */
export function InvestigationGraphModule({ caseId }: InvestigationGraphModuleProps): JSX.Element {
  if (!caseId) return <InvestigationNoCaseHint />;
  return <InvestigationCockpit caseId={caseId} />;
}

/** Calm, actionable empty state shown when the cockpit is opened without a case. */
export function InvestigationNoCaseHint(): JSX.Element {
  return (
    <div style={{ height: '100%', background: '#111820', color: '#cfe4ef', padding: 20, fontSize: 13, lineHeight: 1.6 }}>
      <p style={{ fontWeight: 'bold', marginBottom: 8 }}>Open an investigation from a case</p>
      <p>The investigation cockpit works on one case at a time.</p>
      <p style={{ marginTop: 8 }}>Open <b>Cases</b>, open a case, then click <b>“Open investigation…”</b>.</p>
    </div>
  );
}

function InvestigationCockpit({ caseId }: { caseId: string }): JSX.Element {
  const [nodes, setNodes] = useState<SeedNode[]>([]);
  const setAvailable = useInvestigationRunStore((s) => s.setAvailable);

  // Wire the run half live on mount (spec §6): subscribe the mount-independent run-event
  // singleton exactly once so a run's feed keeps accruing across a tab-switch unmount, and
  // probe run capability into the per-case store so RunPanel renders its calm unavailable
  // state until the reasoning pack lands. Both are optional-chained so a graph-only surface
  // (no run channel bound) degrades quietly instead of throwing.
  useEffect(() => {
    startRunStream(); // self-guarding + idempotent
    let cancelled = false;
    window.api?.investigation?.run
      ?.available?.()
      .then((ok) => { if (!cancelled) setAvailable(caseId, ok); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [caseId, setAvailable]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          background: 'var(--ga98-grey)',
          color: '#000',
          padding: '4px 10px',
          fontSize: 12,
          borderBottom: '1px solid var(--ga98-shadow-dark)',
          boxShadow: 'inset 0 -1px 0 var(--ga98-shadow-light)',
        }}
      >
        An entity graph you grow with transforms — seed a node, pivot outward; autonomous fan-out
        needs the reasoning pack.
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, background: '#111820' }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <GraphPane caseId={caseId} onNodesChange={setNodes} />
        </div>
        <InvestigationSidePanel caseId={caseId} nodes={nodes} />
      </div>
    </div>
  );
}
