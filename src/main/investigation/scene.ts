import type { EntityRecord, EntityType } from '@shared/types';
import type { EvidenceRecord, Finding } from '@shared/investigation-types';
import type { InvNode, InvEdge, InvestigationScene } from '@shared/investigation-graph';

const BAND_SCORE = { high: 1, medium: 0.6, low: 0.3 } as const;

function hash(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h >>> 0; }

/** Connected-components over an adjacency map; returns id→component index, components numbered by
 *  their lowest-sorted member so the numbering is deterministic. */
function components(ids: string[], adj: Map<string, Set<string>>): Map<string, number> {
  const sorted = [...ids].sort();
  const comp = new Map<string, number>();
  let next = 0;
  for (const start of sorted) {
    if (comp.has(start)) continue;
    const idx = next++;
    const stack = [start];
    comp.set(start, idx);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of [...(adj.get(cur) ?? [])].sort()) if (!comp.has(nb)) { comp.set(nb, idx); stack.push(nb); }
    }
  }
  return comp;
}

/** Deterministic layout: each cluster on a big ring by index; each node on a small ring around its
 *  cluster center, angle from its id hash. Pure — no RNG/clock. */
function layoutScene(nodes: Omit<InvNode, 'x' | 'y'>[]): InvNode[] {
  const clusters = [...new Set(nodes.map((n) => n.cluster))].sort((a, b) => a - b);
  const cx = 500, cy = 500, R = 350, r = 120;
  return nodes.map((n) => {
    const ci = clusters.indexOf(n.cluster);
    const ca = (2 * Math.PI * ci) / Math.max(clusters.length, 1);
    const na = (2 * Math.PI * (hash(n.id) % 360)) / 360;
    return { ...n, x: cx + R * Math.cos(ca) + r * Math.cos(na), y: cy + R * Math.sin(ca) + r * Math.sin(na) };
  });
}

export function buildInvestigationScene(input: { entities: EntityRecord[]; evidence: EvidenceRecord[]; findings: Finding[] }): InvestigationScene {
  const byId = new Map(input.entities.map((e) => [e.id, e]));
  const byKey = new Map(input.entities.map((e) => [`${e.type} ${e.value}`, e.id]));

  // Node set = entities referenced by the ledger.
  const ids = new Set<string>();
  for (const ev of input.evidence) { if (byId.has(ev.inputEntityId)) ids.add(ev.inputEntityId); for (const p of ev.producedEntityIds) if (byId.has(p)) ids.add(p); }

  // Edges: resolved relations + co-occurrence, both deduped by a stable key.
  const edgeMap = new Map<string, InvEdge>();
  const add = (source: string, target: string, relation: string, kind: InvEdge['kind']): void => {
    if (source === target || !ids.has(source) || !ids.has(target)) return;
    const [a, b] = [source, target].sort();
    edgeMap.set(`${a} ${b} ${relation} ${kind}`, { source, target, relation, kind });
  };
  for (const ev of input.evidence) {
    for (const e of ev.producedEdges) {
      const s = byKey.get(`${e.fromType} ${e.fromValue}`); const t = byKey.get(`${e.toType} ${e.toValue}`);
      if (s && t) add(s, t, e.relation, 'relation');
    }
    const present = ev.producedEntityIds.filter((p) => ids.has(p)).sort();
    for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) add(present[i], present[j], 'co-occurs', 'cooccurrence');
  }
  const edges = [...edgeMap.values()].sort((x, y) => (x.source + x.target + x.relation).localeCompare(y.source + y.target + y.relation));

  // Clusters over all edges.
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  for (const e of edges) { adj.get(e.source)!.add(e.target); adj.get(e.target)!.add(e.source); }
  const comp = components([...ids], adj);

  // Score = max band of findings whose evidence touches the node.
  const evTouch = new Map<string, string[]>(); // entityId → evidenceIds
  for (const ev of input.evidence) for (const p of [ev.inputEntityId, ...ev.producedEntityIds]) if (ids.has(p)) (evTouch.get(p) ?? evTouch.set(p, []).get(p)!).push(ev.id);
  const findingByEv = new Map<string, number>(); // evidenceId → best band score
  for (const f of input.findings) { const v = BAND_SCORE[f.confidence.band]; for (const eid of f.evidenceIds) findingByEv.set(eid, Math.max(findingByEv.get(eid) ?? 0, v)); }
  const scoreOf = (id: string): number => { let best = 0.3; for (const eid of evTouch.get(id) ?? []) best = Math.max(best, findingByEv.get(eid) ?? 0); return best; };

  const bare = [...ids].sort().map((id) => ({ id, type: byId.get(id)!.type as EntityType, value: byId.get(id)!.value, cluster: comp.get(id) ?? 0, score: scoreOf(id) }));
  return { nodes: layoutScene(bare), edges };
}
