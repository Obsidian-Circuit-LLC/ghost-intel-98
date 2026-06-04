/**
 * Global keyboard shortcuts handler. Mounted once at App root, attaches a single
 * keydown listener and dispatches based on the focused window's module + key combo.
 *
 *  Ctrl/Cmd+N         — New (cases module: new case; notepad: new note)
 *  Ctrl/Cmd+S         — Save (notepad)
 *  Ctrl/Cmd+W         — Close active window
 *  Ctrl/Cmd+Tab       — Cycle focus through open windows
 *  F1                 — Open Settings
 *  Esc                — Defer to module / dialog
 *
 * Modules listen by checking `window.__ga98Shortcut` in their own keydown OR by
 * using the shortcut bus (a simple EventTarget).
 */

import { useEffect } from 'react';
import { useWindows } from '../state/store';
import { useDialogs } from '../state/dialogs';

export const shortcutBus = new EventTarget();

export interface ShortcutEventDetail {
  action: 'save' | 'new';
  moduleKey: string;
}

export function Shortcuts(): JSX.Element {
  const focusStack = useWindows((s) => s.focusStack);
  const windows = useWindows((s) => s.windows);
  const close = useWindows((s) => s.close);
  const focus = useWindows((s) => s.focus);
  const open = useWindows((s) => s.open);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const cmd = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const isTextInput = target && /^(INPUT|TEXTAREA)$/i.test(target.tagName) && !(target as HTMLInputElement).readOnly;
      const activeId = focusStack[focusStack.length - 1];
      const activeWin = windows.find((w) => w.id === activeId);

      // Dialog open? Dialog host owns Esc/Enter. Don't double-handle.
      if (useDialogs.getState().queue.length > 0) return;

      // Ctrl/Cmd+W — close active window
      if (cmd && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeId) close(activeId);
        return;
      }
      // Ctrl/Cmd+Tab — cycle windows
      if (cmd && e.key === 'Tab') {
        e.preventDefault();
        if (focusStack.length < 2) return;
        const idx = focusStack.length - 1;
        const next = e.shiftKey ? focusStack[(idx - 1 + focusStack.length) % focusStack.length] : focusStack[0];
        focus(next);
        return;
      }
      // F1 — open Settings
      if (e.key === 'F1') {
        e.preventDefault();
        open({ module: 'settings', title: 'Settings' });
        return;
      }
      // Ctrl/Cmd+N — new (dispatch via bus to the active module if it claims the shortcut)
      if (cmd && e.key.toLowerCase() === 'n' && !isTextInput) {
        e.preventDefault();
        if (activeWin) {
          shortcutBus.dispatchEvent(new CustomEvent<ShortcutEventDetail>('shortcut', { detail: { action: 'new', moduleKey: activeWin.module } }));
        } else {
          quickNewCase(open);
        }
        return;
      }
      // Ctrl/Cmd+S — save (notepad)
      if (cmd && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeWin) {
          shortcutBus.dispatchEvent(new CustomEvent<ShortcutEventDetail>('shortcut', { detail: { action: 'save', moduleKey: activeWin.module } }));
        }
        return;
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusStack, windows, close, focus, open]);

  return <></>;
}

type OpenFn = (spec: Parameters<ReturnType<typeof useWindows.getState>['open']>[0]) => string;

function quickNewCase(open: OpenFn): void {
  open({ module: 'cases', title: 'My Cases' });
  setTimeout(() => {
    shortcutBus.dispatchEvent(new CustomEvent<ShortcutEventDetail>('shortcut', { detail: { action: 'new', moduleKey: 'cases' } }));
  }, 50);
}
