/**
 * Investigation Graph — the per-case live projection of the SP-2 entity store + provenance
 * ledger, rendered through the shared `GraphCanvas` core (Task 1/6). On mount it fetches the
 * current `InvestigationScene` (Task 5 IPC) and subscribes to the live delta stream (Task 4/5),
 * folding each `SceneDelta` into local state via `applyDelta`. Client-side `GraphFilters` narrow
 * what's drawn without touching the underlying scene (`applyFilters`, pure). The manual
 * add-node/draw-edge write path (`window.api.investigation.addNode`/`addEdge`) lands in Task 7 —
 * `onDrawEdge` here is a local no-op until that IPC exists.
 */
import { useEffect, useState } from 'react';
import type { InvestigationScene, GraphFilters } from '@shared/investigation-graph';
import type { EntityType } from '@shared/types';
import { GraphCanvas } from '../../components/graph-canvas/GraphCanvas';
import type { RenderGraph } from '../../components/graph-canvas/svg-scene';
import { applyFilters, applyDelta } from './filters';

export interface InvestigationGraphModuleProps {
  caseId: string;
}

const EMPTY_SCENE: InvestigationScene = { nodes: [], edges: [] };

const DEFAULT_FILTERS: GraphFilters = {
  minScore: 0,
  search: '',
  type: 'all',
  cluster: 'all',
  hideUnconnected: false,
  showCooccurrence: true
};

export function InvestigationGraphModule({ caseId }: InvestigationGraphModuleProps): JSX.Element {
  const [scene, setScene] = useState<InvestigationScene>(EMPTY_SCENE);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);

  useEffect(() => {
    let cancelled = false;
    setScene(EMPTY_SCENE);
    setError(null);
    window.api.investigation
      .graph(caseId)
      .then((s) => { if (!cancelled) setScene(s); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    const off = window.api.investigation.onGraphDelta(caseId, (delta) => {
      setScene((s) => applyDelta(s, delta));
    });
    return () => { cancelled = true; off(); };
  }, [caseId]);

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12 }}>
        Could not load the investigation graph: {error}
      </div>
    );
  }

  const visible = applyFilters(scene, filters);
  const render: RenderGraph = {
    nodes: visible.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      strength: n.score,
      label: n.value,
      cls: `inv-node cluster-${n.cluster % 8} type-${n.type}`
    })),
    edges: visible.edges.map((e) => ({ source: e.source, target: e.target, cls: `edge-${e.kind}` }))
  };
  const byId = new Map(visible.nodes.map((n) => [n.id, n]));
  const types = [...new Set(scene.nodes.map((n) => n.type))].sort();
  const clusters = [...new Set(scene.nodes.map((n) => n.cluster))].sort((a, b) => a - b);

  // Task 7 wires this to `window.api.investigation.addEdge` once that write path exists.
  function manualEdge(_from: string, _to: string): void {
    /* no-op until Task 7 */
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111820' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, fontSize: 12, color: '#dfe6ec', borderBottom: '1px solid #333' }}>
        <label>
          Search{' '}
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </label>
        <label>
          Min score{' '}
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={filters.minScore}
            onChange={(e) => setFilters((f) => ({ ...f, minScore: Number(e.target.value) }))}
          />
        </label>
        <label>
          Type{' '}
          <select
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as EntityType | 'all' }))}
          >
            <option value="all">all</option>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Cluster{' '}
          <select
            value={String(filters.cluster)}
            onChange={(e) => setFilters((f) => ({ ...f, cluster: e.target.value === 'all' ? 'all' : Number(e.target.value) }))}
          >
            <option value="all">all</option>
            {clusters.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.hideUnconnected}
            onChange={(e) => setFilters((f) => ({ ...f, hideUnconnected: e.target.checked }))}
          />{' '}
          Hide unconnected
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.showCooccurrence}
            onChange={(e) => setFilters((f) => ({ ...f, showCooccurrence: e.target.checked }))}
          />{' '}
          Show co-occurrence
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GraphCanvas
          graph={render}
          ariaLabel="Investigation graph"
          onNodeClick={() => {}}
          onDrawEdge={manualEdge}
          emptyMessage="No entities yet — add a node or run a transform."
          renderInspector={(id) => {
            const node = byId.get(id);
            if (!node) return null;
            return (
              <>
                <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{node.value}</div>
                <div>Type: {node.type}</div>
                <div>Cluster: {node.cluster}</div>
                <div>Score: {node.score.toFixed(2)}</div>
                <div style={{ opacity: 0.7, wordBreak: 'break-all' }}>Entity id: {node.id}</div>
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
