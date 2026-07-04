/**
 * Mind's Eye — the SVG memory graph surface. Fetches the assembled `MemoryGraph` over IPC and
 * renders it as plain SVG (circles/lines/text) — no `<canvas>`, ever (canvas rendered solid black
 * on mobile in the v1 prototype; see test/minds-eye-render.pw.test.ts for the regression guard).
 * Empty graph ⇒ an inviting message, never a blank/black rect. Clicking a node opens a small
 * inspector panel (kind, label, strength, provenance). No animation is used, so there is nothing
 * for `prefers-reduced-motion` to need to disable.
 */
import { useEffect, useState } from 'react';
import type { GraphNodeShape, MemoryGraphShape } from '@shared/ipc-contracts';
import { toSvgScene } from './svg-graph';

const VIEW = { w: 720, h: 500 };

const KIND_FILL: Record<string, string> = {
  fact: '#4aa3ff',
  doc: '#3fbf7f',
  conversation: '#e0a030',
  entity: '#b07cf0'
};

function fillForCls(cls: string): string {
  const kind = cls.split(' ')[0]?.replace('node-', '') ?? '';
  return KIND_FILL[kind] ?? '#9aa5b1';
}

export function MindsEyeModule(): JSX.Element {
  const [graph, setGraph] = useState<MemoryGraphShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNodeShape | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.memory
      .graph()
      .then((g) => { if (!cancelled) setGraph(g); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12 }}>
        Could not load the memory graph: {error}
      </div>
    );
  }

  if (!graph) {
    return <div style={{ padding: 16, fontSize: 12, opacity: 0.7 }}>Loading the memory graph…</div>;
  }

  if (graph.nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center', fontSize: 13, opacity: 0.8 }}>
        Nothing remembered yet — start chatting or ➕ add a document.
      </div>
    );
  }

  const scene = toSvgScene(graph, VIEW);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111820' }}>
      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        style={{ flex: 1, minHeight: 0, width: '100%', background: '#111820' }}
        role="img"
        aria-label="Mind's Eye memory graph"
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
          />
        ))}
        {scene.nodes.map((n) => {
          const node = byId.get(n.id);
          const pinned = n.cls.includes('pinned');
          const conflict = n.cls.includes('conflict');
          return (
            <circle
              key={n.id}
              cx={n.cx}
              cy={n.cy}
              r={n.r}
              fill={fillForCls(n.cls)}
              stroke={conflict ? '#ff5050' : pinned ? '#ffd700' : 'none'}
              strokeWidth={conflict || pinned ? 2 : 0}
              style={{ cursor: 'pointer' }}
              onClick={() => node && setSelected(node)}
            >
              <title>{node?.label ?? n.id}</title>
            </circle>
          );
        })}
        {scene.labels.map((l, i) => (
          <text key={`l${i}`} x={l.x} y={l.y} fontSize={9} fill="#cfd8e0" textAnchor="middle">
            {l.text.length > 24 ? `${l.text.slice(0, 24)}…` : l.text}
          </text>
        ))}
      </svg>
      {selected && (
        <div style={{ borderTop: '1px solid #444', padding: 8, fontSize: 12, background: '#1a232c', color: '#dfe6ec' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{selected.label}</div>
          <div>Kind: {selected.kind}</div>
          <div>Strength: {selected.strength.toFixed(2)}</div>
          <div>Pinned: {selected.pinned ? 'yes' : 'no'}{selected.conflict ? ' · Conflict' : ''}</div>
          <div style={{ opacity: 0.7, wordBreak: 'break-all' }}>Provenance: {selected.id}</div>
          <button onClick={() => setSelected(null)} style={{ marginTop: 4 }}>Close</button>
        </div>
      )}
    </div>
  );
}
