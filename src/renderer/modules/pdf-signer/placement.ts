/**
 * Pure placement coordinate helpers for the PDF Signer's draggable/resizable signature overlay.
 * Kept free of React/DOM so the drag/resize math is unit-tested in isolation.
 *
 * `toNormalized` converts a screen-space rect (px, relative to the rendered page canvas — same
 * space `getBoundingClientRect()` reports in, see SignaturePad's `scaleToBitmap`) into the
 * fractional `Placement` shape `signPdf`/`pdfsign:sign` expect (top-left anchored fractions of
 * the canvas width/height, matching `sign.ts`'s `xFrac*W` / `H*(1-yFrac)-h` convention).
 * Dragging past an edge clamps into [0,1] rather than throwing — the overlay just stops moving.
 *
 * `fromNormalized` is the inverse, for rendering the overlay `<img>` back onto the canvas: it
 * derives pixel left/top/width from the stored fractions. Height is left to the caller (the
 * `<img>`'s natural aspect ratio, or `width * naturalHeight/naturalWidth`) — this module never
 * needs to know the signature bitmap's dimensions, so resizing always preserves aspect.
 */

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NormalizedPlacement {
  xFrac: number;
  yFrac: number;
  wFrac: number;
}

export interface PixelPlacement {
  left: number;
  top: number;
  width: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Screen-space rect (px, relative to the canvas) → fractions of canvas W/H, clamped to [0,1].
 *  wFrac is clamped to (0,1]: never zero/negative width, never wider than the canvas. */
export function toNormalized(rect: ScreenRect, canvasW: number, canvasH: number): NormalizedPlacement {
  const xFrac = clamp01(rect.left / canvasW);
  const yFrac = clamp01(rect.top / canvasH);
  const wFracRaw = rect.width / canvasW;
  const wFrac = Math.min(1, Math.max(Number.EPSILON, wFracRaw));
  return { xFrac, yFrac, wFrac };
}

/** Fractions of canvas W/H → screen-space left/top/width (px), for rendering the overlay. */
export function fromNormalized(p: NormalizedPlacement, canvasW: number, canvasH: number): PixelPlacement {
  return { left: p.xFrac * canvasW, top: p.yFrac * canvasH, width: p.wFrac * canvasW };
}
