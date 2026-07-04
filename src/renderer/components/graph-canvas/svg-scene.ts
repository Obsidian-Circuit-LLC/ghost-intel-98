/**
 * Pure geometry mapper for the shared graph canvas — turns a domain-neutral `RenderGraph`
 * (arbitrary-range x/y from a deterministic layout pass, with precomputed `cls` per node/edge)
 * into a renderable SVG scene: circles for nodes, lines for edges, text labels, normalized into a
 * fixed viewBox. No I/O, no randomness, no DOM: same graph + view in ⇒ same scene out, and every
 * coordinate is finite (never NaN/Infinity) even for a single node or an empty graph.
 */

export interface RenderGraphNode {
  id: string;
  x: number;
  y: number;
  strength: number;
  cls: string;
  label: string;
}

export interface RenderGraphEdge {
  source: string;
  target: string;
  cls: string;
}

export interface RenderGraph {
  nodes: RenderGraphNode[];
  edges: RenderGraphEdge[];
}

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
  /** Endpoint node ids — carried through so the renderer can cut a bond edge (`kind:'bond'`) by
   *  its actual node ids without needing to re-derive them from on-screen geometry. */
  source: string;
  target: string;
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

export function toSvgScene(graph: RenderGraph, view: { w: number; h: number }): SvgScene {
  const sx = scaleAxis(graph.nodes.map((n) => n.x), view.w);
  const sy = scaleAxis(graph.nodes.map((n) => n.y), view.h);

  const nodes: SvgSceneNode[] = graph.nodes.map((n) => ({
    id: n.id,
    cx: sx(n.x),
    cy: sy(n.y),
    r: MIN_R + clamp01(n.strength) * (MAX_R - MIN_R),
    cls: n.cls
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: SvgSceneEdge[] = [];
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    edges.push({ x1: s.cx, y1: s.cy, x2: t.cx, y2: t.cy, cls: e.cls, source: e.source, target: e.target });
  }

  const labels: SvgSceneLabel[] = nodes.map((n, i) => ({
    x: n.cx,
    y: n.cy - n.r - 4,
    text: graph.nodes[i].label
  }));

  return { nodes, edges, labels };
}
