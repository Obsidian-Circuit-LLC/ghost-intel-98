/**
 * EyeSpy — view manually-added camera streams on a curated 3×3 video wall.
 * Left: Finder (Countries/Cities tree + feed list, contextual Import). Right: named Wall boards.
 * Supported: HLS (hls.js), MJPEG (<img>), HTTP still images, MP4, and "webpage" — the camera's
 * own HTML viewer page (e.g. an .shtml MJPEG viewer). The webpage kind does NOT embed third-party
 * pages in-app; it opens the user-supplied viewer page in the bundled Firefox (process-isolated
 * from the app). It does not probe, scan, or enumerate anything.
 * RTSP is intentionally not implemented in-app (would require bundling ffmpeg) — the user is
 * pointed to a recommended local ffmpeg→HLS bridge instead. NO discovery, scanning, or
 * unauthorised-access code paths exist in this module. "Import…" bulk-loads the user's OWN feed
 * list from a file they choose (CSV/JSON/URL-list) — it parses a provided file, it does not
 * probe or enumerate any network.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CameraStream, StreamKind, Wall } from '@shared/post-mvp-types';
import { parseYouTubeId } from '@shared/youtube';
import type { CaseSummary } from '@shared/types';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { useWindows } from '../../state/store';
import { Viewer } from './Viewer';
import { buildTree, filterTree, matchStream, findNode, citiesOf } from './tree';
import type { TreeNode } from './tree';
import { Finder } from './Finder';
import type { FeedAction } from './Finder';
import { Wall as WallView } from './Wall';
import { SetLocationDialog } from './SetLocationDialog';
import { WallSetupDialog } from './WallSetupDialog';
import type { WallSetupCfg } from './WallSetupDialog';
import { emptyWall, assignToSlot, clearSlot, addStreams } from './wall';

/** Geo stamp from a tree node's explicit geo fields. null node = no stamp. */
function nodeStamp(n: TreeNode | null): { country?: string; region?: string; city?: string } | undefined {
  return n ? { country: n.country, region: n.region, city: n.city } : undefined;
}

export function EyeSpyModule(): JSX.Element {
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [wallsList, setWallsList] = useState<Wall[]>([]);
  const [wall, setWall] = useState<Wall>(() => emptyWall(`wall-${Date.now()}`, 'Untitled wall', new Date().toISOString()));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [columns, setColumns] = useState<number>(3);
  const [tab, setTab] = useState<'countries' | 'cities'>('countries');
  const [query, setQuery] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<CameraStream | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [draft, setDraft] = useState<Partial<CameraStream>>({ kind: 'hls', label: '', url: '' });
  // When the Add-stream form was opened from the wall's "Add new feed" tile, the new stream is placed
  // onto the wall after saving. `addTarget` is the slot to fill (from an empty tile) or null = the
  // trailing add tile (append / first empty). undefined = the form wasn't opened from the wall.
  const [addTarget, setAddTarget] = useState<number | null | undefined>(undefined);
  const [setLocTargets, setSetLocTargets] = useState<CameraStream[] | null>(null);
  const [wallSetup, setWallSetup] = useState<{ mode: 'new' | 'edit' } | null>(null);
  const [detecting, setDetecting] = useState<boolean>(false);

  const fullTree = useMemo(() => buildTree(streams), [streams]);
  const tree = useMemo(() => filterTree(fullTree, streams, query), [fullTree, streams, query]);
  const selectedNode = useMemo(() => (selectedKey ? findNode(fullTree, selectedKey) : null), [fullTree, selectedKey]);
  const cities = useMemo(() => citiesOf(streams), [streams]);
  const byId = useMemo(() => new Map(streams.map((s) => [s.id, s] as const)), [streams]);
  const feeds = useMemo(() => {
    // A Cities-tab node carries no streamIds (Finder builds a synthetic node), so for it we match
    // by geo instead of by id; a normal node filters by its streamIds set.
    const base = !selectedNode ? streams
      : selectedNode.streamIds.length ? streams.filter((s) => new Set(selectedNode.streamIds).has(s.id))
      : streams.filter((s) => (s.city ?? '') === (selectedNode.city ?? '') && (s.country ?? '') === (selectedNode.country ?? ''));
    const q = query.trim().toLowerCase();
    return q ? base.filter((s) => matchStream(s, q)) : base;
  }, [streams, selectedNode, query]);
  const importLabel = selectedNode ? `Import to ${selectedNode.label}…` : 'Import…';

  const refresh = useCallback(async () => {
    setStreams(await window.api.streams.list());
    setCases(await window.api.cases.list());
  }, []);

  const refreshWalls = useCallback(async () => {
    setWallsList(await window.api.walls.list());
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      const list = await window.api.walls.list();
      setWallsList(list);
      const latest = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (latest) setWall(latest);
      // else: keep the in-memory emptyWall seeded in useState (persisted on first change).
    })();
  }, [refresh]);

  const wallRef = useRef(wall);
  useEffect(() => { wallRef.current = wall; }, [wall]);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const persistWall = useCallback((next: Wall) => {
    const stamped: Wall = { ...next, updatedAt: new Date().toISOString() };
    wallRef.current = stamped;          // so the next synchronous mutation builds on this, not stale state
    setWall(stamped);                   // optimistic UI
    saveChain.current = saveChain.current
      .then(() => window.api.walls.save(stamped))
      .then(() => refreshWalls())
      .catch((e) => toast.error(`Wall save failed: ${(e as Error).message}`));
  }, [refreshWalls]);

  async function save(): Promise<void> {
    if (!draft.url || !draft.label) return;
    // A YouTube feed must be a real, host-checked YouTube URL or it can't be framed.
    if (draft.kind === 'youtube' && !parseYouTubeId((draft.url ?? '').trim())) {
      toast.error('Not a parseable YouTube URL (watch?v=…, youtu.be/…, or /live/…).');
      return;
    }
    const isNew = !draft.id;
    const saved = await window.api.streams.upsert({
      // Carrying the existing id turns this into an in-place edit; absent id → new stream.
      id: draft.id,
      url: draft.url,
      label: draft.label,
      kind: draft.kind as StreamKind,
      caseId: draft.caseId ?? null,
      notes: draft.notes ?? ''
    });
    setDraft({ kind: 'hls', label: '', url: '' });
    setShowForm(false);
    await refresh();
    // If this add was launched from the wall (addTarget defined), place the new feed onto the wall at
    // the clicked slot (or append for the trailing tile) and select it — so "Add new feed" actually
    // lands the feed where the tile implies, not on whatever slot was last active.
    if (isNew && addTarget !== undefined) {
      const r = assignToSlot(wallRef.current, addTarget, saved.id);
      setActiveSlot(r.placed);
      persistWall(r.wall);
    }
    setAddTarget(undefined);
  }

  /** Probe the entered URL to figure out the real stream kind + media endpoint. A bare camera root
   *  (e.g. an insecam IP:port) usually serves an HTML viewer page, not a stream — detect finds the
   *  actual MJPEG/JPEG endpoint and fills in the kind + corrected URL so the feed plays inline
   *  instead of bouncing to Firefox. User-triggered egress to the camera host (see stream-detect.ts). */
  async function detect(): Promise<void> {
    const url = (draft.url ?? '').trim();
    if (!url) return;
    setDetecting(true);
    try {
      const hit = await window.api.streams.detect(url);
      if (!hit) { toast.warn('No stream detected — pick the kind manually, or try the camera’s video path.'); return; }
      setDraft((d) => ({ ...d, kind: hit.kind, url: hit.url }));
      toast.success(`Detected ${hit.kind.toUpperCase()}${hit.url !== url ? ' — URL updated to the stream endpoint.' : '.'}`);
    } catch (err) {
      toast.error(`Detect failed: ${(err as Error).message}`);
    } finally {
      setDetecting(false);
    }
  }

  /** Purge the entire library in one atomic write (confirmed). */
  async function purge(): Promise<void> {
    const ok = await confirmDialog(`Delete ALL ${streams.length} streams? This cannot be undone.`, 'Purge all streams');
    if (!ok) return;
    try {
      const removed = await window.api.streams.clear();
      setExpanded(null);
      setDraft({ kind: 'hls', label: '', url: '' });
      await refresh();
      toast.success(`Purged ${removed} stream${removed === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(`Purge failed: ${(err as Error).message}`);
    }
  }

  async function importFeeds(stamp?: { country?: string; region?: string; city?: string }): Promise<void> {
    try {
      const r = await window.api.streams.import(stamp);
      await refresh();
      if (r.total === 0) { toast.warn('No camera feeds found in that file.'); return; }
      toast.success(`Imported ${r.added} feed${r.added === 1 ? '' : 's'}${r.skipped ? ` · skipped ${r.skipped} (duplicate/invalid)` : ''}.`);
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    }
  }

  async function del(id: string): Promise<boolean> {
    const ok = await confirmDialog('Delete this stream?', 'Delete stream');
    if (!ok) return false;
    try {
      await window.api.streams.delete(id);
      setExpanded((e) => (e && e.id === id ? null : e));
      await refresh();
      toast.success('Stream deleted.');
      return true;
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
      return false;
    }
  }

  function onFeedAction(action: FeedAction, s: CameraStream): void {
    switch (action) {
      case 'add': {
        // assignToSlot now appends when the wall is full (unlimited wall), so there is no full case.
        const r = assignToSlot(wallRef.current, activeSlot, s.id);
        setActiveSlot(r.placed);
        persistWall(r.wall);
        break;
      }
      case 'play': setExpanded(s); break;
      case 'edit':
        setDraft({ id: s.id, label: s.label, url: s.url, kind: s.kind, caseId: s.caseId, notes: s.notes });
        setShowForm(true);
        break;
      case 'setloc': setSetLocTargets([s]); break;
      case 'delete':
        void (async () => {
          const removed = await del(s.id);
          if (removed && wallRef.current.slots.includes(s.id)) {
            persistWall({ ...wallRef.current, slots: wallRef.current.slots.map((x) => (x === s.id ? null : x)) });
          }
        })();
        break;
      case 'resolve': {
        const id = `hostinfo:${s.id}`;
        const existing = useWindows.getState().windows.find((w) => w.id === id);
        if (existing) useWindows.getState().focus(existing.id);
        else useWindows.getState().open({ module: 'host-info', id, title: `Host: ${s.label}`, props: { stream: s }, width: 460, height: 360 });
        break;
      }
    }
  }

  const applyLoc = async (geo: { country: string; region: string; city: string; coords?: { lat?: number; lon?: number } }): Promise<void> => {
    // Spread ...t to preserve label/url/kind/etc. Multi-target: no `coords` key ⇒ each camera's
    // existing lat/lon is preserved. Single-target: `coords` is authoritative — set OR clear (the
    // service's pickGeo drops undefined/out-of-range coords).
    for (const t of setLocTargets!) {
      const base: Partial<CameraStream> & { url: string; label: string; kind: CameraStream['kind'] } =
        { ...t, country: geo.country, region: geo.region, city: geo.city };
      if (geo.coords) { base.lat = geo.coords.lat; base.lon = geo.coords.lon; }
      await window.api.streams.upsert(base);
    }
    setSetLocTargets(null);
    await refresh();
  };

  const onImport = (): void => void importFeeds(selectedNode ? nodeStamp(selectedNode) : undefined);

  function newWall(): void {
    setWallSetup({ mode: 'new' });
  }

  async function openWall(id: string): Promise<void> {
    const w = await window.api.walls.get(id);
    if (w) { setWall(w); setActiveSlot(null); }
  }

  function renameWall(): void {
    setWallSetup({ mode: 'edit' });
  }

  /** Wall Setup submit — New creates a fresh board; Rename patches the current one. */
  function onWallSetup({ name, country, region, city }: WallSetupCfg): void {
    if (wallSetup?.mode === 'new') {
      const base = emptyWall(`wall-${Date.now()}`, name, new Date().toISOString());
      setActiveSlot(null);
      persistWall({ ...base, country, region, city });
    } else {
      persistWall({ ...wallRef.current, name, country, region, city });
    }
    setWallSetup(null);
  }

  /** Import a whole CCTV feed file stamped under this wall's Country/State/City category. */
  function onWallImportHere(cfg: WallSetupCfg): void {
    void importFeeds({ country: cfg.country || undefined, region: cfg.region || undefined, city: cfg.city || undefined });
  }

  async function deleteWall(): Promise<void> {
    const ok = await confirmDialog(`Delete wall "${wall.name}"?`, 'Delete wall');
    if (!ok) return;
    await window.api.walls.delete(wall.id);
    const list = await window.api.walls.list();
    setWallsList(list);
    const next = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (next) { setWall(next); } else { setWall(emptyWall(`wall-${Date.now()}`, 'Untitled wall', new Date().toISOString())); }
    setActiveSlot(null);
  }

  function fillFromNode(): void {
    if (!selectedNode) return;
    // Unlimited: fill from ALL of the node's stream ids (no 9-slot cap).
    persistWall(addStreams(wallRef.current, selectedNode.streamIds));
  }

  return (
    <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane">
        <Finder
          tab={tab} onTab={setTab} query={query} onQuery={setQuery} tree={tree} cities={cities} feeds={feeds}
          selectedKey={selectedKey} onSelectNode={(n) => { setSelectedKey(n?.key ?? null); setExpanded(null); }}
          onFeedAction={onFeedAction} onRefresh={() => void refresh()} onImport={onImport} importLabel={importLabel}
        />
      </div>
      <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column', padding: 0, position: 'relative' }}>
        {/* flexWrap so the wall controls (incl. the long "Fill wall from …" + Purge buttons) wrap
            to a second row on a narrow pane instead of overflowing off the right edge / forcing a scroll. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, borderBottom: '1px solid #ccc', alignItems: 'center' }}>
          <button onClick={newWall}>New</button>
          <select value={wall.id} onChange={(e) => void openWall(e.target.value)}>
            {wallsList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            {!wallsList.some((w) => w.id === wall.id) && <option value={wall.id}>{wall.name}</option>}
          </select>
          <button onClick={renameWall}>Rename</button>
          <button onClick={() => void deleteWall()} disabled={wallsList.length === 0}>Delete</button>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12 }}>Cols:{' '}
            <select value={columns} onChange={(e) => setColumns(Number(e.target.value))} title="Number of columns in the camera wall">
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button onClick={fillFromNode} disabled={!selectedNode}>Fill wall from {selectedNode ? selectedNode.label : '…'}</button>
          <button onClick={() => void purge()} disabled={streams.length === 0}>Purge all…</button>
        </div>
        {expanded ? (
          <div style={{ flex: 1, background: '#000', position: 'relative' }}>
            <button onClick={() => setExpanded(null)} style={{ position: 'absolute', zIndex: 1, margin: 4 }}>← Back</button>
            <Viewer stream={expanded} />
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <WallView
              slots={wall.slots} byId={byId} activeSlot={activeSlot} columns={columns} onActivate={setActiveSlot}
              onClearSlot={(i) => persistWall(clearSlot(wallRef.current, i))}
              onAddNew={(target) => { setAddTarget(target ?? null); setDraft({ kind: 'hls', label: '', url: '' }); setShowForm(true); }}
              onExpand={setExpanded}
            />
          </div>
        )}

        {showForm && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <fieldset style={{ background: 'var(--ga98-face, #c0c0c0)', maxWidth: 480, width: '90%' }}>
              <legend>{draft.id ? 'Edit stream' : 'Add stream'}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 4 }}>
                <label>Label:</label>
                <input className="ga98-text" value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                <label>URL:</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input className="ga98-text" style={{ flex: 1 }} value={draft.url ?? ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                    placeholder="https://… or rtsp://… or http://cam/mjpg … or http://cam/view/index.shtml" />
                  <button onClick={() => void detect()} disabled={detecting || !(draft.url ?? '').trim()}
                    title="Probe this URL to find the real stream format + endpoint (for cameras whose page isn't a direct stream)">
                    {detecting ? 'Detecting…' : 'Detect'}
                  </button>
                </div>
                <label>Kind:</label>
                <select className="ga98-text" value={draft.kind ?? 'hls'} onChange={(e) => setDraft({ ...draft, kind: e.target.value as StreamKind })}>
                  <option value="hls">HLS (.m3u8)</option>
                  <option value="mp4">MP4 (.mp4 video)</option>
                  <option value="mjpeg">MJPEG (multipart)</option>
                  <option value="http">HTTP image (refreshing)</option>
                  <option value="webpage">Webpage / viewer page (opens in Firefox)</option>
                  <option value="youtube">YouTube (live / video)</option>
                  <option value="rtsp">RTSP (requires local bridge)</option>
                </select>
                <label>Case:</label>
                <select className="ga98-text" value={draft.caseId ?? ''} onChange={(e) => setDraft({ ...draft, caseId: e.target.value || null })}>
                  <option value="">(none)</option>
                  {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button onClick={() => void save()} disabled={!draft.url || !draft.label}>{draft.id ? 'Save changes' : 'Add'}</button>
                <button onClick={() => { setShowForm(false); setDraft({ kind: 'hls', label: '', url: '' }); setAddTarget(undefined); }}>Cancel</button>
                {draft.id && <button onClick={() => { void del(draft.id as string); setShowForm(false); }}>Delete</button>}
              </div>
            </fieldset>
          </div>
        )}

        {setLocTargets && <SetLocationDialog targets={setLocTargets} onApply={(g) => void applyLoc(g)} onClose={() => setSetLocTargets(null)} />}

        {wallSetup && (
          <WallSetupDialog
            title={wallSetup.mode === 'new' ? 'New wall' : 'Wall setup'}
            initial={wallSetup.mode === 'edit'
              ? { name: wallRef.current.name, country: wallRef.current.country, region: wallRef.current.region, city: wallRef.current.city }
              : undefined}
            onSubmit={onWallSetup}
            onImportHere={onWallImportHere}
            onClose={() => setWallSetup(null)}
          />
        )}
      </div>
    </div>
  );
}
