import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import { remapBoardAssetNames } from '../src/main/whiteboard/board-file';
import { ensureBoardFile } from '../src/main/security/validate';
import type { WhiteboardNode } from '../src/shared/types';

// Task 5 wires the Whiteboard toolbar's Export ▾ (PDF/DOCX/board file) + Import board to four new
// IPC channels. These unit checks assert the channel surface is declared and that the two
// injection-/vault-boundary behaviours the import path depends on hold WITHOUT spinning up electron:
//  - a board file's node.fileName is remapped to the freshly-written attachment name on import, and
//  - ensureBoardFile refuses to carry an asset no node references (import can't smuggle stray bytes
//    into the vault; export writes only via the OS save dialog, never inside the encrypted store).
describe('whiteboard export/import IPC surface', () => {
  it('declares the export/import channels alongside read/write', () => {
    expect(channels.whiteboard).toEqual({
      read: 'whiteboard:read',
      write: 'whiteboard:write',
      exportPdf: 'whiteboard:exportPdf',
      exportDocx: 'whiteboard:exportDocx',
      exportFile: 'whiteboard:exportFile',
      importFile: 'whiteboard:importFile'
    });
  });

  it('import remaps a referenced node fileName to its freshly-written attachment name; leaves others', () => {
    const nodes: WhiteboardNode[] = [
      { id: 'n1', type: 'image', x: 0, y: 0, w: 200, h: 120, fileName: 'a.png', name: 'Photo' },
      { id: 'n2', type: 'text', x: 0, y: 0, w: 100, h: 60, text: 'note' }
    ];
    const remapped = remapBoardAssetNames(nodes, { 'a.png': 'a-1.png' });
    expect(remapped[0].fileName).toBe('a-1.png'); // rewritten to the deduped vault name
    expect(remapped[1].fileName).toBeUndefined(); // a non-attachment node is untouched
    // A node whose asset was dropped (no mapping) keeps its original name — the missing asset
    // simply renders as a placeholder rather than corrupting the board.
    expect(remapBoardAssetNames(nodes, {})[0].fileName).toBe('a.png');
  });

  it('ensureBoardFile drops an asset no node references (import cannot smuggle stray files into the vault)', () => {
    const nodes = [{ id: 'n1', type: 'image' as const, x: 0, y: 0, w: 200, h: 120, fileName: 'a.png' }];
    const f = ensureBoardFile({ version: 1, nodes, edges: [], assets: { 'a.png': 'QUJD', 'stray.png': 'ZZZ' } });
    expect(f.assets['a.png']).toBe('QUJD');
    expect(f.assets['stray.png']).toBeUndefined();
  });
});
