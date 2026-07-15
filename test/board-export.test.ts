import { describe, it, expect } from 'vitest';
import { boardAppendixHtml, boardPdfHtml } from '../src/main/whiteboard/board-export';

const nodes = [
  { id: 'a', type: 'text' as const, x: 0, y: 0, w: 1, h: 1, name: 'Suspect', text: '<script>x</script> notes' },
  { id: 'b', type: 'file' as const, x: 0, y: 0, w: 1, h: 1, text: 'rap.pdf' }
];
const edges = [{ id: 'e', from: 'a', to: 'b' }];

describe('board export', () => {
  it('appendix escapes node text + lists connections by label', () => {
    const h = boardAppendixHtml(nodes, edges);
    expect(h).toContain('Suspect');
    expect(h).not.toContain('<script>'); // escaped
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('Suspect'); expect(h).toContain('rap.pdf');
    expect(h).toMatch(/Suspect.*(→|-&gt;).*rap\.pdf/s); // connection A → B by label
  });

  it('boardPdfHtml embeds the snapshot png then the appendix', () => {
    const h = boardPdfHtml('data:image/png;base64,AAAA', nodes, edges);
    expect(h).toContain('data:image/png;base64,AAAA');
    expect(h.indexOf('AAAA')).toBeLessThan(h.indexOf('Suspect')); // snapshot first
  });
});
