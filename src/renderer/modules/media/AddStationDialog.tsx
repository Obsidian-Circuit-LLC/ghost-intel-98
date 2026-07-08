/** Add/Edit a streaming station — Label + URL, OK/Cancel. Shared by the drawer's Add and Edit buttons;
 *  Edit passes `initial` (with id) to pre-fill and carry the id back through onSubmit → upsertStation. */
import { useState } from 'react';

export interface StationDraft { id?: string; label: string; url: string }

export function AddStationDialog(
  { initial, onSubmit, onCancel }: { initial?: StationDraft; onSubmit: (v: StationDraft) => void; onCancel: () => void }
): JSX.Element {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  function submit(): void {
    const v: StationDraft = { label: label.trim(), url: url.trim() };
    if (initial?.id) v.id = initial.id;
    onSubmit(v);
  }
  return (
    <div className="ga98-dialog-veil" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window ga98-dialog-window" role="dialog" aria-modal="true" aria-label={initial?.id ? 'Edit station' : 'Add station'}>
        <div className="title-bar"><div className="title-bar-text">{initial?.id ? 'Edit station' : 'Add station'}</div></div>
        <div className="window-body" style={{ padding: 12, display: 'grid', gap: 6 }}>
          <input className="ga98-text" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} autoFocus />
          <input className="ga98-text" placeholder="http(s) stream URL" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={submit} disabled={!label.trim() || !url.trim()}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
