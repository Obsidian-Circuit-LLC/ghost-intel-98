/**
 * Toast surface. Sits above the taskbar (bottom-right). Each toast is a
 * tiny 98-style notification balloon; click to dismiss, auto-dismisses on TTL.
 */

import { useToasts, type ToastKind } from '../state/toasts';

const GLYPH: Record<ToastKind, string> = {
  info: 'ℹ',
  success: '✓',
  warn: '⚠',
  error: '✕'
};

// The toast title-bar is a FILLED status background carrying 98.css's WHITE title text, so it uses
// the LOCKED status FILL role (dark enough for >=4.5:1 white contrast in BOTH themes) — not the
// FOREGROUND status token, whose amethyst values are bright and would fail white-on-colour. LOCKED:
// theme-aware but never recoloured or hidden by a user skin.
const COLOR: Record<ToastKind, string> = {
  info: 'var(--ga98-status-info-fill)',
  success: 'var(--ga98-status-success-fill)',
  warn: 'var(--ga98-status-warning-fill)',
  error: 'var(--ga98-status-error-fill)'
};

export function Toaster(): JSX.Element {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  if (items.length === 0) return <div className="ga98-toaster" />;
  return (
    <div className="ga98-toaster">
      {items.map((t) => (
        <div
          key={t.id}
          className="ga98-toast window"
          role="status"
          onClick={() => dismiss(t.id)}
        >
          <div className="title-bar" style={{ background: COLOR[t.kind] }}>
            <div className="title-bar-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true">{GLYPH[t.kind]}</span>
              <span>{toastTitle(t.kind)}</span>
            </div>
            <div className="title-bar-controls">
              <button aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }} />
            </div>
          </div>
          <div className="window-body" style={{ padding: '6px 8px', fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {t.message}
          </div>
        </div>
      ))}
    </div>
  );
}

function toastTitle(kind: ToastKind): string {
  switch (kind) {
    case 'info': return 'Information';
    case 'success': return 'Success';
    case 'warn': return 'Warning';
    case 'error': return 'Error';
  }
}
