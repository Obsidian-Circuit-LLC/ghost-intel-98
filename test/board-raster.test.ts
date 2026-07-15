import { describe, it, expect, vi } from 'vitest';
import { boardBounds, fitScale, drawBoard } from '../src/renderer/modules/whiteboard/board-raster';
const nodes = [
  { id: 'a', type: 'text' as const, x: 0, y: 0, w: 100, h: 60, text: 'hi', name: 'A' },
  { id: 'b', type: 'image' as const, x: 200, y: 100, w: 120, h: 90, fileName: 'p.png', name: 'B' }
];
const edges = [{ id: 'e', from: 'a', to: 'b' }];
describe('board raster', () => {
  it('boardBounds spans all nodes', () => {
    expect(boardBounds(nodes)).toEqual({ minX: 0, minY: 0, maxX: 320, maxY: 190 });
  });
  it('boardBounds defaults for an empty board', () => {
    expect(boardBounds([])).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
  });
  it('fitScale never upscales + caps to max', () => {
    expect(fitScale(4000, 100, 2000)).toBeCloseTo(0.5);
    expect(fitScale(100, 100, 2000)).toBe(1);
  });
  it('drawBoard strokes an edge line, fills node bodies + a header, draws text and an image', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, p: string) => {
      if (p === 'canvas') return { width: 0, height: 0 };
      return (...a: unknown[]) => { calls.push(p + (p === 'fillText' ? ':' + a[0] : '')); };
    } }) as unknown as CanvasRenderingContext2D;
    const img = { width: 10, height: 10 } as unknown as HTMLImageElement;
    drawBoard(ctx, nodes, edges, { 'p.png': img });
    expect(calls).toContain('moveTo'); expect(calls).toContain('lineTo'); expect(calls).toContain('stroke'); // edge
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThanOrEqual(2);                          // node bodies + headers
    expect(calls).toContain('fillText:A');                                                                   // node A label
    expect(calls).toContain('drawImage');                                                                    // image node
  });
});
