/** The fold-out STREAM STATIONS drawer (full-shade). Gated behind the streaming opt-in like today; shows
 *  the opt-in card when off. Add/Edit via AddStationDialog → upsertStation; Remove → deleteStation;
 *  Up/Down → reorderStations; Save List… → exportStations; Test → testStation (egress-gated). */
import { useState } from 'react';
import type { MediaStation } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';
import { AddStationDialog, type StationDraft } from './AddStationDialog';
import { testStation } from './station-test';

export function StationsDrawer(
  { stations, streamingEnabled, onPlay, onChanged, onEnableStreaming }:
  { stations: MediaStation[]; streamingEnabled: boolean; onPlay: (s: MediaStation) => void;
    onChanged: () => void; onEnableStreaming: () => void }
): JSX.Element {
  const [editing, setEditing] = useState<StationDraft | null>(null);   // null = closed; {} = add; {id,…} = edit
  const [status, setStatus] = useState<'ok' | 'off' | 'fail' | 'testing' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function save(v: StationDraft): Promise<void> {
    try { await window.api.media.upsertStation(v); setEditing(null); onChanged(); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function remove(id: string): Promise<void> {
    try { await window.api.media.deleteStation(id); onChanged(); } catch (err) { toast.error((err as Error).message); }
  }
  async function move(i: number, dir: -1 | 1): Promise<void> {
    const j = i + dir; if (j < 0 || j >= stations.length) return;
    const ids = stations.map((s) => s.id); [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await window.api.media.reorderStations(ids); onChanged(); } catch (err) { toast.error((err as Error).message); }
  }
  async function saveList(): Promise<void> {
    try { const f = await window.api.media.exportStations(); if (f) toast.success(`Saved ${f}`); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function test(url: string): Promise<void> {
    setStatus('testing'); const r = await testStation(url, streamingEnabled); setStatus(r);
    if (r === 'off') toast.warn('Internet streaming is off — enable it to test a station.');
    else if (r === 'fail') toast.error('Stream did not load.');
    else toast.success('Stream reachable.');
  }

  if (!streamingEnabled) {
    return (
      <div className="ga98-stations-drawer">
        <p style={{ fontSize: 11, color: '#555' }}>Internet streaming is off. Local playback never touches the network; turning this on lets the Jukebox reach the internet for radio.</p>
        <button onClick={onEnableStreaming}>Allow internet streaming</button>
      </div>
    );
  }

  const sel = stations.find((s) => s.id === selected) ?? null;
  return (
    <div className="ga98-stations-drawer">
      <div className="ga98-stations-list">
        <ul className="ga98-list">
          {stations.map((s, i) => (
            <li key={s.id} data-active={s.id === selected} onClick={() => setSelected(s.id)} onDoubleClick={() => onPlay(s)}>
              <span style={{ flex: 1 }}>{s.label}</span>
              <button aria-label="Move up" title="Up" onClick={(e) => { e.stopPropagation(); void move(i, -1); }}>▲</button>
              <button aria-label="Move down" title="Down" onClick={(e) => { e.stopPropagation(); void move(i, 1); }}>▼</button>
              <button aria-label="Edit" title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>✎</button>
              <button aria-label="Remove" title="Remove" onClick={(e) => { e.stopPropagation(); void remove(s.id); }}>✕</button>
            </li>
          ))}
        </ul>
        <div className="field-row" style={{ gap: 4, marginTop: 4 }}>
          <button onClick={() => setEditing({ label: '', url: '' })}>Add stream…</button>
          <button onClick={() => void saveList()} disabled={stations.length === 0}>Save List…</button>
        </div>
      </div>
      <div className="ga98-now-station">
        <div className="ga98-now-station-title">Now Playing Station</div>
        <div className="ga98-now-station-body">{sel ? sel.label : '—'}</div>
        {sel && <button onClick={() => void test(sel.url)}>Test</button>}
        {status && <span className={`ga98-test-dot ga98-test-${status}`} aria-label={`test ${status}`} />}
      </div>
      {editing && <AddStationDialog initial={editing.id ? editing : undefined} onCancel={() => setEditing(null)} onSubmit={(v) => void save(v)} />}
    </div>
  );
}
