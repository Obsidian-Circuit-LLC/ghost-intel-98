/**
 * Assembles the Mind's Eye graph — load every shard + the full adaptive-memory profile, turn them
 * into nodes (`buildNodes`), derive similarity auto-edges (`autoEdges`), then lay them out
 * deterministically (`layout`). This is the one seam the `memory:graph` IPC channel calls.
 */
import { loadAllShards } from '../store';
import { profileList } from '../profile';
import { buildNodes } from './build';
import { detectConflicts } from './merge';
import { autoEdges } from './edges';
import { layout } from './layout';
import type { MemoryGraph } from './model';

export async function buildGraph(): Promise<MemoryGraph> {
  const [shards, profile] = await Promise.all([loadAllShards(), profileList()]);
  // Computed once here (not re-derived from `conflict`-flagged nodes) so the "one thing to fix"
  // tray gets an actual conflicting pair rather than guessing from node iteration order.
  const conflictPairs = detectConflicts(profile);
  const nodes = layout(buildNodes({ shards, profile, conflictPairs }));
  const edges = autoEdges(nodes);
  return { nodes, edges, conflictPairs };
}
