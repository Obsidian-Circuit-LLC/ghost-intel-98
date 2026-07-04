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

/** Uploaded-library `doc` nodes carry `doc:<docId>` as a segment of their node id (see
 *  `library/sources.ts`'s `doc:${docId}` sourceKey → `build.ts`'s `${caseId}:${sourceKey}` node
 *  id); briefcase/journal-sourced `doc` nodes don't have a real library docId, so extraction
 *  falls back to the full node id (a harmless no-op forgetDoc — nothing in the library manifest
 *  matches, so nothing is removed). */
function docIdFromNodeId(id: string): string {
  const parts = id.split(':');
  const i = parts.indexOf('doc');
  return i >= 0 && i < parts.length - 1 ? parts.slice(i + 1).join(':') : id;
}

export function MindsEyeModule(): JSX.Element {
  const [graph, setGraph] = useState<MemoryGraphShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNodeShape | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    window.api.memory
      .graph()
      .then((g) => setGraph(g))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    let cancelled = false;
    window.api.memory
      .graph()
      .then((g) => { if (!cancelled) setGraph(g); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  /** Pin/forget a `fact` reuses the existing adaptive-memory profile governance IPC (no new
   *  channel); `profileUpsert` needs the item's `scope`/`text`, which aren't on the graph node
   *  shape, so pin looks the item up via `profileList` first. */
  async function togglePinFact(node: GraphNodeShape): Promise<void> {
    setBusy(true);
    try {
      const items = await window.api.memory.profileList();
      const item = items.find((it) => it.id === node.id);
      if (item) {
        await window.api.memory.profileUpsert({ id: item.id, scope: item.scope, text: item.text, pinned: !item.pinned });
      }
      load();
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  async function forgetFact(node: GraphNodeShape): Promise<void> {
    setBusy(true);
    try {
      await window.api.memory.profileDelete([node.id]);
      load();
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  async function forgetDoc(node: GraphNodeShape): Promise<void> {
    setBusy(true);
    try {
      await window.api.memory.forgetDoc(docIdFromNodeId(node.id));
      load();
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  /** Recall-into-chat is renderer-only per the curation spec: no new IPC, just post the node's
   *  label into the active AI Assistant composer via a window message that AiAssistantModule (or
   *  any listener) can pick up. */
  function recallIntoChat(node: GraphNodeShape): void {
    window.dispatchEvent(new CustomEvent('dcs98:minds-eye-recall', { detail: { text: node.label } }));
  }

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
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {selected.kind === 'fact' && (
              <>
                <button disabled={busy} onClick={() => togglePinFact(selected)}>
                  {selected.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button disabled={busy} onClick={() => forgetFact(selected)}>Forget</button>
              </>
            )}
            {selected.kind === 'doc' && (
              <button disabled={busy} onClick={() => forgetDoc(selected)}>Forget</button>
            )}
            {(selected.kind === 'conversation' || selected.kind === 'entity') && (
              <button disabled title="Forgetting conversations/entities isn't supported yet">Forget</button>
            )}
            <button disabled={busy} onClick={() => recallIntoChat(selected)}>Recall into chat</button>
          </div>
          <button onClick={() => setSelected(null)} style={{ marginTop: 4 }}>Close</button>
        </div>
      )}
    </div>
  );
}
