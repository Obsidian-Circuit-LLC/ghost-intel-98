import type { InvestigationScene, InvNode, InvEdge, SceneDelta } from '@shared/investigation-graph';

const edgeKey = (e: InvEdge): string => `${e.source} ${e.target} ${e.relation} ${e.kind}`;
const nodeEq = (a: InvNode, b: InvNode): boolean =>
  a.type === b.type && a.value === b.value && a.cluster === b.cluster && a.score === b.score && a.x === b.x && a.y === b.y;

export function diffScenes(prev: InvestigationScene, next: InvestigationScene): SceneDelta {
  const prevN = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextN = new Map(next.nodes.map((n) => [n.id, n]));
  const added: InvNode[] = [], updated: InvNode[] = [], removed: string[] = [];
  for (const n of next.nodes) { const p = prevN.get(n.id); if (!p) added.push(n); else if (!nodeEq(p, n)) updated.push(n); }
  for (const id of prevN.keys()) if (!nextN.has(id)) removed.push(id);

  const prevE = new Map(prev.edges.map((e) => [edgeKey(e), e]));
  const nextE = new Map(next.edges.map((e) => [edgeKey(e), e]));
  const addedEdges: InvEdge[] = [], removedEdges: string[] = [];
  for (const [k, e] of nextE) if (!prevE.has(k)) addedEdges.push(e);
  for (const k of prevE.keys()) if (!nextE.has(k)) removedEdges.push(k);
  return { added, updated, removed, addedEdges, removedEdges };
}
