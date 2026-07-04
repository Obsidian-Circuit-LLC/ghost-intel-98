/**
 * Pure geometry mapper for the Mind's Eye — turns a `MemoryGraphShape` (arbitrary-range x/y from
 * the deterministic layout pass) into a renderable SVG scene: circles for nodes, lines for edges,
 * text labels, normalized into a fixed viewBox. No I/O, no randomness, no DOM: same graph + view
 * in ⇒ same scene out, and every coordinate is finite (never NaN/Infinity) even for a single node
 * or an empty graph.
 */
import type { GraphNodeShape, MemoryGraphShape } from '@shared/ipc-contracts';

export interface SvgSceneNode {
  id: string;
  cx: number;
  cy: number;
  r: number;
  cls: string;
}

export interface SvgSceneEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: string;
}

export interface SvgSceneLabel {
  x: number;
  y: number;
  text: string;
}

export interface SvgScene {
  nodes: SvgSceneNode[];
  edges: SvgSceneEdge[];
  labels: SvgSceneLabel[];
}

const PAD = 24;
const MIN_R = 6;
const MAX_R = 22;

/** Linearly maps `raw` values into `[PAD, size - PAD]`. Degenerate ranges (0 or 1 node, or every
 *  node coincident) collapse to the center of the axis instead of dividing by zero / NaN. */
function scaleAxis(raw: number[], size: number): (v: number) => number {
  const center = size / 2;
  if (raw.length === 0) return () => center;
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return () => center;
  const usable = Math.max(size - 2 * PAD, 1);
  return (v: number) => PAD + ((v - lo) / span) * usable;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function nodeClass(n: GraphNodeShape): string {
  const parts = [`node-${n.kind}`];
  if (n.pinned) parts.push('pinned');
  if (n.conflict) parts.push('conflict');
  return parts.join(' ');
}

export function toSvgScene(graph: MemoryGraphShape, view: { w: number; h: number }): SvgScene {
  const sx = scaleAxis(graph.nodes.map((n) => n.x), view.w);
  const sy = scaleAxis(graph.nodes.map((n) => n.y), view.h);

  const nodes: SvgSceneNode[] = graph.nodes.map((n) => ({
    id: n.id,
    cx: sx(n.x),
    cy: sy(n.y),
    r: MIN_R + clamp01(n.strength) * (MAX_R - MIN_R),
    cls: nodeClass(n)
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: SvgSceneEdge[] = [];
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    edges.push({ x1: s.cx, y1: s.cy, x2: t.cx, y2: t.cy, cls: `edge-${e.kind}` });
  }

  const labels: SvgSceneLabel[] = nodes.map((n, i) => ({
    x: n.cx,
    y: n.cy - n.r - 4,
    text: graph.nodes[i].label
  }));

  return { nodes, edges, labels };
}
