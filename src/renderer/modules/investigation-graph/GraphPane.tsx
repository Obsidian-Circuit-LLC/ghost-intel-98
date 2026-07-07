/**
 * GraphPane — the per-case live graph body, extracted **behavior-preserving** from
 * InvestigationGraphModule so the shell (module) doesn't become a god-component. It owns the
 * scene fetch/subscribe/filter/manual-add path exactly as the module did before Task 7;
 * `test/investigation-graph-render.pw.test.ts` continues to guard it unchanged.
 *
 * On mount it fetches the current `InvestigationScene` and subscribes to the live delta stream,
 * folding each `SceneDelta` into local state via `applyDelta`. Client-side `GraphFilters` narrow
 * what's drawn without touching the underlying scene (`applyFilters`, pure). The manual
 * add-node/draw-edge write path calls `window.api.investigation.addNode`/`addEdge`, which append a
 * `manual` evidence record main-side and stream back through the same delta channel — this
 * component never mutates local scene state directly from a write.
 *
 * `onNodesChange` bubbles the current scene's nodes (as seed candidates) up to the shell so the
 * side panel's run form can offer them as seeds — a single scene subscription feeding both halves.
 */
import { useEffect, useState } from 'react';
import type { InvestigationScene, GraphFilters } from '@shared/investigation-graph';
import { ENTITY_TYPES, type EntityType } from '@shared/types';
import { GraphCanvas } from '../../components/graph-canvas/GraphCanvas';
import type { RenderGraph } from '../../components/graph-canvas/svg-scene';
import { applyFilters, applyDelta } from './filters';
import type { SeedNode } from './RunPanel';
import { useInvestigationRunStore } from '../../state/investigation-run-store';

export interface GraphPaneProps {
  caseId: string;
  /** Bubble the scene's nodes up as seed candidates for the run form. */
  onNodesChange?: (nodes: SeedNode[]) => void;
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

export function GraphPane({ caseId, onNodesChange }: GraphPaneProps): JSX.Element {
  const [scene, setScene] = useState<InvestigationScene>(EMPTY_SCENE);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [addType, setAddType] = useState<EntityType>(ENTITY_TYPES[0]);
  const [addValue, setAddValue] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // The active run (if any) for this case — enables in-inspector Focus/Ignore steering (spec §4).
  const runEntry = useInvestigationRunStore((s) => s.cases[caseId]);
  const activeRunId =
    runEntry && (runEntry.status === 'running' || runEntry.status === 'paused')
      ? runEntry.runId
      : null;

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

  // Bubble seed candidates up whenever the scene changes (single subscription, both halves fed).
  useEffect(() => {
    onNodesChange?.(scene.nodes.map((n) => ({ id: n.id, value: n.value, type: n.type })));
  }, [scene, onNodesChange]);

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

  function manualEdge(from: string, to: string): void {
    // The delta this produces streams back through onGraphDelta above — no local state write here.
    void window.api.investigation.addEdge(caseId, from, to, 'related').catch((e: unknown) => {
      setAddError(e instanceof Error ? e.message : String(e));
    });
  }

  function handleAddNode(): void {
    const value = addValue.trim();
    if (!value || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    window.api.investigation
      .addNode(caseId, addType, value)
      .then(() => setAddValue(''))
      .catch((e: unknown) => setAddError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAddBusy(false));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111820' }}>
      <div className="graph-pane-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, fontSize: 12 }}>
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
        <span style={{ borderLeft: '1px solid #333', paddingLeft: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={addType} onChange={(e) => setAddType(e.target.value as EntityType)} aria-label="New entity type">
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            placeholder="value…"
            aria-label="New entity value"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddNode(); }}
          />
          <button type="button" onClick={handleAddNode} disabled={addBusy || addValue.trim().length === 0}>
            Add node
          </button>
          {addError && <span style={{ color: '#e06060' }}>{addError}</span>}
        </span>
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
                {activeRunId && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        void window.api.investigation.run.focus(activeRunId, node.id);
                      }}
                    >
                      Focus
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void window.api.investigation.run.ignore(activeRunId, node.id);
                      }}
                    >
                      Ignore
                    </button>
                  </div>
                )}
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
