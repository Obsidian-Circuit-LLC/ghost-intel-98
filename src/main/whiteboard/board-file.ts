import type { Whiteboard, WhiteboardNode } from '../../shared/types';
import type { BoardFile } from '../../shared/board-file';

/** Bundle a board + ONLY the assets its image/file nodes reference (drop orphans). Pure. */
export function buildBoardFile(board: Whiteboard, assets: Record<string, string>): BoardFile {
  const refs = new Set(board.nodes.map((n) => n.fileName).filter((f): f is string => !!f));
  const kept: Record<string, string> = {};
  for (const [name, b64] of Object.entries(assets)) if (refs.has(name)) kept[name] = b64;
  return { version: 1, nodes: board.nodes, edges: board.edges, assets: kept };
}

/**
 * On import, each embedded asset is written into the target case as a fresh (dedup-safe) attachment,
 * yielding a `board fileName → new vault fileName` map. Rewrite each node's `fileName` to the name the
 * asset actually landed under so image/file nodes resolve. Nodes whose asset was dropped (oversize /
 * unreferenced / failed to write) keep their original name and simply render as a missing-asset
 * placeholder. Pure. Never mutates the input.
 */
export function remapBoardAssetNames(nodes: WhiteboardNode[], rename: Record<string, string>): WhiteboardNode[] {
  return nodes.map((n) => (n.fileName && rename[n.fileName] ? { ...n, fileName: rename[n.fileName] } : n));
}
