/**
 * Rasterise a per-case Whiteboard to a PNG, renderer-side, from the same node/edge coords the
 * canvas already lays out. Pure geometry + a pure `drawBoard` (unit-testable against a stub ctx),
 * plus a thin `boardToPng` glue that loads attachment bytes, sizes a real canvas and reads back a
 * data URL. Kept free of the report/DOMPurify path — the appendix escaping lives in main.
 */

import type { WhiteboardNode, WhiteboardEdge } from '../../../shared/types';
import { resolveNodeColor, headerLabel } from './node-visual';
import { loadAttachmentBytes } from '../../lib/attachmentBytes';

const HEADER_H = 18;
const EMPTY_BOUNDS = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Tight bounding box over every node's rect; an empty board falls back to a sensible page. */
export function boardBounds(nodes: WhiteboardNode[]): BoardBounds {
  if (nodes.length === 0) return { ...EMPTY_BOUNDS };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  return { minX, minY, maxX, maxY };
}

/** Scale a board of size w×h to fit `max` on its longest side. Never upscales (caps at 1). */
export function fitScale(w: number, h: number, max: number): number {
  return Math.min(1, max / Math.max(w, h));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(/\s+/);
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    const measured = ctx.measureText(test);
    if (measured && measured.width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

/**
 * Pure draw of the whole board into `ctx` (already scaled/positioned by the caller). Translates so
 * the top-left of the padded bounds maps to (0,0). Returns the padded content size so the caller can
 * size the canvas. Does not read ctx state back, so it works against a stubbed 2D context.
 */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  nodes: WhiteboardNode[],
  edges: WhiteboardEdge[],
  images: Record<string, HTMLImageElement | undefined>,
  pad = 24
): { width: number; height: number } {
  const b = boardBounds(nodes);
  const width = b.maxX - b.minX + pad * 2;
  const height = b.maxY - b.minY + pad * 2;

  ctx.save();
  ctx.translate(-(b.minX - pad), -(b.minY - pad));

  // Background over the whole padded bounds.
  ctx.fillStyle = '#cfd8dc';
  ctx.fillRect(b.minX - pad, b.minY - pad, width, height);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Edges first, so node tiles sit on top.
  ctx.strokeStyle = '#37474f';
  ctx.lineWidth = 2;
  for (const e of edges) {
    const a = byId.get(e.from);
    const c = byId.get(e.to);
    if (!a || !c) continue;
    ctx.beginPath();
    ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2);
    ctx.lineTo(c.x + c.w / 2, c.y + c.h / 2);
    ctx.stroke();
  }

  ctx.textBaseline = 'top';
  for (const n of nodes) {
    const color = resolveNodeColor(n.color);
    // Body.
    ctx.fillStyle = color.body;
    ctx.fillRect(n.x, n.y, n.w, n.h);
    // Header bar + label.
    ctx.fillStyle = color.head;
    ctx.fillRect(n.x, n.y, n.w, HEADER_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.fillText(headerLabel(n), n.x + 4, n.y + 3);

    const bodyX = n.x + 4;
    const bodyY = n.y + HEADER_H + 4;
    const bodyW = n.w - 8;
    ctx.fillStyle = '#263238';
    ctx.font = '12px sans-serif';
    if (n.type === 'image' || n.type === 'file') {
      const img = n.fileName ? images[n.fileName] : undefined;
      if (img) {
        ctx.drawImage(img, n.x, n.y + HEADER_H, n.w, n.h - HEADER_H);
      } else {
        ctx.fillText(n.type === 'image' ? '[image]' : '[file]', bodyX, bodyY);
      }
    } else if (n.type === 'link') {
      wrapText(ctx, n.url ?? '', bodyX, bodyY, bodyW, 14);
    } else {
      wrapText(ctx, n.text ?? '', bodyX, bodyY, bodyW, 14);
    }
  }

  ctx.restore();
  return { width, height };
}

async function loadImage(caseId: string, fileName: string): Promise<HTMLImageElement | undefined> {
  try {
    const bytes = await loadAttachmentBytes(caseId, fileName);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return undefined;
  }
}

/**
 * Glue: load every referenced image attachment, draw the board onto a real canvas sized to the
 * (fit-scaled) bounds, and return a PNG data URL. Non-image attachments and failed loads render as
 * a placeholder rather than aborting the snapshot.
 */
export async function boardToPng(nodes: WhiteboardNode[], edges: WhiteboardEdge[], caseId: string): Promise<string> {
  const images: Record<string, HTMLImageElement | undefined> = {};
  for (const n of nodes) {
    if (n.type === 'image' && n.fileName && !(n.fileName in images)) {
      images[n.fileName] = await loadImage(caseId, n.fileName);
    }
  }

  const b = boardBounds(nodes);
  const pad = 24;
  const contentW = b.maxX - b.minX + pad * 2;
  const contentH = b.maxY - b.minY + pad * 2;
  const scale = fitScale(contentW, contentH, 2000);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(contentW * scale));
  canvas.height = Math.max(1, Math.round(contentH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');
  ctx.scale(scale, scale);
  drawBoard(ctx, nodes, edges, images, pad);
  return canvas.toDataURL('image/png');
}
