/**
 * GeoINT — pluggable geopolitical-monitoring dashboard. Left: network/tile controls,
 * source management (add/import OPML/toggle/remove/refresh) + a reading list. Right: a
 * Leaflet map of located items. All network is gated by settings.geoint.networkEnabled
 * (default off): with it off, Refresh is a main-side no-op and the map loads no tiles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoSnapshot, GeoSourceType, GeoItem } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { MapPane } from './MapPane';
import { SaveEventDialog } from './SaveEventDialog';
import { corroborate } from './corroborate';

// A sensible default basemap so the map actually renders the moment the user opts into the
// network. Nothing is fetched until the "Allow GeoINT network" box is ticked (the egress gate);
// once it is, this fills an empty tile field so the map isn't a blank grey square. The user can
// replace it with any {z}/{x}/{y} tile server.
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_TILE_ATTRIBUTION = '© OpenStreetMap contributors';

// Built-in satellite basemap (Esri World Imagery). Like the street tiles, it only loads when
// "Allow GeoINT network" is on. Note Esri's tile path is {z}/{y}/{x} — y before x.
const ESRI_SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_SAT_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';

// Transparent street-name / place-name reference overlays — Esri's "Imagery Hybrid" reference
// layers, on the SAME arcgisonline.com host the satellite basemap already uses (no new egress
// domain). Drawn on top of the basemap when "Labels" is on; most useful over Satellite, which
// otherwise has no labels. {z}/{y}/{x} like the Esri imagery path.
const LABELS_TRANSPORT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const LABELS_PLACES_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const LABELS_ATTRIBUTION = 'Labels © Esri';

export function GeoIntModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const net = settings?.geoint.networkEnabled ?? false;
  const tileUrl = settings?.geoint.tileServerUrl ?? '';
  const tileAttribution = settings?.geoint.tileAttribution ?? '';
  const basemap = settings?.geoint.basemap ?? 'street';
  // The map's active layer: street uses the user/OSM tiles; satellite uses the built-in Esri layer.
  const activeTileUrl = basemap === 'satellite' ? ESRI_SAT_URL : tileUrl;
  const activeTileAttribution = basemap === 'satellite' ? ESRI_SAT_ATTRIBUTION : tileAttribution;

  const [snap, setSnap] = useState<GeoSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveItem, setSaveItem] = useState<GeoItem | null>(null);
  const [draft, setDraft] = useState<{ label: string; url: string; type: GeoSourceType }>({ label: '', url: '', type: 'rss' });
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  // Custom tile URL is edited locally and applied only when the user clicks Load (rather than
  // live on every keystroke), so loading a custom basemap is an explicit, obvious action and
  // doesn't require switching the View toggle first.
  const [tileDraft, setTileDraft] = useState(tileUrl);
  useEffect(() => { setTileDraft(tileUrl); }, [tileUrl]);
  function loadTiles(): void {
    const u = tileDraft.trim() || DEFAULT_TILE_URL;
    patchGeo({ basemap: 'street', tileServerUrl: u, tileAttribution: u === DEFAULT_TILE_URL ? DEFAULT_TILE_ATTRIBUTION : tileAttribution });
    toast.success('Map tiles loaded.');
  }
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const flyKey = useRef(0); // monotonic nonce so repeat searches re-center even on identical coords
  // Street View overlay (embed). Tracks the map center so it opens the spot you're looking at.
  const [streetView, setStreetView] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lon: number }>({ lat: 20, lon: 0 });
  // Street-name / place-name overlay (off by default; redundant on the OSM 2D map, which already
  // labels — the win is on Satellite). Ephemeral per session.
  const [labels, setLabels] = useState(false);
  const overlayUrls = labels && net ? [LABELS_TRANSPORT_URL, LABELS_PLACES_URL] : [];

  // Surface a snapshot failure instead of leaving the whole panel silently empty (which read
  // as "GeoINT does nothing"). A locked vault, for instance, now shows the actual reason here.
  const load = useCallback(async () => {
    try { setSnap(await window.api.geoint.snapshot()); setLoadError(null); }
    catch (err) { setLoadError((err as Error).message); }
  }, []);
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
  // Merge-write the geoint settings block. `patch` shallow-replaces the whole geoint object, so
  // every write must carry all fields — this fills the unchanged ones from current state and
  // applies the delta, so adding basemap (or any future field) can't silently drop the others.
  function patchGeo(p: Partial<{ networkEnabled: boolean; tileServerUrl: string; tileAttribution: string; basemap: 'street' | 'satellite' }>): void {
    void patch({ geoint: { networkEnabled: net, tileServerUrl: tileUrl, tileAttribution, basemap, ...p } });
  }
  function setNetwork(enabled: boolean): void {
    // Enabling with no tile server configured yet → drop in the default basemap so the map
    // renders immediately instead of staying blank (the #1 "GeoINT does nothing" symptom).
    const url = enabled && !tileUrl ? DEFAULT_TILE_URL : tileUrl;
    const attr = enabled && !tileUrl ? DEFAULT_TILE_ATTRIBUTION : tileAttribution;
    patchGeo({ networkEnabled: enabled, tileServerUrl: url, tileAttribution: attr });
  }
  async function toggleSource(id: string, enabled: boolean): Promise<void> {
    try { await window.api.geoint.updateSource(id, { enabled }); await load(); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function removeSource(id: string): Promise<void> {
    try { await window.api.geoint.removeSource(id); await load(); }
    catch (err) { toast.error((err as Error).message); }
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
    try { await window.api.geoint.setItemLocation(pickFor, { lat, lon }); setPickFor(null); await load(); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function doSearch(): Promise<void> {
    if (!net) { toast.warn('GeoINT network is off — enable it to search the map.'); return; }
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hit = await window.api.geoint.geocode(q);
      if (!hit) { toast.warn(`No match for "${q}".`); return; }
      flyKey.current += 1;
      setFlyTo({ lat: hit.lat, lon: hit.lon, key: flyKey.current });
      toast.success(hit.label);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSearching(false); }
  }

  // Auto-refresh every 5 minutes while the network is on (off ⇒ no timer, no egress). The ref
  // keeps the interval pointed at the latest refresh() without resetting the timer each render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!net) return;
    const id = setInterval(() => { void refreshRef.current(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [net]);

  // Memoized so its reference is stable across renders that don't change the data — otherwise a fresh
  // array each render makes MapPane's marker effect clear+rebuild every pan (the drag "catch") and
  // re-fire the focused-marker setView (a moveend→re-render→rebuild loop that flashed the popup).
  const items = useMemo(
    () => (snap?.items ?? []).filter((i) => !filter || i.title.toLowerCase().includes(filter.toLowerCase())),
    [snap, filter]
  );

  // Corroboration count per item (distinct other sources nearby in time). Memoized on the same
  // `items` reference so it only recomputes when the item set changes — no per-render thrash.
  const corroboration = useMemo(() => corroborate(items), [items]);

  return (
    <div className="ga98-split ga98-geo" style={{ height: '100%' }}>
      <div className="ga98-pane ga98-geo-left">
        {loadError && (
          <div style={{ background: '#fee', color: '#900', padding: '4px 8px', fontSize: 11, border: '1px solid #c00', marginBottom: 4 }}>
            GeoINT data failed to load: {loadError}
          </div>
        )}
        <fieldset>
          <legend>Network</legend>
          <div className="field-row" style={{ gap: 6, alignItems: 'center' }}>
            <button onClick={() => setNetwork(!net)} aria-pressed={net}
              style={net ? { borderStyle: 'inset', background: '#bfe0bf', color: '#003300', fontWeight: 'bold' } : { fontWeight: 'bold' }}>
              {net ? 'Disable GeoINT network' : 'Enable GeoINT network'}
            </button>
            <span style={{ fontSize: 11, color: net ? '#060' : '#900' }}>{net ? '● on' : '○ off'}</span>
          </div>
          <p style={{ fontSize: 11, color: '#555', margin: '4px 0' }}>Off by default. When off, nothing is fetched and the map loads no tiles — feeds and map both stay quiet until you enable it.</p>
          <div className="field-row">
            <label style={{ minWidth: 60 }}>Tiles:</label>
            <input className="ga98-text" placeholder={DEFAULT_TILE_URL} value={tileDraft} disabled={!net}
              onChange={(e) => setTileDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadTiles(); }} style={{ flex: 1 }} />
            <button onClick={loadTiles} disabled={!net} title="Load this tile server as the 2D map">Load</button>
            <button
              onClick={() => { setTileDraft(DEFAULT_TILE_URL); patchGeo({ basemap: 'street', tileServerUrl: DEFAULT_TILE_URL, tileAttribution: DEFAULT_TILE_ATTRIBUTION }); setStreetView(false); toast.success('Reset to the default OpenStreetMap tiles.'); }}
              disabled={!net} title="Reset to the default OpenStreetMap tile server">Reset</button>
          </div>
          <div className="field-row" style={{ marginTop: 4 }}>
            <label style={{ minWidth: 60 }}>View:</label>
            <button onClick={() => { patchGeo({ basemap: 'street' }); setStreetView(false); }} disabled={!net} aria-pressed={!streetView && basemap === 'street'}
              style={!streetView && basemap === 'street' ? { borderStyle: 'inset', fontWeight: 'bold' } : {}}>2D Map</button>
            <button onClick={() => { patchGeo({ basemap: 'satellite' }); setStreetView(false); }} disabled={!net} aria-pressed={!streetView && basemap === 'satellite'}
              style={!streetView && basemap === 'satellite' ? { borderStyle: 'inset', fontWeight: 'bold' } : {}}>Satellite</button>
            <button onClick={() => setStreetView(true)} disabled={!net} aria-pressed={streetView}
              title="Google Street View of the current map center (loads Google in-app while the network is on)"
              style={streetView ? { borderStyle: 'inset', fontWeight: 'bold' } : {}}>Street View</button>
            <label style={{ fontSize: 11, marginLeft: 6, opacity: net ? 1 : 0.5 }}
              title="Overlay street + place names on the map (most useful on Satellite — the 2D map already labels)">
              <input type="checkbox" checked={labels} disabled={!net} onChange={(e) => setLabels(e.target.checked)} /> Labels
            </label>
          </div>
          <div className="field-row" style={{ marginTop: 4 }}>
            <label style={{ minWidth: 60 }}>Search:</label>
            <input className="ga98-text" placeholder="city, address, place…" value={search} disabled={!net}
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }} style={{ flex: 1 }} />
            <button onClick={() => void doSearch()} disabled={!net || !search.trim() || searching}>{searching ? '…' : 'Go'}</button>
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
                <button title="Save this event to a case" onClick={() => setSaveItem(i)} style={{ minWidth: 0, padding: '0 6px' }}>📁</button>
              </li>
            ))}
          </ul>
          {pickFor && <p style={{ fontSize: 11, color: 'navy', margin: '4px 0' }}>Pin mode: click the map to locate the selected event.</p>}
        </fieldset>
      </div>

      <div className="ga98-pane ga98-geo-right" style={{ padding: 0, position: 'relative' }}>
        {/* MapPane stays mounted under the Street View overlay so its Leaflet state + center
            tracking survive toggling Street View on/off. */}
        <MapPane items={items} corroboration={corroboration} tilesEnabled={net} tileUrl={activeTileUrl} tileAttribution={activeTileAttribution}
          pickMode={pickFor != null} onPick={(la, lo) => void onPick(la, lo)} focusId={focusId} flyTo={flyTo}
          onCenterChange={(lat, lon) => setCenter({ lat, lon })} overlayUrls={overlayUrls} overlayAttribution={LABELS_ATTRIBUTION} />
        {streetView && net && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#000' }}>
            <div className="ga98-toolbar" style={{ flex: '0 0 auto' }}>
              <b style={{ fontSize: 11 }}>Street View — {center.lat.toFixed(4)}, {center.lon.toFixed(4)}</b>
              <span style={{ flex: 1 }} />
              <button
                title="Open this spot in Firefox (instantstreetview) instead"
                onClick={() => void window.api.browser.launchFirefox(`https://www.instantstreetview.com/@${center.lat},${center.lon},0h,0p,0z`, 'Street View').catch((e) => toast.error((e as Error).message))}
              >Open in Firefox</button>
              <button onClick={() => setStreetView(false)}>Close</button>
            </div>
            {/* Google's embeddable Street View endpoint (no API key). If Google ever refuses
                framing, the frame is blank — use "Open in Firefox" above. Loads Google in-app:
                this is the accepted egress for choosing the embedded Street View. */}
            <iframe
              title="Street View"
              src={`https://www.google.com/maps?layer=c&cbll=${center.lat},${center.lon}&cbp=11,0,0,0,0&output=svembed`}
              style={{ flex: 1, width: '100%', border: 0 }}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </div>
      {saveItem && <SaveEventDialog item={saveItem} onClose={() => setSaveItem(null)} />}
    </div>
  );
}
