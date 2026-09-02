/**
 * What a right-click on a text field should offer.
 *
 * Electron gives editable fields NO native context menu, so right-clicking an input in this app
 * did nothing at all — which is glaringly un-Windows-98 in an app whose whole point is feeling like
 * Windows 98. GhostExodus asked for Copy/Paste on right-click; this is the shared decision of which
 * items appear and which are greyed, kept pure so it can be tested without a DOM event.
 *
 * The enablement rules are Windows': Cut and Copy need a selection, Cut and Paste need a writable
 * field, Select All needs some content. A greyed item is deliberately still SHOWN — a menu whose
 * items appear and disappear is harder to use than one whose shape you learn once.
 */
export type TextMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll';

export interface TextMenuItem {
  action: TextMenuAction;
  label: string;
  enabled: boolean;
}

export interface TextTargetState {
  /** The field can be typed into (not readonly, not disabled, not a plain non-editable element). */
  editable: boolean;
  /** Some of the field's text is selected. */
  hasSelection: boolean;
  /** The field has any content at all. */
  hasContent: boolean;
}

/** Read the state a right-click target is in. Returns null for anything that is not a text field. */
export function readTextTarget(el: Element | null): TextTargetState | null {
  if (!el) return null;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // Only text-bearing inputs — a right-click on a checkbox or a colour swatch has no text ops.
    const textual = el instanceof HTMLTextAreaElement
      || ['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''].includes(el.type);
    if (!textual) return null;
    const value = el.value ?? '';
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    return {
      editable: !el.readOnly && !el.disabled,
      // A password field never offers Cut or Copy, whatever is selected: the master password and
      // the recovery key both live in one, and quietly making them one keystroke from the clipboard
      // is not a convenience worth adding.
      hasSelection: el.type !== 'password' && end > start,
      hasContent: value.length > 0,
    };
  }

  const editable = (el as HTMLElement).closest?.('[contenteditable=""],[contenteditable="true"]');
  if (editable) {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const text = (editable as HTMLElement).textContent ?? '';
    return {
      editable: true,
      hasSelection: !!selection && !selection.isCollapsed,
      hasContent: text.length > 0,
    };
  }

  return null;
}

/** The menu for a given target state, in Windows' order. */
export function textMenuItems(state: TextTargetState): TextMenuItem[] {
  return [
    { action: 'cut', label: 'Cut', enabled: state.editable && state.hasSelection },
    { action: 'copy', label: 'Copy', enabled: state.hasSelection },
    { action: 'paste', label: 'Paste', enabled: state.editable },
    { action: 'selectAll', label: 'Select All', enabled: state.hasContent },
  ];
}
