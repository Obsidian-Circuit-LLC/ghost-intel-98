/**
 * EyeSpy — view manually-added camera streams.
 * Supported: HLS (hls.js), MJPEG (<img>), and HTTP still images.
 * RTSP is intentionally not implemented in-app (would require bundling ffmpeg) — the user is
 * pointed to a recommended local ffmpeg→HLS bridge instead. NO discovery, scanning, or
 * unauthorised-access code paths exist in this module. "Import feeds…" bulk-loads the user's
 * OWN feed list from a file they choose (CSV/JSON/URL-list) — it parses a provided file, it
 * does not probe or enumerate any network.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CameraStream, StreamKind } from '@shared/post-mvp-types';
import type { CaseSummary } from '@shared/types';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { Viewer } from './Viewer';
import { buildTree, filterTree, matchStream, findNode } from './tree';
import type { TreeNode } from './tree';
import { LocationTree } from './LocationTree';
import { CameraGrid } from './CameraGrid';

/** Geo stamp from a tree node's explicit geo fields. null node = no stamp. */
function nodeStamp(n: TreeNode | null): { country?: string; region?: string; city?: string } | undefined {
  return n ? { country: n.country, region: n.region, city: n.city } : undefined;
}

export function EyeSpyModule(): JSX.Element {
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [expanded, setExpanded] = useState<CameraStream | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [draft, setDraft] = useState<Partial<CameraStream>>({ kind: 'hls', label: '', url: '' });

  const fullTree = useMemo(() => buildTree(streams), [streams]);
  const tree = useMemo(() => filterTree(fullTree, streams, query), [fullTree, streams, query]);
  const selectedNode = useMemo(() => (selectedKey ? findNode(fullTree, selectedKey) : null), [fullTree, selectedKey]);
  const shown = useMemo(() => {
    const base = selectedNode ? streams.filter((s) => new Set(selectedNode.streamIds).has(s.id)) : streams;
    const q = query.trim().toLowerCase();
    return q ? base.filter((s) => matchStream(s, q)) : base;
  }, [streams, selectedNode, query]);

  const refresh = useCallback(async () => {
    setStreams(await window.api.streams.list());
    setCases(await window.api.cases.list());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save(): Promise<void> {
    if (!draft.url || !draft.label) return;
    await window.api.streams.upsert({
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
  }

  /** Load an existing stream into the form for editing (save() updates it by id). */
  function edit(s: CameraStream): void {
    setDraft({ id: s.id, label: s.label, url: s.url, kind: s.kind, caseId: s.caseId, notes: s.notes });
    setShowForm(true);
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

  async function del(id: string): Promise<void> {
    const ok = await confirmDialog('Delete this stream?', 'Delete stream');
    if (!ok) return;
    try {
      await window.api.streams.delete(id);
      setExpanded((e) => (e && e.id === id ? null : e));
      await refresh();
      toast.success('Stream deleted.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane">
        <LocationTree
          nodes={tree}
          selectedKey={selectedKey}
          query={query}
          onQuery={setQuery}
          onSelect={(n) => { setSelectedKey(n?.key ?? null); setExpanded(null); }}
        />
      </div>
      <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
          <span style={{ flex: 1, fontSize: 11 }}>
            {selectedNode ? `${selectedNode.label} · ${shown.length}` : `All cameras · ${shown.length}`}
          </span>
          <button onClick={() => void importFeeds(nodeStamp(selectedNode))} disabled={!selectedNode}
            title="Bulk-import your own feeds, stamping the selected location onto any feed in the file that has no geo of its own">Import here</button>
          <button onClick={() => void importFeeds()}
            title="Bulk-import your own camera feeds from a CSV, JSON, or plain URL-list file">Import feeds…</button>
          <button onClick={() => void purge()} disabled={streams.length === 0}
            title="Delete every stream in the library">Purge all…</button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {expanded ? (
            <div style={{ flex: 1, height: '100%', background: '#000', position: 'relative' }}>
              <div style={{ position: 'absolute', zIndex: 1, margin: 4, display: 'flex', gap: 4 }}>
                <button onClick={() => setExpanded(null)}>← Back</button>
                <button onClick={() => edit(expanded)} title="Edit this stream">Edit…</button>
              </div>
              <Viewer stream={expanded} />
            </div>
          ) : (
            <CameraGrid
              streams={shown}
              onExpand={setExpanded}
              onAdd={() => { setDraft({ kind: 'hls', label: '', url: '' }); setShowForm(true); }}
              onDelete={(s) => void del(s.id)}
            />
          )}
        </div>

        {showForm && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <fieldset style={{ background: 'var(--ga98-face, #c0c0c0)', maxWidth: 480, width: '90%' }}>
              <legend>{draft.id ? 'Edit stream' : 'Add stream'}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 4 }}>
                <label>Label:</label>
                <input className="ga98-text" value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                <label>URL:</label>
                <input className="ga98-text" value={draft.url ?? ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://… or rtsp://… or http://cam/mjpg" />
                <label>Kind:</label>
                <select className="ga98-text" value={draft.kind ?? 'hls'} onChange={(e) => setDraft({ ...draft, kind: e.target.value as StreamKind })}>
                  <option value="hls">HLS (.m3u8)</option>
                  <option value="mp4">MP4 (.mp4 video)</option>
                  <option value="mjpeg">MJPEG (multipart)</option>
                  <option value="http">HTTP image (refreshing)</option>
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
                <button onClick={() => { setShowForm(false); setDraft({ kind: 'hls', label: '', url: '' }); }}>Cancel</button>
                {draft.id && <button onClick={() => { void del(draft.id as string); setShowForm(false); }}>Delete</button>}
              </div>
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}
