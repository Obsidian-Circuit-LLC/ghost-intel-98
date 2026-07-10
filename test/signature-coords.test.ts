import { describe, it, expect } from 'vitest';
import { scaleToBitmap } from '../src/renderer/modules/invoices/SignaturePad';

// Root-cause regression: the sig canvas is CSS-stretched (flex) wider than its 280x80 drawing bitmap,
// so pointer coords must be scaled display->bitmap or strokes land off-canvas (invisible).
describe('scaleToBitmap (signature canvas display->bitmap)', () => {
  it('maps a display-center point to the bitmap center when the canvas is stretched 2x', () => {
    const rect = { left: 0, top: 0, width: 560, height: 160 }; // displayed 2x the 280x80 bitmap
    expect(scaleToBitmap(280, 80, rect, 280, 80)).toEqual({ x: 140, y: 40 });
  });
  it('is identity when display size equals the bitmap size', () => {
    const rect = { left: 0, top: 0, width: 280, height: 80 };
    expect(scaleToBitmap(140, 40, rect, 280, 80)).toEqual({ x: 140, y: 40 });
  });
  it('subtracts the element offset before scaling', () => {
    const rect = { left: 100, top: 50, width: 280, height: 80 };
    expect(scaleToBitmap(240, 90, rect, 280, 80)).toEqual({ x: 140, y: 40 });
  });
  it('never divides by zero on a zero-size rect', () => {
    expect(scaleToBitmap(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 280, 80)).toEqual({ x: 10, y: 10 });
  });
});
