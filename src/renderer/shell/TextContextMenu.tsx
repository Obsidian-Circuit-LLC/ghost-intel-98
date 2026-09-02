/**
 * Right-click Cut / Copy / Paste / Select All on any text field.
 *
 * Electron gives editable fields no native context menu, so right-clicking an input did nothing at
 * all — conspicuously un-Windows-98 in an app built to feel like Windows 98 (GhostExodus's
 * request). Mounted once by App; it listens on the document and yields to anything that has already
 * handled the event, so the case manager's own Copy-link / Copy-entity menus keep working.
 *
 * Clipboard access goes through `navigator.clipboard` where possible — `document.execCommand('paste')`
 * is unreliable in current Chromium — and falls back to execCommand, which the Reports menu bar has
 * used successfully for its Edit actions. Both paths are best-effort: a refused clipboard closes the
 * menu quietly rather than throwing into the shell.
 *
 * Password fields never offer Cut or Copy; see text-menu.ts for why.
 */
import { useEffect, useState, type JSX } from 'react';
import { readTextTarget, textMenuItems, type TextMenuAction, type TextTargetState } from './text-menu';

interface MenuState {
  x: number;
  y: number;
  target: HTMLElement;
  state: TextTargetState;
}

/** Insert `text` at the caret of an input/textarea, preserving undo where the browser allows it. */
function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.setRangeText(text, start, end, 'end');
  // React tracks value internally; dispatching input keeps controlled components in step.
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function runAction(action: TextMenuAction, target: HTMLElement): Promise<void> {
  const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
  target.focus();

  if (action === 'selectAll') {
    if (field) field.select();
    else document.execCommand('selectAll');
    return;
  }

  if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (field) insertIntoField(field, text);
      else document.execCommand('insertText', false, text);
    } catch {
      // Clipboard read refused — fall back to the path the Reports Edit menu uses.
      try { document.execCommand('paste'); } catch { /* nothing further to try */ }
    }
    return;
  }

  // Cut / Copy: execCommand still handles the selection correctly in both fields and
  // contentEditable, and needs no clipboard-read permission.
  try {
    document.execCommand(action);
  } catch {
    /* best effort */
  }
}

export function TextContextMenu(): JSX.Element | null {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    function onContextMenu(e: MouseEvent): void {
      // Something already handled this right-click (the case manager's copy menus, for example).
      if (e.defaultPrevented) return;
      const state = readTextTarget(e.target as Element | null);
      if (!state) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, target: e.target as HTMLElement, state });
    }
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      className="ga98-text-context-menu"
      role="menu"
      // Kept inside the viewport: a right-click near the right or bottom edge would otherwise open
      // a menu partly off screen.
      style={{
        left: Math.min(menu.x, Math.max(0, window.innerWidth - 150)),
        top: Math.min(menu.y, Math.max(0, window.innerHeight - 108)),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {textMenuItems(menu.state).map((item) => (
        <div
          key={item.action}
          role="menuitem"
          aria-disabled={!item.enabled}
          className={`ga98-text-context-item${item.enabled ? '' : ' is-disabled'}`}
          onClick={() => {
            if (!item.enabled) return;
            void runAction(item.action, menu.target);
            setMenu(null);
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
