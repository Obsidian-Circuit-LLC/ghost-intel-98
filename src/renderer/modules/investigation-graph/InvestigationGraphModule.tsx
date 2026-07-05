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

export interface InvestigationGraphModuleProps {
  caseId: string;
}

export function InvestigationGraphModule({ caseId }: InvestigationGraphModuleProps): JSX.Element {
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
    <div style={{ display: 'flex', height: '100%', minHeight: 0, background: '#111820' }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <GraphPane caseId={caseId} onNodesChange={setNodes} />
      </div>
      <InvestigationSidePanel caseId={caseId} nodes={nodes} />
    </div>
  );
}
