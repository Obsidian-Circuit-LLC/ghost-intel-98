/**
 * Themed dialog host. Mounted once at the App root; pops modal 98-windows
 * for any alert/confirm/prompt call via useDialogs.
 */

import { useEffect, useRef, useState } from 'react';
import { useDialogs } from '../state/dialogs';

export function DialogHost(): JSX.Element | null {
  const queue = useDialogs((s) => s.queue);
  const resolveTop = useDialogs((s) => s.resolveTop);
  const top = queue[0];
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(top?.defaultValue ?? '');
    if (top?.kind === 'prompt') {
      // Focus the input on next paint
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [top?.id, top?.defaultValue, top?.kind]);

  useEffect(() => {
    if (!top) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!top) return;
        resolveTop(top.kind === 'alert' ? null : top.kind === 'confirm' ? false : null);
      }
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (!top) return;
        resolveTop(top.kind === 'alert' ? null : top.kind === 'confirm' ? true : value);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [top, resolveTop, value]);

  if (!top) return null;

  return (
    <div className="ga98-dialog-veil" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window ga98-dialog-window" role="dialog" aria-modal="true" aria-labelledby={`${top.id}-title`}>
        <div className="title-bar">
          <div className="title-bar-text" id={`${top.id}-title`}>{top.title}</div>
        </div>
        <div className="window-body" style={{ padding: 12 }}>
          <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{top.message}</p>
          {top.kind === 'prompt' && (
            <input
              ref={inputRef}
              className="ga98-text"
              style={{ width: '100%' }}
              value={value}
              placeholder={top.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
            {top.kind !== 'alert' && (
              <button onClick={() => resolveTop(top.kind === 'confirm' ? false : null)}>
                {top.cancelLabel ?? 'Cancel'}
              </button>
            )}
            <button
              onClick={() => resolveTop(top.kind === 'alert' ? null : top.kind === 'confirm' ? true : value)}
              autoFocus={top.kind !== 'prompt'}
            >
              {top.okLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
