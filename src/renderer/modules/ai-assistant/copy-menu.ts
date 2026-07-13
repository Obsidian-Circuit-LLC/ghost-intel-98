/**
 * Right-click copy menu for a chat message in Q. The message's onContextMenu calls preventDefault(),
 * which suppresses the browser's native "Copy" (the one that copies the current selection) — so if the
 * user highlights a section and right-clicks, without this they can only copy the WHOLE message or the
 * WHOLE conversation (GhostExodus's bug: "the entire conversation gets copied"). This offers a
 * "Copy selection" item FIRST whenever text is highlighted, so right-click copy respects the selection
 * exactly like native Ctrl+C. Pure so the menu logic is unit-tested without rendering the module.
 */
export interface CopyMenuItem {
  label: string;
  text: string;
}

/** Build the copy menu. `selection` is the live highlighted text (window.getSelection()), `message`
 *  is the whole message body, `conversation` is the whole transcript. "Copy selection" appears only
 *  when the selection is non-blank, and copies the selection VERBATIM (no trimming of the copied text). */
export function buildCopyMenu(selection: string, message: string, conversation: string): CopyMenuItem[] {
  const items: CopyMenuItem[] = [];
  if (selection.trim() !== '') items.push({ label: 'Copy selection', text: selection });
  items.push({ label: 'Copy message', text: message });
  items.push({ label: 'Copy whole conversation', text: conversation });
  return items;
}
