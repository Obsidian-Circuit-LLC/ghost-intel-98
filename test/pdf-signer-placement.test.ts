/**
 * T5: pure placement coordinate helpers for the PDF Signer's draggable/resizable signature
 * overlay. `toNormalized` converts a screen-space rect (px, relative to the rendered page
 * canvas) into the fractional placement `signPdf`/`pdfsign:sign` expect (`xFrac/yFrac/wFrac`,
 * top-left anchored, clamped to [0,1]); `fromNormalized` is its inverse for rendering the
 * overlay `<img>` back onto the canvas. No DOM — canvas width/height are passed in as plain
 * numbers so this is testable without jsdom.
 */
import { describe, it, expect } from 'vitest';
import { toNormalized, fromNormalized } from '../src/renderer/modules/pdf-signer/placement';

describe('placement helpers', () => {
  it('toNormalized converts a screen-space rect to fractions of the canvas', () => {
    const canvasW = 1000;
    const canvasH = 1000;
    const rect = { left: canvasW / 2, top: canvasH / 10, width: canvasW / 5, height: 40 };
    expect(toNormalized(rect, canvasW, canvasH)).toEqual({ xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 });
  });

  it('fromNormalized(toNormalized(r)) round-trips left/top/width', () => {
    const canvasW = 800;
    const canvasH = 600;
    const rect = { left: 200, top: 60, width: 160, height: 30 };
    const p = toNormalized(rect, canvasW, canvasH);
    const back = fromNormalized(p, canvasW, canvasH);
    expect(back).toEqual({ left: rect.left, top: rect.top, width: rect.width });
  });

  it('clamps a rect dragged past the top/left edge into [0,1]', () => {
    const canvasW = 1000;
    const canvasH = 1000;
    const rect = { left: -300, top: -50, width: 200, height: 40 };
    const p = toNormalized(rect, canvasW, canvasH);
    expect(p.xFrac).toBe(0);
    expect(p.yFrac).toBe(0);
    expect(p.wFrac).toBe(0.2);
  });

  it('clamps a rect dragged past the bottom/right edge into [0,1]', () => {
    const canvasW = 1000;
    const canvasH = 1000;
    const rect = { left: 1200, top: 1100, width: 200, height: 40 };
    const p = toNormalized(rect, canvasW, canvasH);
    expect(p.xFrac).toBe(1);
    expect(p.yFrac).toBe(1);
  });

  it('clamps wFrac into (0,1] — never zero/negative width, never wider than the canvas', () => {
    const canvasW = 1000;
    const canvasH = 1000;
    expect(toNormalized({ left: 0, top: 0, width: 5000, height: 40 }, canvasW, canvasH).wFrac).toBe(1);
    expect(toNormalized({ left: 0, top: 0, width: -50, height: 40 }, canvasW, canvasH).wFrac).toBeGreaterThan(0);
  });

  it('fromNormalized keeps the signature aspect via caller-supplied height, deriving width from wFrac', () => {
    const canvasW = 800;
    const canvasH = 600;
    const p = { xFrac: 0.25, yFrac: 0.25, wFrac: 0.5 };
    const { left, top, width } = fromNormalized(p, canvasW, canvasH);
    expect(left).toBe(200);
    expect(top).toBe(150);
    expect(width).toBe(400);
  });
});
