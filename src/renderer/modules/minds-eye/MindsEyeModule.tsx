/**
 * Mind's Eye — the SVG memory graph surface. Fetches the assembled `MemoryGraph` over IPC and
 * renders it via the shared `GraphCanvas` core (plain SVG — no `<canvas>`, ever; canvas rendered
 * solid black on mobile in the v1 prototype; see test/minds-eye-render.pw.test.ts for the
 * regression guard). Empty graph ⇒ an inviting message, never a blank/black rect. Clicking a node
 * opens a small inspector panel (kind, label, strength, provenance). No animation is used, so
 * there is nothing for `prefers-reduced-motion` to need to disable.
 */
import { useEffect, useState } from 'react';
import type { GraphNodeShape, MemoryGraphShape } from '@shared/ipc-contracts';
import { GraphCanvas } from '../../components/graph-canvas/GraphCanvas';
import type { RenderGraph } from '../../components/graph-canvas/svg-scene';

const VIEW = { w: 720, h: 500 };

/** Uploaded-library `doc` nodes carry `doc:<docId>` as a segment of their node id (see
 *  `library/sources.ts`'s `doc:${docId}` sourceKey → `build.ts`'s `${caseId}:${sourceKey}` node
 *  id). Briefcase/journal/conversation/entity-sourced `doc` nodes don't have a real library
 *  docId, so their sourceKey does not start with `doc:` and there is nothing forgetDoc can remove
 *  — return `null` so the caller can disable Forget rather than fire a silent no-op. */
export function docIdFromNodeId(id: string): string | null {
  const parts = id.split(':');
  const i = parts.indexOf('doc');
  return i >= 0 && i < parts.length - 1 ? parts.slice(i + 1).join(':') : null;
}

export function MindsEyeModule(): JSX.Element {
  const [graph, setGraph] = useState<MemoryGraphShape | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    } finally {
      setBusy(false);
    }
  }

  async function forgetFact(node: GraphNodeShape): Promise<void> {
    setBusy(true);
    try {
      await window.api.memory.profileDelete([node.id]);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function forgetDoc(node: GraphNodeShape): Promise<void> {
    const docId = docIdFromNodeId(node.id);
    if (docId === null) return; // briefcase/journal/conversation/entity doc nodes aren't library-backed
    setBusy(true);
    try {
      await window.api.memory.forgetDoc(docId);
      load();
    } finally {
      setBusy(false);
    }
  }

  /** Resolve one detected conflict pair (the "one thing to fix" tray below) by merging the
   *  other fact into the kept one — unions provenance, keeps the higher confidence. */
  async function resolveConflict(keepId: string, dropId: string): Promise<void> {
    setBusy(true);
    try {
      await window.api.memory.mergeItems(keepId, dropId);
      load();
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

  /** Draw a bond between two nodes (dragged node-to-node). Self-bonds are a no-op (ignored by
   *  `createBonds().add` too, but skipping here avoids an unnecessary round-trip + reload). */
  async function addBond(a: string, b: string): Promise<void> {
    if (a === b) return;
    setBusy(true);
    try {
      await window.api.memory.bonds.add(a, b);
      load();
    } finally {
      setBusy(false);
    }
  }

  /** Cut a bond (click its edge). */
  async function cutBond(a: string, b: string): Promise<void> {
    setBusy(true);
    try {
      await window.api.memory.bonds.remove(a, b);
      load();
    } finally {
      setBusy(false);
    }
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

  const render: RenderGraph = {
    nodes: graph.nodes.map((n) => ({
      id: n.id, x: n.x, y: n.y, strength: n.strength, label: n.label,
      cls: ['node-' + n.kind, n.pinned ? 'pinned' : '', n.conflict ? 'conflict' : ''].filter(Boolean).join(' '),
    })),
    edges: graph.edges.map((e) => ({ source: e.source, target: e.target, cls: 'edge-' + e.kind })),
  };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // "One thing to fix" tray: surface a single detected conflict pair at a time (never the whole
  // list) — the FIRST ACTUAL pair from `graph.conflictPairs` (as returned by `detectConflicts`),
  // resolved to nodes via `byId`. Deliberately NOT `graph.nodes.filter(conflict).slice(0,2)`:
  // with >=2 independent conflicting pairs interleaved in storage order (e.g. [a,c,b,d] where the
  // real conflicts are (a,b) and (c,d)), all four nodes carry `conflict:true` and slicing the
  // first two would pair up unrelated facts. Resolving merges the second into the first via
  // mergeItems; the tray then re-derives from the freshly-loaded graph.
  const firstPair = graph.conflictPairs[0];
  const conflictPair = firstPair
    ? ([byId.get(firstPair[0]), byId.get(firstPair[1])].filter((n): n is GraphNodeShape => n != null))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111820' }}>
      {conflictPair.length === 2 && (
        <div style={{ padding: 8, fontSize: 12, background: '#3a2a1a', color: '#f0d8b0', borderBottom: '1px solid #5a4020' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>One thing to fix: conflicting facts</div>
          <div style={{ marginBottom: 6 }}>
            &ldquo;{conflictPair[0].label}&rdquo; vs &ldquo;{conflictPair[1].label}&rdquo;
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={busy} onClick={() => resolveConflict(conflictPair[0].id, conflictPair[1].id)}>
              Keep &ldquo;{conflictPair[0].label}&rdquo;
            </button>
            <button disabled={busy} onClick={() => resolveConflict(conflictPair[1].id, conflictPair[0].id)}>
              Keep &ldquo;{conflictPair[1].label}&rdquo;
            </button>
          </div>
        </div>
      )}
      <GraphCanvas
        graph={render}
        view={VIEW}
        ariaLabel="Mind's Eye memory graph"
        onNodeClick={() => {}}
        onDrawEdge={addBond}
        onEdgeClick={(source, target, cls) => { if (cls === 'edge-bond') cutBond(source, target); }}
        emptyMessage="Nothing remembered yet — start chatting or ➕ add a document."
        renderInspector={(id) => {
          const selected = byId.get(id);
          if (!selected) return null;
          return (
            <>
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
                  <button
                    disabled={busy || docIdFromNodeId(selected.id) === null}
                    title={docIdFromNodeId(selected.id) === null
                      ? 'Briefcase/journal/conversation/entity memories are managed in their own tools'
                      : undefined}
                    onClick={() => forgetDoc(selected)}
                  >
                    Forget
                  </button>
                )}
                {(selected.kind === 'conversation' || selected.kind === 'entity') && (
                  <button disabled title="Forgetting conversations/entities isn't supported yet">Forget</button>
                )}
                <button disabled={busy} onClick={() => recallIntoChat(selected)}>Recall into chat</button>
              </div>
            </>
          );
        }}
      />
    </div>
  );
}
