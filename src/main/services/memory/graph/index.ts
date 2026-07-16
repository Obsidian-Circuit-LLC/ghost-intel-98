/**
 * Assembles the Mind's Eye graph — load every shard + the full adaptive-memory profile, turn them
 * into nodes (`buildNodes`), derive similarity auto-edges (`autoEdges`), lay them out
 * deterministically (`layout`), then add the user-drawn retrieval bonds as bold `kind:'bond'`
 * edges so they render alongside the auto-edges. This is the one seam the `memory:graph` IPC
 * channel calls.
 */
import { loadAllShards } from '../store';
import { profileList } from '../profile';
import { buildNodes } from './build';
import { detectConflicts } from './merge';
import { autoEdges } from './edges';
import { layout } from './layout';
import { createBonds } from '../bonds';
import type { GraphEdge, MemoryGraph } from './model';

export async function buildGraph(): Promise<MemoryGraph> {
  const [shards, rawProfile] = await Promise.all([loadAllShards(), profileList()]);
  // Facts tombstoned by a Forgotten conversation stay on disk (so Remember can restore them and the
  // Memory panel can still inspect/erase them) but must NOT render as Mind's Eye nodes.
  const profile = rawProfile.filter((it) => !it.memoryExcluded);
  // Computed once here (not re-derived from `conflict`-flagged nodes) so the "one thing to fix"
  // tray gets an actual conflicting pair rather than guessing from node iteration order.
  const conflictPairs = detectConflicts(profile);
  const nodes = layout(buildNodes({ shards, profile, conflictPairs }));
  const autoEdgeList = autoEdges(nodes);

  // Bond edges are best-effort: a bond-store read failure (corrupt/locked file) must never break
  // the graph view — it just renders with auto-edges only that call.
  let bondEdges: GraphEdge[] = [];
  try {
    const bonds = await createBonds().list();
    bondEdges = bonds.map((b) => ({ source: b.a, target: b.b, kind: 'bond' as const, weight: 1 }));
  } catch { /* best-effort */ }

  return { nodes, edges: [...autoEdgeList, ...bondEdges], conflictPairs };
}

/** Drop every user-drawn bond touching `nodeId`. Called when a node is tombstoned (e.g. a
 *  forgotten conversation) so its edges don't dangle to a graph node that no longer exists —
 *  the bond write goes through the encrypted bond store (secure-fs), never a raw file write. */
export async function pruneBondsForNode(nodeId: string): Promise<void> {
  await createBonds().removeAllForNode(nodeId);
}
