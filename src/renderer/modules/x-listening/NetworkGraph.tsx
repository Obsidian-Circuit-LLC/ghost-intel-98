// src/renderer/modules/x-listening/NetworkGraph.tsx
//
// Task C2 (part B) — the COMMON NETWORK MIND MAP.
//
// Interactive SVG relationship graph for the X Listening Station Network tab. Rebuilt onto GI98
// seams from the Enterprise `NetworkGraph` (quarantined main.tsx) — a central COMMON NETWORK hub,
// monitored TARGET nodes on an inner ring, and the identities connected to >=2 targets on an outer
// ring (sized by cross-target overlap). Mode buttons filter edges (ALL RELATIONSHIPS / COMMON
// FOLLOWERS / COMMON FOLLOWING); a VISIBLE IDENTITIES selector caps the outer ring (20/40/60/100);
// clicking a node focuses its relationships (CLEAR FOCUS resets); an inspector panel exposes
// OPEN X PROFILE for an identity (routed to E1's Tor-gated `openInX('identity', …)` by the caller).
//
// Hardening / house rules honoured here:
//  • NO remote media — identity/target avatars are rendered as a tinted initial disc (extracted
//    accounts drop remote avatars by design; this never introduces a `pbs.twimg.com` <image>).
//  • Token-only colours — every stroke/fill/text colour resolves through a `--ga98-graph-*` token
//    (the Enterprise neon palette mapped onto tokens so the map themes in classic + QUIET AMETHYST).
//    No hex/keyword literal lives in this file or its CSS (the no-straggler guard stays green).
//  • DETERMINISTIC layout — node positions are a pure function of node index / count (a seeded
//    radial arrangement), never `Math.random`/`Date.now`; same model in → same positions out, so
//    the layout is stable and unit-testable.
//  • Reduced-motion-safe / performant — pure SVG, no rAF/animation loop; the only transition is a
//    CSS opacity fade disabled under `prefers-reduced-motion: reduce`. Bounded to <=16 targets +
//    <=100 identities.
//  • Defensive — an empty/undersized graph (<2 common identities) renders a plain empty state.

import { useMemo, useState } from 'react';

export type GraphMode = 'all' | 'follower' | 'following';

export interface GraphNodeModel {
  id: string;
  type: string; // 'target' | 'identity'
  label: string;
  username?: string;
  profileId?: string;
  score?: number;
  connectedTargets?: number;
  avatar?: string;
}

export interface GraphEdgeModel {
  id: string;
  source: string;
  target: string;
  relationship: 'follower' | 'following';
}

export interface NetworkGraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
}

export interface LaidNode {
  node: GraphNodeModel;
  x: number;
  y: number;
  hue: number; // 0..7 → --ga98-graph-hue-N token index
  radius: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  center: { x: number; y: number };
  targets: LaidNode[];
  identities: LaidNode[];
  edges: GraphEdgeModel[];
  connectedNodeIds: Set<string>;
}

const GRAPH_WIDTH = 1120;
const GRAPH_HEIGHT = 720;
const HUE_COUNT = 8;
const MAX_TARGETS = 16;
const IDENTITY_RADIUS_X = 455;
const IDENTITY_RADIUS_Y = 290;

/**
 * Pure, deterministic layout. Targets sit on an inner ring, common identities (>=2 targets) on an
 * outer ellipse; both are placed by their index in a stable, pre-sorted order — no randomness, no
 * clock. `limit` caps the visible identities (clamped [10,100]); `mode` filters edges to the
 * requested relationship. Exported for direct unit testing (determinism + mode filtering).
 */
export function computeGraphLayout(
  graph: NetworkGraphModel | null | undefined,
  mode: GraphMode,
  limit: number,
): GraphLayout {
  const nodes = graph?.nodes ?? [];
  const allEdges = graph?.edges ?? [];

  const targets = nodes.filter((n) => n.type === 'target').slice(0, MAX_TARGETS);
  const eligible = nodes
    .filter((n) => n.type === 'identity' && Number(n.connectedTargets || 0) >= 2)
    .sort(
      (a, b) =>
        Number(b.connectedTargets || 0) - Number(a.connectedTargets || 0) ||
        Number(b.score || 0) - Number(a.score || 0) ||
        String(a.username || a.id).localeCompare(String(b.username || b.id)),
    );
  const cap = Math.max(10, Math.min(100, Math.floor(limit) || 10));
  const identities = eligible.slice(0, cap);

  const visible = new Set([...targets, ...identities].map((n) => n.id));
  const edges = allEdges.filter(
    (e) =>
      visible.has(e.source) &&
      visible.has(e.target) &&
      (mode === 'all' || e.relationship === mode),
  );
  const connectedNodeIds = new Set(edges.flatMap((e) => [e.source, e.target]));

  const center = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  const targetRadius = Math.min(175, 95 + targets.length * 8);

  const laidTargets: LaidNode[] = targets.map((node, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, targets.length);
    return {
      node,
      x: center.x + Math.cos(angle) * targetRadius,
      y: center.y + Math.sin(angle) * targetRadius,
      hue: i % HUE_COUNT,
      radius: 18,
    };
  });
  const laidIdentities: LaidNode[] = identities.map((node, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, identities.length);
    return {
      node,
      x: center.x + Math.cos(angle) * IDENTITY_RADIUS_X,
      y: center.y + Math.sin(angle) * IDENTITY_RADIUS_Y,
      hue: (i + targets.length) % HUE_COUNT,
      radius: 9 + Math.min(11, Number(node.connectedTargets || 1) * 2),
    };
  });

  return {
    width: GRAPH_WIDTH,
    height: GRAPH_HEIGHT,
    center,
    targets: laidTargets,
    identities: laidIdentities,
    edges,
    connectedNodeIds,
  };
}

const VISIBLE_OPTIONS = [20, 40, 60, 100];

function initialOf(node: GraphNodeModel): string {
  const src = (node.username || node.label || '').replace(/^@+/, '');
  return (src.charAt(0) || '?').toUpperCase();
}

/**
 * Interactive COMMON NETWORK mind map. `onOpenIdentity` receives the raw @handle (no leading `@`);
 * the caller routes it through E1's Tor-gated `openInX('identity', …)`.
 */
export function NetworkGraph({
  graph,
  onOpenIdentity,
}: {
  graph: NetworkGraphModel;
  onOpenIdentity: (username: string) => void;
}): JSX.Element {
  const [mode, setMode] = useState<GraphMode>('all');
  const [limit, setLimit] = useState(40);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => computeGraphLayout(graph, mode, limit), [graph, mode, limit]);
  const { center, targets, identities, edges, connectedNodeIds } = layout;

  const posById = useMemo(() => {
    const m = new Map<string, LaidNode>();
    for (const t of targets) m.set(t.node.id, t);
    for (const i of identities) m.set(i.node.id, i);
    return m;
  }, [targets, identities]);

  const hueOf = (id: string): number => posById.get(id)?.hue ?? 0;

  const selected = selectedId ? posById.get(selectedId) ?? null : null;
  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const s = new Set<string>();
    for (const e of edges) {
      if (e.source === selectedId || e.target === selectedId) {
        s.add(e.source);
        s.add(e.target);
      }
    }
    return s;
  }, [edges, selectedId]);

  const dimmed = (id: string): boolean =>
    Boolean(selectedId && id !== selectedId && !selectedNeighbors.has(id));

  const focus = (id: string): void => setSelectedId((prev) => (prev === id ? null : id));

  const hasContent = targets.length > 0 && identities.length > 0;

  return (
    <div className="xls-graph-shell">
      <div className="xls-graph-toolbar">
        <div className="xls-graph-mode" role="group" aria-label="Relationship graph mode">
          <button
            type="button"
            className={`xls-btn xls-graph-mode-btn${mode === 'all' ? ' active' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            ALL RELATIONSHIPS
          </button>
          <button
            type="button"
            className={`xls-btn xls-graph-mode-btn${mode === 'follower' ? ' active' : ''}`}
            aria-pressed={mode === 'follower'}
            onClick={() => setMode('follower')}
          >
            COMMON FOLLOWERS
          </button>
          <button
            type="button"
            className={`xls-btn xls-graph-mode-btn${mode === 'following' ? ' active' : ''}`}
            aria-pressed={mode === 'following'}
            onClick={() => setMode('following')}
          >
            COMMON FOLLOWING
          </button>
        </div>
        <label className="xls-graph-visible">
          VISIBLE IDENTITIES
          <select
            className="xls-input"
            aria-label="Visible identities"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {VISIBLE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {selectedId && (
          <button
            type="button"
            className="xls-btn xls-graph-clear"
            onClick={() => setSelectedId(null)}
          >
            CLEAR FOCUS
          </button>
        )}
      </div>

      {!hasContent ? (
        <div className="xls-empty">
          At least two extracted target networks with a shared identity are required to draw the
          mind map — use EXTRACT FOLLOWERS / FOLLOWING above to populate it.
        </div>
      ) : (
        <div className="xls-graph-canvas">
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="xls-network-graph"
            role="img"
            aria-label="Interactive common follower and following relationship graph"
          >
            <circle
              cx={center.x}
              cy={center.y}
              r={Math.min(175, 95 + targets.length * 8) + 38}
              className="xls-mind-ring xls-mind-ring-inner"
            />
            <ellipse
              cx={center.x}
              cy={center.y}
              rx={IDENTITY_RADIUS_X + 24}
              ry={IDENTITY_RADIUS_Y + 24}
              className="xls-mind-ring xls-mind-ring-outer"
            />
            {edges.map((e) => {
              const a = posById.get(e.source);
              const b = posById.get(e.target);
              if (!a || !b) return null;
              const muted = Boolean(
                selectedId && e.source !== selectedId && e.target !== selectedId,
              );
              const cx = (a.x + b.x + center.x) / 3;
              const cy = (a.y + b.y + center.y) / 3;
              return (
                <path
                  key={e.id}
                  d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                  className={`xls-mind-edge xls-graph-hue-${hueOf(e.source)} ${e.relationship}${
                    muted ? ' muted' : ''
                  }`}
                />
              );
            })}

            <g className="xls-mind-center">
              <circle cx={center.x} cy={center.y} r={42} />
              <text x={center.x} y={center.y - 4} textAnchor="middle">
                COMMON
              </text>
              <text x={center.x} y={center.y + 12} textAnchor="middle">
                NETWORK
              </text>
            </g>

            {targets.map((t) => {
              const muted = dimmed(t.node.id) || !connectedNodeIds.has(t.node.id);
              return (
                <g
                  key={t.node.id}
                  className={`xls-mind-node target xls-graph-hue-${t.hue}${
                    muted ? ' dimmed' : ''
                  }${selectedId === t.node.id ? ' selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Target ${t.node.label}`}
                  onClick={() => focus(t.node.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      focus(t.node.id);
                    }
                  }}
                >
                  <circle className="xls-node-fill" cx={t.x} cy={t.y} r={t.radius} />
                  <text className="xls-node-initial" x={t.x} y={t.y + 4} textAnchor="middle">
                    {initialOf(t.node)}
                  </text>
                  <text className="xls-node-label" x={t.x} y={t.y + t.radius + 16} textAnchor="middle">
                    {t.node.label}
                  </text>
                </g>
              );
            })}

            {identities.map((it) => {
              const muted = dimmed(it.node.id) || !connectedNodeIds.has(it.node.id);
              const handle = (it.node.username || it.node.label || '').replace(/^@+/, '');
              return (
                <g
                  key={it.node.id}
                  className={`xls-mind-node identity click-node xls-graph-hue-${it.hue}${
                    muted ? ' dimmed' : ''
                  }${selectedId === it.node.id ? ' selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Identity ${it.node.label}, ${it.node.connectedTargets || 0} connected targets`}
                  onClick={() => focus(it.node.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      focus(it.node.id);
                    }
                  }}
                  onDoubleClick={() => handle && onOpenIdentity(handle)}
                >
                  <circle className="xls-node-fill" cx={it.x} cy={it.y} r={it.radius} />
                  <text className="xls-node-initial" x={it.x} y={it.y + 4} textAnchor="middle">
                    {initialOf(it.node)}
                  </text>
                  <circle
                    className="xls-score-badge"
                    cx={it.x + it.radius - 2}
                    cy={it.y - it.radius + 2}
                    r={7}
                  />
                  <text
                    className="xls-score-label"
                    x={it.x + it.radius - 2}
                    y={it.y - it.radius + 5}
                    textAnchor="middle"
                  >
                    {it.node.score || 0}
                  </text>
                  <text
                    className="xls-node-label"
                    x={it.x}
                    y={it.y + it.radius + 15}
                    textAnchor="middle"
                  >
                    {it.node.label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="xls-graph-legend">
            <span>
              <i className="xls-legend-swatch xls-legend-rainbow" />
              Neon colour = target / identity cluster
            </span>
            <span>
              <i className="xls-legend-swatch xls-legend-line follower" />
              Solid = identity follows target
            </span>
            <span>
              <i className="xls-legend-swatch xls-legend-line following" />
              Dashed = target follows identity
            </span>
            <span>Node size = cross-target overlap</span>
          </div>
        </div>
      )}

      <div className="xls-graph-inspector">
        {selected ? (
          <>
            <div>
              <strong>{selected.node.label}</strong>
              <span>
                {selected.node.type === 'identity'
                  ? `${selected.node.connectedTargets || 0} connected targets · overlap score ${
                      selected.node.score || 0
                    }`
                  : 'Monitored target source'}
              </span>
            </div>
            {selected.node.type === 'identity' && selected.node.username && (
              <button
                type="button"
                className="xls-btn xls-btn-primary"
                onClick={() =>
                  onOpenIdentity((selected.node.username || '').replace(/^@+/, ''))
                }
              >
                OPEN X PROFILE
              </button>
            )}
            <small>
              Click a node to focus its relationships. Double-click an identity to open its live X
              profile (Tor-gated).
            </small>
          </>
        ) : (
          <>
            <div>
              <strong>RELATIONSHIP MIND MAP</strong>
              <span>
                {identities.length} common identities · {edges.length} visible relationships
              </span>
            </div>
            <small>Select a node to isolate its connections.</small>
          </>
        )}
      </div>
    </div>
  );
}
