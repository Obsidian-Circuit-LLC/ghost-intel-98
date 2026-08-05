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

// The toast title-bar is a FILLED background carrying 98.css's WHITE title text. It routes to a
// dedicated Task P purpose FILL token per kind: the CLASSIC value is the byte-exact original toast
// title-bar colour (classic parity is sacred), and the amethyst value is a dark fill that keeps the
// white title text legible (>=4.5:1) on the near-black skin. It deliberately does NOT use the LOCKED
// --ga98-status-*-fill tier — those classic values differ from the toast literals, so routing to
// them shifted every classic toast's title bar (the badge-ink precedent: give the site its own
// parity-exact purpose token, never bend a LOCKED token).
const COLOR: Record<ToastKind, string> = {
  info: 'var(--ga98-toast-info-fill)',
  success: 'var(--ga98-toast-success-fill)',
  warn: 'var(--ga98-toast-warn-fill)',
  error: 'var(--ga98-toast-error-fill)'
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
