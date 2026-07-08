/**
 * Modal for adding a custom news stream — Label + kind + URL, OK/Cancel. Replaces the always-visible
 * inline add-form in NewsFeedControls (GhostExodus: reduce what's in the visual path). Reuses the
 * .ga98-dialog-veil / .ga98-dialog-window chrome from DialogHost. Validation stays in NewsFeedControls
 * (validateStreamUrl) — this component only collects and returns the draft.
 */
import { useState } from 'react';
import type { NewsStreamKind } from './NewsStreamView';

export function AddStreamDialog(
  { onSubmit, onCancel }: { onSubmit: (v: { label: string; url: string; kind: NewsStreamKind }) => void; onCancel: () => void }
): JSX.Element {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<NewsStreamKind>('hls');
  function submit(): void { onSubmit({ label: label.trim(), url: url.trim(), kind }); }
  return (
    <div className="ga98-dialog-veil" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window ga98-dialog-window" role="dialog" aria-modal="true" aria-label="Add stream">
        <div className="title-bar"><div className="title-bar-text">Add stream</div></div>
        <div className="window-body" style={{ padding: 12, display: 'grid', gap: 6 }}>
          <input className="ga98-text" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} autoFocus />
          <select className="ga98-select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as NewsStreamKind)}>
            <option value="hls">HLS</option>
            <option value="youtube">YouTube</option>
          </select>
          <input className="ga98-text" aria-label="Stream URL"
            placeholder={kind === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://…/stream.m3u8'}
            value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={submit}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
