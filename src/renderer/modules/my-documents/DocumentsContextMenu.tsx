import type { DocEntry } from '../../../shared/documents-types';

export interface ContextTarget { x: number; y: number; entry: DocEntry | null; }

interface Props {
  target: ContextTarget;
  canPaste: boolean;
  onNewFolder(): void;
  onRename(e: DocEntry): void;
  onDelete(e: DocEntry): void;
  onCopy(e: DocEntry): void;
  onCut(e: DocEntry): void;
  onPaste(): void;
  onClose(): void;
}

export function DocumentsContextMenu(p: Props): JSX.Element {
  const e = p.target.entry;
  const item = (label: string, fn: () => void, disabled = false): JSX.Element => (
    <div
      className="ga98-access-entry"
      role="menuitem"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) { fn(); p.onClose(); } }}
    >
      {label}
    </div>
  );
  return (
    <div
      role="menu"
      style={{ position: 'fixed', left: p.target.x, top: p.target.y, minWidth: 150, background: '#c0c0c0', border: '2px outset #f5f5f5', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 40 }}
      onMouseDown={(ev) => ev.stopPropagation()}
    >
      {e && item('Rename', () => p.onRename(e))}
      {e && item('Delete', () => p.onDelete(e))}
      {e && item('Copy', () => p.onCopy(e))}
      {e && item('Cut', () => p.onCut(e))}
      {e && <div className="ga98-access-separator" />}
      {item('New Folder', p.onNewFolder)}
      {item('Paste', p.onPaste, !p.canPaste)}
    </div>
  );
}
