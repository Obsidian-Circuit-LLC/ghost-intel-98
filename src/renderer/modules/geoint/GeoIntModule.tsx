/**
 * GeoINT — pluggable geopolitical-monitoring dashboard. Left: network/tile controls,
 * source management (add/import OPML/toggle/remove/refresh) + a reading list. Right: a
 * Leaflet map of located items. All network is gated by settings.geoint.networkEnabled
 * (default off): with it off, Refresh is a main-side no-op and the map loads no tiles.
 */

import { useCallback, useEffect, useState } from 'react';
import type { GeoSnapshot, GeoSourceType } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { MapPane } from './MapPane';

export function GeoIntModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const net = settings?.geoint.networkEnabled ?? false;
  const tileUrl = settings?.geoint.tileServerUrl ?? '';
  const tileAttribution = settings?.geoint.tileAttribution ?? '';

  const [snap, setSnap] = useState<GeoSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ label: string; url: string; type: GeoSourceType }>({ label: '', url: '', type: 'rss' });

  const load = useCallback(async () => { setSnap(await window.api.geoint.snapshot()); }, []);
  useEffect(() => { void load(); }, [load]);

  async function addSource(): Promise<void> {
    if (!draft.label || !draft.url) return;
    try { await window.api.geoint.addSource(draft); setDraft({ label: '', url: '', type: 'rss' }); await load(); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function importOpml(): Promise<void> {
    try { const n = await window.api.geoint.importOpml(); if (n > 0) toast.success(`Imported ${n} source${n === 1 ? '' : 's'}.`); else toast.warn('No sources found.'); await load(); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function toggleSource(id: string, enabled: boolean): Promise<void> {
    await window.api.geoint.updateSource(id, { enabled }); await load();
  }
  async function removeSource(id: string): Promise<void> {
    await window.api.geoint.removeSource(id); await load();
  }
  async function refresh(): Promise<void> {
    if (!net) { toast.warn('GeoINT network is off — enable it to fetch sources.'); return; }
    setBusy(true);
    try { const r = await window.api.geoint.refresh(); toast.success(`Refreshed: ${r.fetched} ok${r.failed ? `, ${r.failed} failed` : ''}.`); await load(); }
    catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }
  async function onPick(lat: number, lon: number): Promise<void> {
    if (!pickFor) return;
    await window.api.geoint.setItemLocation(pickFor, { lat, lon });
    setPickFor(null); await load();
  }

  const items = (snap?.items ?? []).filter((i) => !filter || i.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="ga98-split ga98-geo" style={{ height: '100%' }}>
      <div className="ga98-pane ga98-geo-left">
        <fieldset>
          <legend>Network</legend>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={net} onChange={(e) => void patch({ geoint: { networkEnabled: e.target.checked, tileServerUrl: tileUrl, tileAttribution } })} />
            {' '}Allow GeoINT network (feeds + map tiles)
          </label>
          <p style={{ fontSize: 11, color: '#555', margin: '4px 0' }}>Off by default. When off, nothing is fetched and the map loads no tiles.</p>
          <div className="field-row">
            <label style={{ minWidth: 60 }}>Tiles:</label>
            <input className="ga98-text" placeholder="https://…/{z}/{x}/{y}.png" value={tileUrl} disabled={!net}
              onChange={(e) => void patch({ geoint: { networkEnabled: net, tileServerUrl: e.target.value, tileAttribution } })} style={{ flex: 1 }} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Sources</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 4 }}>
            <input className="ga98-text" placeholder="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <input className="ga98-text" placeholder="https://feed…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <select className="ga98-text" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as GeoSourceType })}>
              <option value="rss">RSS</option><option value="atom">Atom</option><option value="geojson">GeoJSON</option>
            </select>
          </div>
          <div className="field-row" style={{ marginTop: 6, gap: 4 }}>
            <button onClick={() => void addSource()} disabled={!draft.label || !draft.url}>Add</button>
            <button onClick={() => void importOpml()}>Import OPML…</button>
            <button onClick={() => void refresh()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
          </div>
          <ul className="ga98-list" style={{ marginTop: 6 }}>
            {(snap?.sources ?? []).map((s) => (
              <li key={s.id} title={s.lastError ? `Last error: ${s.lastError}` : s.url}>
                <input type="checkbox" checked={s.enabled} onChange={(e) => void toggleSource(s.id, e.target.checked)} />
                <span style={{ flex: 1, marginLeft: 4 }}>{s.label} <span style={{ opacity: 0.6, fontSize: 10 }}>{s.type}{s.lastError ? ' · error' : ''}</span></span>
                <button onClick={() => void removeSource(s.id)} style={{ minWidth: 0, padding: '0 6px' }}>✕</button>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <legend>Events ({items.length})</legend>
          <input className="ga98-text" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="ga98-list ga98-geo-events" style={{ flex: 1, overflow: 'auto', marginTop: 4 }}>
            {items.map((i) => (
              <li key={i.id} data-active={i.id === focusId}>
                <span style={{ flex: 1, cursor: i.lat != null ? 'pointer' : 'default' }} onClick={() => i.lat != null && setFocusId(i.id)}>
                  {i.title} <span style={{ opacity: 0.5, fontSize: 10 }}>{i.located === 'none' ? '(no location)' : ''}</span>
                </span>
                <button title="Click then click the map to set this event's location" onClick={() => setPickFor(i.id)}
                  style={{ minWidth: 0, padding: '0 6px', outline: pickFor === i.id ? '2px solid navy' : undefined }}>📍</button>
              </li>
            ))}
          </ul>
          {pickFor && <p style={{ fontSize: 11, color: 'navy', margin: '4px 0' }}>Pin mode: click the map to locate the selected event.</p>}
        </fieldset>
      </div>

      <div className="ga98-pane ga98-geo-right" style={{ padding: 0 }}>
        <MapPane items={items} tilesEnabled={net} tileUrl={tileUrl} tileAttribution={tileAttribution}
          pickMode={pickFor != null} onPick={(la, lo) => void onPick(la, lo)} focusId={focusId} />
      </div>
    </div>
  );
}
