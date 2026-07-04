/**
 * Assembles the Mind's Eye graph — load every shard + the full adaptive-memory profile, turn them
 * into nodes (`buildNodes`), derive similarity auto-edges (`autoEdges`), then lay them out
 * deterministically (`layout`). This is the one seam the `memory:graph` IPC channel calls.
 */
import { loadAllShards } from '../store';
import { profileList } from '../profile';
import { buildNodes } from './build';
import { autoEdges } from './edges';
import { layout } from './layout';
import type { MemoryGraph } from './model';

export async function buildGraph(): Promise<MemoryGraph> {
  const [shards, profile] = await Promise.all([loadAllShards(), profileList()]);
  const nodes = layout(buildNodes({ shards, profile }));
  const edges = autoEdges(nodes);
  return { nodes, edges };
}
