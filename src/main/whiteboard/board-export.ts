/**
 * Whiteboard → PDF: a plain-text node/edge appendix (rendered after the visual snapshot) plus the
 * htmlToPdf render path shared with the case-summary exporter. Node text is untrusted user input
 * (free-form annotations, URLs, file captions) so every value crosses an HTML-escape boundary
 * before it is interpolated — this file, not the report generator, owns that boundary for board
 * exports; do not rely on DOMPurify here (the main process has no DOM).
 */
import type { WhiteboardNode, WhiteboardEdge } from '../../shared/types';
import { htmlToPdf } from '../services/export';

/** HTML-escape untrusted text before interpolation into element content or a quoted attribute. */
export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// Connections identify nodes by their most human-readable content: an explicit name first,
// then the node's own text/url (e.g. a file node's caption), falling back to its bare type only
// when nothing else identifies it.
function nodeLabel(n: WhiteboardNode): string {
  return n.name || n.text || n.url || n.type;
}

function nodeBody(n: WhiteboardNode): string {
  return n.text || n.url || '';
}

/** Plain node/edge appendix: node name+type+body, then a connections list by resolved label. */
export function boardAppendixHtml(nodes: WhiteboardNode[], edges: WhiteboardEdge[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeItems = nodes
    .map((n) => `<p><b>${escapeHtml(nodeLabel(n))}</b> (${escapeHtml(n.type)}): ${escapeHtml(nodeBody(n))}</p>`)
    .join('');
  const edgeItems = edges
    .map((e) => {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to) return ''; // dangling edge — skip
      return `<p>${escapeHtml(nodeLabel(from))} → ${escapeHtml(nodeLabel(to))}</p>`;
    })
    .filter(Boolean)
    .join('');
  return `<h2>Nodes</h2>${nodeItems}<h2>Connections</h2>${edgeItems}`;
}

/** Full export document: the rasterized board snapshot first, then the plain-text appendix. */
export function boardPdfHtml(pngDataUrl: string, nodes: WhiteboardNode[], edges: WhiteboardEdge[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Whiteboard export</title>
<style>body{font-family:sans-serif;margin:2em}img{max-width:100%}h2{margin-top:1.5em}</style>
</head><body>
<img src="${pngDataUrl}" alt="Whiteboard snapshot">
${boardAppendixHtml(nodes, edges)}
</body></html>`;
}

/** Render the board (snapshot + appendix) to a PDF Buffer via the shared offline PDF path. */
export async function boardToPdf(
  pngDataUrl: string,
  nodes: WhiteboardNode[],
  edges: WhiteboardEdge[]
): Promise<Buffer> {
  return htmlToPdf(boardPdfHtml(pngDataUrl, nodes, edges));
}
