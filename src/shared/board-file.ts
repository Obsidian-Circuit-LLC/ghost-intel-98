import type { WhiteboardNode, WhiteboardEdge } from './types';

export interface BoardFile {
  version: 1;
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
  /** on-disk attachment fileName → base64 of the (decrypted) image bytes, so the board is self-contained. */
  assets: Record<string, string>;
}
