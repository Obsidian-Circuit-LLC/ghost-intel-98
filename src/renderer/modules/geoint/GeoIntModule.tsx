/**
 * GeoINT — pluggable geopolitical-monitoring dashboard. Left: network/tile controls,
 * source management (add/import OPML/toggle/remove/refresh) + a reading list. Right: a
 * Leaflet map of located items. All network is gated by settings.geoint.networkEnabled
 * (default off): with it off, Refresh is a main-side no-op and the map loads no tiles.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoSnapshot, GeoSourceType, GeoXmlMap, GeoItem, KevEntry, CameraStream } from '@shared/post-mvp-types';
import { useSettings, useWindows } from '../../state/store';
import { toast } from '../../state/toasts';
import { confirmDialog, alertDialog } from '../../state/dialogs';
import { MapGL, validCoord } from './MapGL';
import { cameraWindowAction, cameraWindowId, MAX_CAMERA_WINDOWS } from '../cameraview/cameraWindow';
import { MapErrorBoundary } from './MapErrorBoundary';
import { SaveEventDialog } from './SaveEventDialog';
import { corroborate } from './corroborate';
import { timeBounds, itemsUpTo } from './timeline';
import { TimelineBar } from './TimelineBar';
import { StoryControls } from './StoryControls';
import { CommandRail } from './CommandRail';
import { filterByCategories, UNCATEGORIZED } from './threat';

// GeoINT reimagine (R5): pluggable threat layers. Each is an on-demand, ephemeral fetch into
// GeoItem[] (held in renderer state, never persisted to the source cache). USGS earthquakes is
// the first layer. The allowlisted USGS feed tokens MUST mirror src/main/.../threat-layers/usgs.ts.
type ThreatLayerId = 'usgs' | 'gdacs' | 'wartracker' | 'gdelt' | 'firms' | 'gdeltcloud' | 'ucdp' | 'reliefweb';
// Layers needing a per-user API key/token (stored main-side in the OS secret store, never echoed
// back to the renderer). Mirror src/main/security/validate.ts KEYED_LAYER_IDS.
type KeyedLayerId = 'firms' | 'gdeltcloud' | 'ucdp';
const KEYED_LAYER_IDS: KeyedLayerId[] = ['firms', 'gdeltcloud', 'ucdp'];
const USGS_FEED_OPTIONS: { value: string; label: string }[] = [
  { value: 'significant_day', label: 'Significant — past day' },
  { value: 'significant_week', label: 'Significant — past week' },
  { value: '4.5_day', label: 'M4.5+ — past day' },
  { value: '4.5_week', label: 'M4.5+ — past week' },
  { value: '2.5_day', label: 'M2.5+ — past day' },
  { value: '2.5_week', label: 'M2.5+ — past week' },
  { value: 'all_day', label: 'All — past day' },
  { value: 'all_week', label: 'All — past week' }
];

// Category → marker color, mirroring MapPane's CATEGORY_COLOR, for the legend chip row.
const CATEGORY_COLOR: Record<string, string> = {
  conflict: '#c0392b', cyber: '#8e44ad', protest: '#e67e22',
  disaster: '#16a085', crime: '#7f8c8d', politics: '#2980b9'
};

// A sensible default basemap so the map actually renders the moment the user opts into the
// network. Nothing is fetched until the "Allow GeoINT network" box is ticked (the egress gate);
// once it is, this fills an empty tile field so the map isn't a blank grey square. The user can
// replace it with any {z}/{x}/{y} tile server.
const DEFAULT_TILE_URL = 'https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
const DEFAULT_TILE_ATTRIBUTION = '© Google';

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

// Upper bound on the item set fed into corroborate/timeBounds/visibleItems and the map IPC. A
// pathological cache (130k+ accumulated events) shouldn't bog the per-item corroboration grid or
// the marker build even though timeBounds no longer crashes on it. Capping keeps the UI responsive
// and the payload sane; the Events legend shows the truncation so it's never silent.
const MAX_ITEMS = 5000;
// "Play story" dwell: how long each event is shown before auto-advancing to the next (5 s).
const STORY_ADVANCE_MS = 5000;

// GeoINT renders on the MapLibre GL 3D globe (MapGL). The former Leaflet fallback (MapPane) was
// removed once the globe was confirmed in a built/GPU smoke test (v3.14.0-beta.11).

function GeoIntModuleInner(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  // Read the geoint block defensively. `settings?.geoint.networkEnabled` only guards a null
  // `settings`; if `settings` exists but `.geoint` is missing (a partial/legacy settings object
  // that slipped past the merge), `settings.geoint.networkEnabled` would throw synchronously during
  // render and white-screen the whole module before first paint. Reading `settings?.geoint` once and
  // defaulting the sub-object removes that entire crash class.
  const g = settings?.geoint;
  const net = g?.networkEnabled ?? false;
  const tileUrl = g?.tileServerUrl ?? '';
  const tileAttribution = g?.tileAttribution ?? '';
  const basemap = g?.basemap ?? 'street';
  // News playlist (R12) — carried through patchGeo so a tile/basemap write never drops it (the
  // renderer store shallow-replaces the whole geoint block; every write must carry all fields).
  const newsStreams = g?.newsStreams ?? [];
  const newsStreamIndex = g?.newsStreamIndex ?? 0;
  // The map's active layer: street uses the user/default tiles; satellite uses the built-in Esri layer.
  const activeTileUrl = basemap === 'satellite' ? ESRI_SAT_URL : tileUrl;
  const activeTileAttribution = basemap === 'satellite' ? ESRI_SAT_ATTRIBUTION : tileAttribution;

  const [snap, setSnap] = useState<GeoSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveItem, setSaveItem] = useState<GeoItem | null>(null);
  const [draft, setDraft] = useState<{ label: string; url: string; type: GeoSourceType; xmlMap?: GeoXmlMap }>({ label: '', url: '', type: 'rss' });
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
  // Timeline scrubber: cursor (epoch ms) is the "show events up to" point; playing animates it.
  const [timeCursor, setTimeCursor] = useState(0);
  const [timePlaying, setTimePlaying] = useState(false);
  // Story mode: chronological walk through the visible+located events. null = not running.
  const [story, setStory] = useState<{ index: number; playing: boolean } | null>(null);
  // Street View overlay (embed). Tracks the map center so it opens the spot you're looking at.
  const [streetView, setStreetView] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lon: number }>({ lat: 20, lon: 0 });
  // Street-name / place-name overlay (off by default; redundant on the labeled 2D map, which already
  // labels — the win is on Satellite). Ephemeral per session.
  const [labels, setLabels] = useState(false);
  const overlayUrls = labels && net ? [LABELS_TRANSPORT_URL, LABELS_PLACES_URL] : [];

  // CCTV camera layer (off by default; pins are local data so this is NOT behind the network gate).
  const [showCctv, setShowCctv] = useState(false);
  const [cctvStreams, setCctvStreams] = useState<CameraStream[]>([]);

  // Command-center rail (R9): category visibility filter. Only consulted in globe mode (useMapGL);
  // it hides/shows a category's markers on the map. `null` = "all categories on" (the default — no
  // category is disabled). Toggling a box off materializes the set as the full category list minus
  // that key, so subsequent toggles operate on an explicit set. The 2-column path never reads this.
  const [disabledCategories, setDisabledCategories] = useState<Set<string>>(new Set());
  const toggleCategory = useCallback((key: string, on: boolean): void => {
    setDisabledCategories((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Threat layers (R5): on-demand, ephemeral. `layerItems` holds the fetched GeoItem[] per enabled
  // layer; toggling a layer off drops its items. `usgsFeed` is the allowlisted feed/timeframe for
  // USGS. `layerBusy`/`layerError` track the in-flight fetch. None of this is persisted.
  const [layerItems, setLayerItems] = useState<Map<ThreatLayerId, GeoItem[]>>(new Map());
  const [usgsFeed, setUsgsFeed] = useState('2.5_day');
  // war-tracker: optional ISO2 country filter; GDELT: free-text query (default a broad crisis query).
  const [wtCountry, setWtCountry] = useState('');
  const [gdeltQuery, setGdeltQuery] = useState('(conflict OR airstrike OR crisis OR protest OR earthquake OR flood)');
  const [layerBusy, setLayerBusy] = useState<ThreatLayerId | null>(null);
  const [layerError, setLayerError] = useState<string | null>(null);
  const enabledLayers = useMemo(() => new Set(layerItems.keys()), [layerItems]);

  // Keyed layers (firms/gdeltcloud/ucdp): whether a key is stored (drives the "needs key" disabled
  // state) and the in-progress key input per layer (never pre-filled from the store — the stored
  // key is write-only from the renderer's perspective).
  const [hasKey, setHasKey] = useState<Record<KeyedLayerId, boolean>>({ firms: false, gdeltcloud: false, ucdp: false });
  const [keyDraft, setKeyDraft] = useState<Record<KeyedLayerId, string>>({ firms: '', gdeltcloud: '', ucdp: '' });
  const [keySaving, setKeySaving] = useState<KeyedLayerId | null>(null);

  // CISA KEV / Alerts (R8): a non-map advisory list. KEV has no coordinates — these entries never
  // become pins; they live only in the left-pane panel. On-demand fetch, gated on `net`, not persisted.
  const [kev, setKev] = useState<KevEntry[]>([]);
  const [kevBusy, setKevBusy] = useState(false);
  async function refreshKev(): Promise<void> {
    if (!net) { toast.warn('GeoINT network is off — enable it to fetch CISA KEV.'); return; }
    setKevBusy(true);
    try {
      const list = await window.api.geoint.fetchKev();
      setKev(list);
      toast.success(`Loaded ${list.length} KEV entr${list.length === 1 ? 'y' : 'ies'}.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setKevBusy(false);
    }
  }

  const refreshKeyState = useCallback(async () => {
    const next: Record<KeyedLayerId, boolean> = { firms: false, gdeltcloud: false, ucdp: false };
    for (const id of KEYED_LAYER_IDS) {
      try { next[id] = await window.api.geoint.hasLayerKey(id); } catch { next[id] = false; }
    }
    setHasKey(next);
  }, []);
  useEffect(() => { void refreshKeyState(); }, [refreshKeyState]);

  const refreshCameras = useCallback(async (opts: { silent?: boolean } = {}) => {
    try {
      const all = await window.api.streams.list();
      setCctvStreams(all.filter((s) => validCoord(s.lat, s.lon)));
    } catch {
      setCctvStreams([]);
      // Only surface the failure when the user explicitly asked (Refresh button). On the silent
      // mount fetch, fail quietly — no startup dialog for a feature the user hasn't touched.
      if (!opts.silent) {
        setShowCctv(false);
        void alertDialog('Could not load the camera list.', 'CCTV cameras');
      }
    }
  }, []);

  useEffect(() => { void refreshCameras({ silent: true }); }, [refreshCameras]);

  const onCameraOpen = useCallback((streamId: string) => {
    const stream = cctvStreams.find((s) => s.id === streamId);
    if (!stream) return;
    const openIds = useWindows.getState().windows.filter((w) => w.module === 'camera-view').map((w) => w.id);
    if (cameraWindowAction(openIds, streamId) === 'deny') {
      void alertDialog(`Close a camera window first (max ${MAX_CAMERA_WINDOWS} open).`, 'CCTV cameras');
      return;
    }
    // open() dedups by id: an already-open camera window is re-focused; otherwise a new one opens.
    useWindows.getState().open({
      module: 'camera-view',
      id: cameraWindowId(streamId),
      title: stream.label,
      props: { stream },
      width: 480,
      height: 360
    });
  }, [cctvStreams]);

  async function saveLayerKey(id: KeyedLayerId): Promise<void> {
    const key = keyDraft[id].trim();
    if (!key) { toast.warn('Enter a key first.'); return; }
    setKeySaving(id);
    try {
      await window.api.geoint.setLayerKey(id, key);
      setKeyDraft((d) => ({ ...d, [id]: '' })); // don't keep the key in renderer state after save
      await refreshKeyState();
      toast.success(`${id.toUpperCase()} key saved.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setKeySaving(null);
    }
  }

  async function toggleLayer(id: ThreatLayerId, on: boolean, opts: { feed?: string; country?: string; query?: string } = {}): Promise<void> {
    if (!on) {
      setLayerItems((m) => { const next = new Map(m); next.delete(id); return next; });
      return;
    }
    if (!net) { toast.warn('GeoINT network is off — enable it to load threat layers.'); return; }
    setLayerBusy(id);
    setLayerError(null);
    try {
      const fetched = await window.api.geoint.fetchThreatLayer(id, opts);
      setLayerItems((m) => { const next = new Map(m); next.set(id, fetched); return next; });
      toast.success(`Loaded ${fetched.length} ${id.toUpperCase()} event${fetched.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setLayerError((err as Error).message);
      toast.error((err as Error).message);
    } finally {
      setLayerBusy(null);
    }
  }

  // Surface a snapshot failure instead of leaving the whole panel silently empty (which read
  // as "GeoINT does nothing"). A locked vault, for instance, now shows the actual reason here.
  const load = useCallback(async () => {
    try { setSnap(await window.api.geoint.snapshot()); setLoadError(null); }
    catch (err) { setLoadError((err as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function addSource(): Promise<void> {
    if (!draft.label || !draft.url) return;
    const isXml = draft.type === 'xml';
    if (isXml && !(draft.xmlMap?.itemsPath && draft.xmlMap?.lat && draft.xmlMap?.lon)) {
      toast.error('XML source needs itemsPath, lat and lon paths.');
      return;
    }
    try {
      await window.api.geoint.addSource(isXml ? draft : { label: draft.label, url: draft.url, type: draft.type });
      setDraft({ label: '', url: '', type: 'rss' });
      await load();
    }
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
    void patch({ geoint: { networkEnabled: net, tileServerUrl: tileUrl, tileAttribution, basemap, newsStreams, newsStreamIndex, ...p } });
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
  // Full reset: purge ALL sources + cached events (main-side fs), reset tiles to default, and
  // clear local UI state. The escape hatch for a poisoned cache that survives delete+reinstall.
  async function purgeAll(): Promise<void> {
    try {
      await window.api.geoint.purgeCache();
      patchGeo({ basemap: 'street', tileServerUrl: DEFAULT_TILE_URL, tileAttribution: DEFAULT_TILE_ATTRIBUTION });
      setSnap(null);
      setFocusId(null);
      setPickFor(null);
      setStory(null);
      setSearch('');
      setTileDraft(DEFAULT_TILE_URL);
      await load();
      toast.success('GeoINT cache purged.');
    } catch (err) { toast.error((err as Error).message); }
  }
  async function confirmPurge(): Promise<void> {
    if (!(await confirmDialog('Purge ALL GeoINT sources and cached events, and reset the map tiles to default? This cannot be undone.', 'Purge GeoINT cache'))) return;
    await purgeAll();
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
  const { items, itemsTotal } = useMemo(() => {
    // Merge snapshot (persisted feed) items with the on-demand threat-layer items so threat pins get
    // the same markers/popups/timeline/corroboration treatment, uniformly. Layer ids are prefixed
    // ('usgs:…') so they never collide with snapshot ids.
    const all = [...(snap?.items ?? []), ...[...layerItems.values()].flat()];
    const matched = all.filter((i) => !filter || i.title.toLowerCase().includes(filter.toLowerCase()));
    // Cap after filtering so corroborate/timeBounds/visibleItems and the map IPC stay bounded to
    // ≤MAX_ITEMS even on a pathological cache. itemsTotal carries the pre-cap count for the notice.
    return { items: matched.length > MAX_ITEMS ? matched.slice(0, MAX_ITEMS) : matched, itemsTotal: matched.length };
  }, [snap, layerItems, filter]);

  // Corroboration count per item (distinct other sources nearby in time). Computed on the FULL
  // `items` set (not the timeline-filtered subset) so confidence is stable as the cursor moves —
  // MapPane keys corroboration by id, so a filtered subset of ids is fine.
  const corroboration = useMemo(() => corroborate(items), [items]);

  // Timeline bounds over the full item set. null when no item carries a parseable date.
  const bounds = useMemo(() => timeBounds(items), [items]);
  // Clamp/initialize the cursor whenever the bounds change: park it at max (= "all events").
  useEffect(() => {
    if (!bounds) return;
    setTimeCursor((c) => (c < bounds.min || c > bounds.max ? bounds.max : c));
  }, [bounds?.min, bounds?.max]);

  // The set handed to the map: events at or before the cursor (undated always shown).
  const visibleItems = useMemo(() => itemsUpTo(items, timeCursor), [items, timeCursor]);

  // Command-center rail (R9): every category key present in the visible set (uncategorized bucketed
  // under UNCATEGORIZED), and the ENABLED subset = present minus disabledCategories. Used only in
  // globe mode to (a) feed the rail its filter state and (b) filter the markers handed to MapGL.
  const enabledCategories = useMemo(() => {
    const present = new Set<string>();
    for (const i of visibleItems) present.add(i.category ?? UNCATEGORIZED);
    for (const d of disabledCategories) present.delete(d);
    return present;
  }, [visibleItems, disabledCategories]);
  // Items fed to MapGL in globe mode: visibleItems minus disabled categories. When nothing is
  // disabled this is referentially a filtered copy of visibleItems with identical membership.
  const mapItems = useMemo(
    () => (disabledCategories.size === 0 ? visibleItems : filterByCategories(visibleItems, enabledCategories)),
    [visibleItems, enabledCategories, disabledCategories]
  );

  // Timeline auto-play: advance the cursor toward max in ~200 steps, stopping at max. Paused
  // while a story runs (story owns the camera). Display-only; no egress, no persisted state.
  useEffect(() => {
    if (!timePlaying || !bounds || story) return;
    const span = bounds.max - bounds.min;
    const step = span > 0 ? span / 200 : 1;
    const id = setInterval(() => {
      setTimeCursor((c) => {
        const next = c + step;
        if (next >= bounds.max) { setTimePlaying(false); return bounds.max; }
        return next;
      });
    }, 120);
    return () => clearInterval(id);
  }, [timePlaying, bounds?.min, bounds?.max, story]);

  // Story sequence: visible + located items, sorted ascending by published (undated last).
  const storyItems = useMemo(() => {
    const located = visibleItems.filter((i) => i.lat != null && i.lon != null);
    return [...located].sort((a, b) => {
      const pa = a.published ? Date.parse(a.published) : NaN;
      const pb = b.published ? Date.parse(b.published) : NaN;
      const na = Number.isNaN(pa), nb = Number.isNaN(pb);
      if (na && nb) return 0;
      if (na) return 1;  // undated sorts last
      if (nb) return -1;
      return pa - pb;
    });
  }, [visibleItems]);

  // Drive story playback: show the event at story.index (recenter + open its popup by reusing
  // the existing flyTo + focusId mechanisms), then after a speed delay advance the index. Stops
  // at the end. Prev/Next/Stop mutate `story` directly; this effect re-shows on every index change.
  useEffect(() => {
    if (!story) return;
    const it = storyItems[story.index];
    if (!it || it.lat == null || it.lon == null) { setStory(null); return; }
    flyKey.current += 1;
    setFlyTo({ lat: it.lat, lon: it.lon, key: flyKey.current });
    setFocusId(it.id);
    if (!story.playing) return;
    const id = setTimeout(() => {
      setStory((s) => {
        if (!s) return s;
        if (s.index >= storyItems.length - 1) return { index: s.index, playing: false };
        return { index: s.index + 1, playing: true };
      });
    }, STORY_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [story?.index, story?.playing, storyItems]);

  function startStory(): void {
    if (storyItems.length === 0) { toast.warn('No located events to play.'); return; }
    setTimePlaying(false);
    setStory({ index: 0, playing: true });
  }

  return (
    <div className="ga98-split ga98-geo ga98-geo-3col" style={{ height: '100%' }}>
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
              onClick={() => { setTileDraft(DEFAULT_TILE_URL); patchGeo({ basemap: 'street', tileServerUrl: DEFAULT_TILE_URL, tileAttribution: DEFAULT_TILE_ATTRIBUTION }); setStreetView(false); toast.success('Reset to the default map tiles.'); }}
              disabled={!net} title="Reset to the default tile server">Reset</button>
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
          <div className="field-row" style={{ marginTop: 4 }}>
            <button onClick={startStory} disabled={storyItems.length === 0}
              title="Step chronologically through the located events, recentering and opening each">
              ▶ Play story
            </button>
            <span style={{ fontSize: 11, color: '#555' }}>{storyItems.length} located event{storyItems.length === 1 ? '' : 's'}</span>
          </div>
        </fieldset>

        <fieldset>
          <legend>Legend</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
            {Object.entries(CATEGORY_COLOR).map(([cat, color]) => (
              <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: '50%', background: color, border: '1px solid rgba(0,0,0,.5)' }} />
                {cat}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '6px 0 0' }}>Places © GeoNames (CC-BY 4.0)</p>
        </fieldset>

        <fieldset>
          <legend>Sources</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 4 }}>
            <input className="ga98-text" placeholder="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <input className="ga98-text" placeholder="https://feed…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <select className="ga98-text" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as GeoSourceType })}>
              <option value="rss">RSS</option><option value="atom">Atom</option><option value="geojson">GeoJSON</option>
              <option value="jsonfeed">JSON Feed</option>
              <option value="kml">KML</option><option value="gpx">GPX</option><option value="xml">XML (custom)</option>
            </select>
          </div>
          {draft.type === 'xml' && (
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 2, marginTop: 4 }}>
              {(['itemsPath', 'lat', 'lon', 'title', 'summary', 'link', 'date'] as const).map((k) => (
                <Fragment key={k}>
                  <label style={{ fontSize: 11 }}>{k}{(k === 'itemsPath' || k === 'lat' || k === 'lon') ? ' *' : ''}</label>
                  <input
                    className="ga98-text"
                    value={draft.xmlMap?.[k] ?? ''}
                    placeholder={k === 'itemsPath' ? 'root.records.record' : k === 'lat' ? 'pos.@_lat' : ''}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      xmlMap: { itemsPath: '', lat: '', lon: '', ...d.xmlMap, [k]: e.target.value }
                    }))}
                  />
                </Fragment>
              ))}
            </div>
          )}
          <div className="field-row" style={{ marginTop: 6, gap: 4 }}>
            <button onClick={() => void addSource()} disabled={!draft.label || !draft.url}>Add</button>
            <button onClick={() => void importOpml()}>Import OPML…</button>
            <button onClick={() => void refresh()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => void confirmPurge()} title="Purge ALL GeoINT sources + cached events and reset the map (recovery escape hatch)"
              style={{ color: '#900', fontWeight: 'bold' }}>Purge cache</button>
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

        <fieldset style={{ marginTop: 6 }}>
          <legend>CCTV</legend>
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showCctv} onChange={(e) => setShowCctv(e.target.checked)} />
            CCTV cameras ({cctvStreams.length})
          </label>
          <button style={{ marginLeft: 8 }} onClick={() => void refreshCameras()} title="Reload the camera list from EyeSpy">Refresh</button>
        </fieldset>

        <fieldset>
          <legend>Threat Layers</legend>
          <p style={{ fontSize: 11, color: '#555', margin: '0 0 4px' }}>On-demand public feeds. Toggling a layer on fetches it now (network required); off drops it. Not cached.</p>
          {layerError && <p style={{ fontSize: 11, color: '#900', margin: '0 0 4px' }}>Layer error: {layerError}</p>}
          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('usgs')}
                disabled={!net || layerBusy === 'usgs'}
                onChange={(e) => void toggleLayer('usgs', e.target.checked, { feed: usgsFeed })}
              />
              USGS earthquakes
            </label>
            <select
              className="ga98-text"
              value={usgsFeed}
              disabled={!net || layerBusy === 'usgs'}
              onChange={(e) => {
                const feed = e.target.value;
                setUsgsFeed(feed);
                // If the layer is already on, re-fetch with the new timeframe so the change applies live.
                if (enabledLayers.has('usgs')) void toggleLayer('usgs', true, { feed });
              }}
              title="USGS feed / timeframe"
            >
              {USGS_FEED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {layerBusy === 'usgs' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>USGS — U.S. Public Domain</p>

          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('gdacs')}
                disabled={!net || layerBusy === 'gdacs'}
                onChange={(e) => void toggleLayer('gdacs', e.target.checked)}
              />
              GDACS disasters
            </label>
            {layerBusy === 'gdacs' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>GDACS — UN OCHA / EC-JRC</p>

          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('wartracker')}
                disabled={!net || layerBusy === 'wartracker'}
                onChange={(e) => void toggleLayer('wartracker', e.target.checked, { country: wtCountry })}
              />
              War-Tracker (OSINT)
            </label>
            <input
              className="ga98-text"
              style={{ width: 56 }}
              placeholder="ISO2"
              maxLength={2}
              value={wtCountry}
              disabled={!net || layerBusy === 'wartracker'}
              onChange={(e) => setWtCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              onBlur={() => { if (enabledLayers.has('wartracker')) void toggleLayer('wartracker', true, { country: wtCountry }); }}
              title="Optional ISO-3166 alpha-2 country filter (e.g. UA)"
            />
            {layerBusy === 'wartracker' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#900', margin: '4px 0 0' }}>War-Tracker — unverified social-OSINT (Telegram/LLM-classified)</p>

          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('gdelt')}
                disabled={!net || layerBusy === 'gdelt'}
                onChange={(e) => void toggleLayer('gdelt', e.target.checked, { query: gdeltQuery })}
              />
              GDELT DOC (news)
            </label>
            <input
              className="ga98-text"
              style={{ flex: 1, minWidth: 120 }}
              placeholder="GDELT query"
              maxLength={256}
              value={gdeltQuery}
              disabled={!net || layerBusy === 'gdelt'}
              onChange={(e) => setGdeltQuery(e.target.value)}
              onBlur={() => { if (enabledLayers.has('gdelt')) void toggleLayer('gdelt', true, { query: gdeltQuery }); }}
              title="GDELT DOC query (keywords / OR / quotes)"
            />
            {layerBusy === 'gdelt' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>GDELT DOC — news articles, COUNTRY-LEVEL location (not precise)</p>

          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('reliefweb')}
                disabled={!net || layerBusy === 'reliefweb'}
                onChange={(e) => void toggleLayer('reliefweb', e.target.checked)}
              />
              ReliefWeb disasters
            </label>
            {layerBusy === 'reliefweb' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>ReliefWeb — UN OCHA (links to source reports). Humanitarian — country-level; appname must be registered with ReliefWeb.</p>

          {/* ---- Keyed layers: each needs a per-user API key/token stored in the OS secret store.
               The toggle is disabled until a key is saved; the key is never echoed back. ---- */}
          <hr style={{ margin: '8px 0', borderColor: '#ccc' }} />
          <p style={{ fontSize: 11, color: '#555', margin: '0 0 4px' }}>Keyed layers — store your own API key (encrypted, kept on this device; never sent to the renderer).</p>

          {/* FIRMS */}
          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('firms')}
                disabled={!net || !hasKey.firms || layerBusy === 'firms'}
                onChange={(e) => void toggleLayer('firms', e.target.checked)}
              />
              NASA FIRMS fires
            </label>
            <input
              className="ga98-text"
              style={{ width: 150 }}
              type="password"
              placeholder={hasKey.firms ? 'key stored — replace' : 'MAP_KEY'}
              value={keyDraft.firms}
              onChange={(e) => setKeyDraft((d) => ({ ...d, firms: e.target.value }))}
              title="FIRMS MAP_KEY (free, email-issued at firms.modaps.eosdis.nasa.gov)"
            />
            <button disabled={keySaving === 'firms'} onClick={() => void saveLayerKey('firms')}>Save</button>
            {layerBusy === 'firms' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>
            {hasKey.firms ? 'NASA FIRMS — open, cite-on-use' : 'Needs a free MAP_KEY (email-issued). NASA FIRMS — open, cite-on-use.'}
          </p>

          {/* gdeltcloud */}
          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('gdeltcloud')}
                disabled={!net || !hasKey.gdeltcloud || layerBusy === 'gdeltcloud'}
                onChange={(e) => void toggleLayer('gdeltcloud', e.target.checked, { query: gdeltQuery })}
              />
              gdeltcloud (3rd-party)
            </label>
            <input
              className="ga98-text"
              style={{ width: 150 }}
              type="password"
              placeholder={hasKey.gdeltcloud ? 'key stored — replace' : 'API key'}
              value={keyDraft.gdeltcloud}
              onChange={(e) => setKeyDraft((d) => ({ ...d, gdeltcloud: e.target.value }))}
              title="gdeltcloud.com API key (Bearer token)"
            />
            <button disabled={keySaving === 'gdeltcloud'} onClick={() => void saveLayerKey('gdeltcloud')}>Save</button>
            {layerBusy === 'gdeltcloud' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#900', margin: '4px 0 0' }}>Routes your queries through gdeltcloud (a third party that sees them).</p>

          {/* UCDP */}
          <div className="field-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={enabledLayers.has('ucdp')}
                disabled={!net || !hasKey.ucdp || layerBusy === 'ucdp'}
                onChange={(e) => void toggleLayer('ucdp', e.target.checked)}
              />
              UCDP GED conflict
            </label>
            <input
              className="ga98-text"
              style={{ width: 150 }}
              type="password"
              placeholder={hasKey.ucdp ? 'token stored — replace' : 'access token'}
              value={keyDraft.ucdp}
              onChange={(e) => setKeyDraft((d) => ({ ...d, ucdp: e.target.value }))}
              title="UCDP access token (x-ucdp-access-token; request from UCDP)"
            />
            <button disabled={keySaving === 'ucdp'} onClick={() => void saveLayerKey('ucdp')}>Save</button>
            {layerBusy === 'ucdp' && <span style={{ fontSize: 11, color: '#555' }}>loading…</span>}
          </div>
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>
            UCDP GED — CC BY 4.0. Cite: Davies, Pettersson &amp; Öberg (2026) JPR; Sundberg &amp; Melander (2013) JPR 50(4).
          </p>
        </fieldset>

        <fieldset>
          <legend>CISA KEV / Alerts</legend>
          <p style={{ fontSize: 11, color: '#555', margin: '0 0 4px' }}>
            CISA Known Exploited Vulnerabilities — an advisory catalog (no map location). On-demand; not cached.
          </p>
          <div className="field-row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <button onClick={() => void refreshKev()} disabled={!net || kevBusy}>{kevBusy ? 'Loading…' : 'Refresh'}</button>
            <span style={{ fontSize: 11, color: '#555' }}>{kev.length > 0 ? `${kev.length} entries` : ''}</span>
          </div>
          {kev.length > 0 && (
            <ul className="ga98-list" style={{ maxHeight: 180, overflow: 'auto' }}>
              {kev.map((k) => {
                const ransom = k.knownRansomwareCampaignUse === 'Known';
                return (
                  <li key={k.cveID} title={k.shortDescription} style={{ display: 'block', padding: '2px 0' }}>
                    <button
                      onClick={() => void window.api.system.openExternal(`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(k.cveID)}`)}
                      style={{ minWidth: 0, padding: '0 4px', fontWeight: 'bold' }}
                      title="Open the CVE on NVD"
                    >
                      {k.cveID}
                    </button>
                    {ransom && (
                      <span style={{ marginLeft: 6, background: '#c0392b', color: '#fff', fontSize: 9, padding: '0 4px', fontWeight: 'bold' }}>
                        RANSOMWARE
                      </span>
                    )}
                    <div style={{ fontSize: 11, color: '#333' }}>
                      <span style={{ opacity: 0.7 }}>{k.vendorProject} {k.product}</span> — {k.vulnerabilityName}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p style={{ fontSize: 10, color: '#777', margin: '4px 0 0' }}>CISA KEV — U.S. Public Domain</p>
        </fieldset>

        <fieldset style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <legend>Events ({itemsTotal > MAX_ITEMS ? `${items.length} of ${itemsTotal}` : items.length})</legend>
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

      <div className="ga98-pane ga98-geo-right" style={{ padding: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* MapGL stays mounted under the Street View overlay so its globe state + center tracking
            survive toggling Street View on/off. The timeline/story bars sit below it. */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <MapGL items={mapItems} corroboration={corroboration} tilesEnabled={net} tileUrl={activeTileUrl} tileAttribution={activeTileAttribution}
            pickMode={pickFor != null} onPick={(la, lo) => void onPick(la, lo)} focusId={focusId} flyTo={flyTo}
            onCenterChange={(lat, lon) => setCenter({ lat, lon })} overlayUrls={overlayUrls} overlayAttribution={LABELS_ATTRIBUTION}
            cctvStreams={cctvStreams} showCctv={showCctv} onCameraOpen={onCameraOpen} />
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
        {/* Story transport floats over the map (top-center) so the pause/stop controls
            stay unmissable during playback. Content-width + inline-flex so the map under
            it stays draggable; z-index sits above Leaflet tiles/markers (panes 200–500)
            but below Leaflet's own zoom control (800+). */}
        {story && (
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 600, display: 'inline-flex', background: 'var(--ga98-face,#c0c0c0)', border: '2px outset #fff', padding: 2, boxShadow: '0 1px 4px rgba(0,0,0,.4)' }}>
            <StoryControls
              count={storyItems.length}
              index={story.index}
              playing={story.playing}
              onPlay={() => setStory((s) => (s ? { ...s, playing: true } : s))}
              onPause={() => setStory((s) => (s ? { ...s, playing: false } : s))}
              onPrev={() => setStory((s) => (s ? { index: Math.max(0, s.index - 1), playing: false } : s))}
              onNext={() => setStory((s) => (s ? { index: Math.min(storyItems.length - 1, s.index + 1), playing: false } : s))}
              onStop={() => setStory(null)}
            />
          </div>
        )}
        </div>
        <TimelineBar
          bounds={bounds}
          cursor={timeCursor}
          playing={timePlaying}
          onCursor={(t) => { setTimePlaying(false); setTimeCursor(t); }}
          onTogglePlay={() => setTimePlaying((p) => !p)}
          onAll={() => { setTimePlaying(false); if (bounds) setTimeCursor(bounds.max); }}
        />
      </div>
      {/* Command-center right rail — 3rd column. All data is owned by this module and passed down;
          the rail mirrors handlers rather than duplicating logic. */}
      <CommandRail
        visibleItems={visibleItems}
        corroboration={corroboration}
        onFocus={(id) => setFocusId(id)}
        categoryFilter={enabledCategories}
        onToggleCategory={toggleCategory}
        basemap={basemap}
        onBasemap={(b) => { patchGeo({ basemap: b }); setStreetView(false); }}
        labels={labels}
        onLabels={setLabels}
        net={net}
      />
      {saveItem && <SaveEventDialog item={saveItem} onClose={() => setSaveItem(null)} />}
    </div>
  );
}

// Thin wrapper: the error boundary wraps the ENTIRE module render tree, not just MapPane. The
// crash that motivated this (timeBounds spreading 130k+ timestamps as call args, RangeError) threw
// in GeoIntModuleInner's own body — ABOVE where the old boundary sat — so the whole module white-
// screened with neither recovery button on screen. With the boundary here, ANY render-time throw in
// the inner body (timeBounds, corroborate, MapPane, anything) lands on the recovery UI. On recovery,
// hardPurge clears the on-disk cache, then bumps resetKey so Inner remounts fresh against the purged
// state — a clean mount rather than re-running against the data that just threw.
export function GeoIntModule(): JSX.Element {
  const [resetKey, setResetKey] = useState(0);
  const patch = useSettings((s) => s.patch);
  const hardPurge = useCallback(async () => {
    // Two-part recovery. (1) Purge the on-disk source cache (the FIRMS-style poisoned event set).
    try { await window.api.geoint.purgeCache(); } catch { /* purge is best-effort recovery */ }
    // (2) Reset the persisted geoint SETTINGS to type-defaults. A bad persisted setting value is the
    //     one poison class that survives BOTH reinstall (settings live in AppData) AND purgeCache
    //     (which only touches the cache) — and it would make the inner render re-throw immediately on
    //     remount. Overwriting with known-good defaults clears it. Network goes back to off (its
    //     default); one click re-enables it and the default tiles auto-populate.
    try { await patch({ geoint: { networkEnabled: false, tileServerUrl: '', tileAttribution: '', basemap: 'street', newsStreams: [{ label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' }], newsStreamIndex: 0 } }); }
    catch { /* best-effort */ }
    setResetKey((k) => k + 1); // remount Inner fresh against purged + reset state
  }, [patch]);
  return (
    <MapErrorBoundary onPurge={hardPurge}>
      <GeoIntModuleInner key={resetKey} />
    </MapErrorBoundary>
  );
}
