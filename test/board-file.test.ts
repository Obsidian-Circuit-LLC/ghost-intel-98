import { describe, it, expect } from 'vitest';
import { buildBoardFile } from '../src/main/whiteboard/board-file';
import { ensureBoardFile } from '../src/main/security/validate';
const board = { nodes: [{ id: 'n1', type: 'image' as const, x: 0, y: 0, w: 200, h: 120, fileName: 'a.png', name: 'Photo' }], edges: [] };
describe('board file', () => {
  it('buildBoardFile embeds only referenced assets + version', () => {
    const f = buildBoardFile(board, { 'a.png': 'QUJD', 'orphan.png': 'ZZZ' });
    expect(f.version).toBe(1);
    expect(f.nodes).toHaveLength(1);
    expect(f.assets).toEqual({ 'a.png': 'QUJD' }); // orphan dropped
  });
  it('ensureBoardFile validates + bounds + round-trips a built file', () => {
    const f = ensureBoardFile(buildBoardFile(board, { 'a.png': 'QUJD' }));
    expect(f.nodes[0].name).toBe('Photo');
    expect(f.assets['a.png']).toBe('QUJD');
  });
  it('ensureBoardFile drops a giant asset + a non-string asset', () => {
    const big = 'A'.repeat(40 * 1024 * 1024); // ~30MB decoded > cap
    const f = ensureBoardFile({ version: 1, nodes: board.nodes, edges: [], assets: { 'a.png': big, 'b.png': 123 } });
    expect(f.assets['a.png']).toBeUndefined();
    expect(f.assets['b.png']).toBeUndefined();
  });
});
