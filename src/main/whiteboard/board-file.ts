import type { Whiteboard } from '../../shared/types';
import type { BoardFile } from '../../shared/board-file';

/** Bundle a board + ONLY the assets its image/file nodes reference (drop orphans). Pure. */
export function buildBoardFile(board: Whiteboard, assets: Record<string, string>): BoardFile {
  const refs = new Set(board.nodes.map((n) => n.fileName).filter((f): f is string => !!f));
  const kept: Record<string, string> = {};
  for (const [name, b64] of Object.entries(assets)) if (refs.has(name)) kept[name] = b64;
  return { version: 1, nodes: board.nodes, edges: board.edges, assets: kept };
}
