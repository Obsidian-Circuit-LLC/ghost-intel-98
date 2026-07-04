/**
 * Shared graph-canvas render core — extracted from Mind's Eye (T15) so any domain (memory graph,
 * investigation graph) can render an arbitrary `RenderGraph` as plain SVG (circles/lines/text),
 * never `<canvas>` (canvas rendered solid black on mobile in the v1 prototype; see
 * test/minds-eye-render.pw.test.ts for the regression guard this preserves). Empty graph ⇒ an
 * inviting message, never a blank/black rect. Clicking a node opens a small inspector panel whose
 * BODY the caller supplies via `renderInspector`; the panel chrome (border/Close button) lives
 * here so every consumer gets the same behavior for free. Dragging from one node to another (the
 * bond-drag gesture) reports `onDrawEdge(from, to)`; a plain click (no drag) reports
 * `onNodeClick(id)` and opens the inspector for that node.
 */
import { useState, type ReactNode } from 'react';
import { toSvgScene, type RenderGraph } from './svg-scene';

export interface GraphCanvasProps {
  graph: RenderGraph;
  view?: { w: number; h: number };
  onNodeClick: (id: string) => void;
  onDrawEdge: (from: string, to: string) => void;
  /** Optional: click handling for edges (Mind's Eye uses this to cut a `bond` edge). */
  onEdgeClick?: (source: string, target: string, cls: string) => void;
  /** Returns the inspector panel's body for the currently-selected node id, or `null`/`undefined`
   *  if there is nothing to show (e.g. the node no longer exists after a reload) — the panel
   *  (including its Close button) is hidden automatically in that case. */
  renderInspector: (id: string) => ReactNode;
  emptyMessage: string;
  ariaLabel?: string;
}

const DEFAULT_VIEW = { w: 720, h: 500 };

const KIND_FILL: Record<string, string> = {
  fact: '#4aa3ff',
  doc: '#3fbf7f',
  conversation: '#e0a030',
  entity: '#b07cf0'
};

/** Deterministic fill for a node's `cls`: preserves Mind's Eye's exact kind→color palette for its
 *  `node-<kind>` classes; other domains (e.g. investigation-graph's `inv-node cluster-N type-X`)
 *  get a stable hash-derived hue so distinct classes are visually distinguishable without any
 *  per-domain callback (and without `Math.random`, which would break determinism). */
function fillForCls(cls: string): string {
  const first = cls.split(' ')[0] ?? '';
  if (first.startsWith('node-')) {
    return KIND_FILL[first.replace('node-', '')] ?? '#9aa5b1';
  }
  let h = 0;
  for (let i = 0; i < cls.length; i++) h = (h * 31 + cls.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 55%)`;
}

export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  const { graph, view = DEFAULT_VIEW, onNodeClick, onDrawEdge, onEdgeClick, renderInspector, emptyMessage, ariaLabel } = props;
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (graph.nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center', fontSize: 13, opacity: 0.8 }}>
        {emptyMessage}
      </div>
    );
  }

  const scene = toSvgScene(graph, view);
  const inspectorBody = selectedId ? renderInspector(selectedId) : null;
  const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111820' }}>
      <svg
        viewBox={`0 0 ${view.w} ${view.h}`}
        style={{ flex: 1, minHeight: 0, width: '100%', background: '#111820' }}
        role="img"
        aria-label={ariaLabel ?? 'Graph canvas'}
        onMouseUp={() => setDragFrom(null)}
      >
        {scene.edges.map((e, i) => (
          <line
            key={`e${i}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke={e.cls === 'edge-bond' ? '#e0a030' : '#3a4a5a'}
            strokeWidth={e.cls === 'edge-bond' ? 2 : 1}
            style={onEdgeClick ? { cursor: 'pointer' } : undefined}
            onClick={onEdgeClick ? () => onEdgeClick(e.source, e.target, e.cls) : undefined}
          >
            {onEdgeClick && e.cls === 'edge-bond' && <title>Click to cut this link</title>}
          </line>
        ))}
        {scene.nodes.map((n) => {
          const pinned = n.cls.includes('pinned');
          const conflict = n.cls.includes('conflict');
          return (
            <circle
              key={n.id}
              cx={n.cx}
              cy={n.cy}
              r={n.r}
              className={n.cls}
              fill={fillForCls(n.cls)}
              stroke={conflict ? '#ff5050' : pinned ? '#ffd700' : 'none'}
              strokeWidth={conflict || pinned ? 2 : 0}
              style={{ cursor: 'pointer' }}
              onMouseDown={() => setDragFrom(n.id)}
              onMouseUp={(ev) => {
                ev.stopPropagation();
                if (dragFrom && dragFrom !== n.id) {
                  onDrawEdge(dragFrom, n.id);
                } else {
                  setSelectedId(n.id);
                  onNodeClick(n.id);
                }
                setDragFrom(null);
              }}
            >
              <title>{labelById.get(n.id) ?? n.id} — drag to another node to link them</title>
            </circle>
          );
        })}
        {scene.labels.map((l, i) => (
          <text key={`l${i}`} x={l.x} y={l.y} fontSize={9} fill="#cfd8e0" textAnchor="middle">
            {l.text.length > 24 ? `${l.text.slice(0, 24)}…` : l.text}
          </text>
        ))}
      </svg>
      {inspectorBody != null && (
        <div style={{ borderTop: '1px solid #444', padding: 8, fontSize: 12, background: '#1a232c', color: '#dfe6ec' }}>
          {inspectorBody}
          <button onClick={() => setSelectedId(null)} style={{ marginTop: 4 }}>Close</button>
        </div>
      )}
    </div>
  );
}
