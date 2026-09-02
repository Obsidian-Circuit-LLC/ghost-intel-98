// @vitest-environment jsdom
/**
 * Right-click Cut/Copy/Paste on text fields (GhostExodus request).
 *
 * Electron gives editable fields no native context menu, so right-clicking an input in this app did
 * nothing — conspicuous in a tool whose whole appeal is behaving like Windows 98.
 *
 * The enablement rules are Windows': Cut/Copy need a selection, Cut/Paste need a writable field,
 * Select All needs content. One deliberate departure, and it is a security one: a PASSWORD field
 * never offers Cut or Copy. The master password and the recovery key are both typed into one, and
 * putting either a keystroke away from the clipboard — where every other app on the machine can
 * read it — is not a convenience worth having.
 */
import { describe, expect, it } from 'vitest';
import { readTextTarget, textMenuItems } from '../src/renderer/shell/text-menu';

const enabled = (state: Parameters<typeof textMenuItems>[0]) =>
  Object.fromEntries(textMenuItems(state).map((i) => [i.action, i.enabled]));

function input(attrs: Partial<HTMLInputElement> & { value?: string } = {}): HTMLInputElement {
  const el = document.createElement('input');
  Object.assign(el, { type: 'text', value: '', ...attrs });
  return el;
}

describe('readTextTarget', () => {
  it('reads a plain text input', () => {
    const el = input({ value: 'hello' });
    el.setSelectionRange(0, 2);
    expect(readTextTarget(el)).toEqual({ editable: true, hasSelection: true, hasContent: true });
  });

  it('marks a readonly field as not editable', () => {
    const el = input({ value: 'x', readOnly: true });
    expect(readTextTarget(el)?.editable).toBe(false);
  });

  it('NEVER reports a selection on a password field', () => {
    // The master password and the recovery key are typed here. Cut/Copy on them would put the key
    // to the whole vault on the system clipboard.
    const el = input({ type: 'password', value: 'hunter2' });
    el.setSelectionRange(0, 7);
    const state = readTextTarget(el)!;
    expect(state.hasSelection).toBe(false);
    expect(enabled(state)).toMatchObject({ cut: false, copy: false });
    // Paste and Select All remain — you must still be able to paste a password in from a manager.
    expect(enabled(state)).toMatchObject({ paste: true, selectAll: true });
  });

  it('ignores non-text inputs', () => {
    expect(readTextTarget(input({ type: 'checkbox' }))).toBeNull();
    expect(readTextTarget(input({ type: 'color' }))).toBeNull();
  });

  it('ignores anything that is not a field', () => {
    expect(readTextTarget(document.createElement('div'))).toBeNull();
    expect(readTextTarget(null)).toBeNull();
  });

  it('handles a contenteditable block (the report editor writes into these)', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.textContent = 'body text';
    document.body.appendChild(el);
    expect(readTextTarget(el)).toMatchObject({ editable: true, hasContent: true });
    el.remove();
  });
});

describe('textMenuItems', () => {
  it('greys Cut and Copy with no selection, and still shows them', () => {
    const items = textMenuItems({ editable: true, hasSelection: false, hasContent: true });
    expect(items.map((i) => i.action)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
    expect(enabled({ editable: true, hasSelection: false, hasContent: true }))
      .toEqual({ cut: false, copy: false, paste: true, selectAll: true });
  });

  it('greys Cut and Paste on a readonly field but allows Copy', () => {
    expect(enabled({ editable: false, hasSelection: true, hasContent: true }))
      .toEqual({ cut: false, copy: true, paste: false, selectAll: true });
  });

  it('greys Select All on an empty field', () => {
    expect(enabled({ editable: true, hasSelection: false, hasContent: false }).selectAll).toBe(false);
  });
});
