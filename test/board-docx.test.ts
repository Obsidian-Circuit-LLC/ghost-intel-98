import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { renderBoardDocx } from '../src/main/whiteboard/board-docx';
// a 1x1 png
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const nodes = [{ id: 'a', type: 'text' as const, x: 0, y: 0, w: 1, h: 1, name: 'Suspect', text: 'notes' }];
describe('board docx', () => {
  it('produces a valid docx zip with the snapshot media part + the appendix text', () => {
    const buf = renderBoardDocx(PNG, nodes, []);
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('word/document.xml');
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true); // the board snapshot image
    const doc = zip.getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('Suspect'); // appendix node
    expect(doc).toContain('<w:drawing'); // the inline image
  });
});
