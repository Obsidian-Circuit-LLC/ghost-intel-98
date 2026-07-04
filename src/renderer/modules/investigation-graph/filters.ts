/**
 * Pure, client-side view filters over an `InvestigationScene` — no IPC, no mutation of the
 * underlying scene. `applyFilters` narrows nodes/edges for display; `applyDelta` folds a streamed
 * `SceneDelta` (Task 3/4) into the renderer's local scene state between fetches.
 */
import type { InvestigationScene, GraphFilters, InvNode, InvEdge, SceneDelta } from '@shared/investigation-graph';

export function applyFilters(scene: InvestigationScene, f: GraphFilters): InvestigationScene {
  let nodes = scene.nodes.filter((n) =>
    n.score >= f.minScore &&
    (f.type === 'all' || n.type === f.type) &&
    (f.cluster === 'all' || n.cluster === f.cluster) &&
    (!f.search || n.value.toLowerCase().includes(f.search.toLowerCase())));
  const keep = new Set(nodes.map((n) => n.id));
  let edges = scene.edges.filter((e) => keep.has(e.source) && keep.has(e.target) && (f.showCooccurrence || e.kind !== 'cooccurrence'));
  if (f.hideUnconnected) {
    const connected = new Set<string>(); for (const e of edges) { connected.add(e.source); connected.add(e.target); }
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  return { nodes, edges };
}

const edgeKey = (e: InvEdge): string => `${e.source} ${e.target} ${e.relation} ${e.kind}`;

/** Folds a streamed `SceneDelta` into a local scene: applies added/updated/removed nodes then
 *  added/removed edges, sorted the same stable way `buildInvestigationScene`/`diffScenes`
 *  produce so repeated deltas stay deterministic. Pure — no I/O, no clock. */
export function applyDelta(scene: InvestigationScene, delta: SceneDelta): InvestigationScene {
  const nodes = new Map<string, InvNode>(scene.nodes.map((n) => [n.id, n]));
  for (const n of delta.added) nodes.set(n.id, n);
  for (const n of delta.updated) nodes.set(n.id, n);
  for (const id of delta.removed) nodes.delete(id);

  const edges = new Map<string, InvEdge>(scene.edges.map((e) => [edgeKey(e), e]));
  for (const e of delta.addedEdges) edges.set(edgeKey(e), e);
  for (const k of delta.removedEdges) edges.delete(k);

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => (a.source + a.target + a.relation).localeCompare(b.source + b.target + b.relation)),
  };
}
