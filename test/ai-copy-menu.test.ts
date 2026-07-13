import { describe, it, expect } from 'vitest';
import { buildCopyMenu } from '../src/renderer/modules/ai-assistant/copy-menu';

// GhostExodus bug: right-click "copy a highlighted section" in Q copied the whole conversation, because
// the custom context menu (which suppresses the native selection-copy) only offered Copy message / Copy
// whole conversation. The fix adds a "Copy selection" item that copies exactly the highlight.
describe('buildCopyMenu', () => {
  it('offers "Copy selection" FIRST when text is highlighted, copying the selection verbatim', () => {
    const items = buildCopyMenu('a highlighted bit', 'the full message', 'the whole conversation');
    expect(items.map((i) => i.label)).toEqual(['Copy selection', 'Copy message', 'Copy whole conversation']);
    expect(items[0]).toEqual({ label: 'Copy selection', text: 'a highlighted bit' });
  });

  it('omits "Copy selection" when nothing is highlighted (empty or whitespace-only)', () => {
    expect(buildCopyMenu('', 'm', 'c').map((i) => i.label)).toEqual(['Copy message', 'Copy whole conversation']);
    expect(buildCopyMenu('   \n\t ', 'm', 'c').map((i) => i.label)).toEqual(['Copy message', 'Copy whole conversation']);
  });

  it('does NOT trim the copied selection text (copies exactly what was selected)', () => {
    const items = buildCopyMenu('  spaced selection  ', 'm', 'c');
    expect(items[0].text).toBe('  spaced selection  ');
  });

  it('the message / conversation items copy their bodies verbatim', () => {
    const items = buildCopyMenu('', 'MSG-BODY', 'CONV-BODY');
    expect(items.find((i) => i.label === 'Copy message')!.text).toBe('MSG-BODY');
    expect(items.find((i) => i.label === 'Copy whole conversation')!.text).toBe('CONV-BODY');
  });
});
