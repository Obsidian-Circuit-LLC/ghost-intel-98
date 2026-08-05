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

// Role-bearing status colours → the fixed semantic tier (identical in every theme; never
// recoloured by a skin). Each toast kind maps to its own status token by role.
const COLOR: Record<ToastKind, string> = {
  info: 'var(--ga98-status-info)',
  success: 'var(--ga98-status-success)',
  warn: 'var(--ga98-status-warning)',
  error: 'var(--ga98-status-error)'
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
