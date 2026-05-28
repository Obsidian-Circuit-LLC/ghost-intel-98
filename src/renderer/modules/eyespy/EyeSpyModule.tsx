/**
 * EyeSpy — view manually-added camera streams.
 * Supported: HLS (hls.js), MJPEG (<img>), and HTTP still images.
 * RTSP is intentionally not implemented in-app (would require bundling ffmpeg) — the user is
 * pointed to a recommended local ffmpeg→HLS bridge instead. NO discovery, scanning, or
 * unauthorised-access code paths exist in this module.
 */

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraStream, StreamKind } from '@shared/post-mvp-types';
import type { CaseSummary } from '@shared/types';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

export function EyeSpyModule(): JSX.Element {
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selected, setSelected] = useState<CameraStream | null>(null);
  const [draft, setDraft] = useState<Partial<CameraStream>>({ kind: 'hls', label: '', url: '' });

  const refresh = useCallback(async () => {
    setStreams(await window.api.streams.list());
    setCases(await window.api.cases.list());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save(): Promise<void> {
    if (!draft.url || !draft.label) return;
    const created = await window.api.streams.upsert({
      url: draft.url,
      label: draft.label,
      kind: draft.kind as StreamKind,
      caseId: draft.caseId ?? null,
      notes: draft.notes ?? ''
    });
    setDraft({ kind: 'hls', label: '', url: '' });
    await refresh();
    setSelected(created);
  }

  async function del(id: string): Promise<void> {
    const ok = await confirmDialog('Delete this stream?', 'Delete stream');
    if (!ok) return;
    try {
      await window.api.streams.delete(id);
      setSelected(null);
      await refresh();
      toast.success('Stream deleted.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane">
        <fieldset>
          <legend>Add stream</legend>
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
          <div style={{ marginTop: 6 }}>
            <button onClick={() => void save()} disabled={!draft.url || !draft.label}>Add</button>
          </div>
        </fieldset>
        <ul className="ga98-list">
          {streams.map((s) => (
            <li key={s.id} data-selected={selected?.id === s.id} onClick={() => setSelected(s)}>
              <span style={{ flex: 1 }}>
                <b>{s.label}</b>
                <div style={{ fontSize: 10, opacity: 0.7 }}>{s.kind.toUpperCase()} · {s.url}</div>
              </span>
              <button onClick={(e) => { e.stopPropagation(); void del(s.id); }}>×</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ga98-pane" style={{ background: '#000' }}>
        {selected ? <Viewer stream={selected} /> : <div style={{ color: '#aaa', padding: 16 }}>Select a stream.</div>}
      </div>
    </div>
  );
}

function Viewer({ stream }: { stream: CameraStream }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgTick, setImgTick] = useState(0);

  useEffect(() => {
    if (stream.kind === 'http') {
      const t = setInterval(() => setImgTick((n) => n + 1), 2000);
      return () => clearInterval(t);
    }
    return;
  }, [stream.kind]);

  useEffect(() => {
    if (stream.kind !== 'hls') return;
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(stream.url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = stream.url;
    return;
  }, [stream.kind, stream.url]);

  if (stream.kind === 'rtsp') {
    return (
      <div style={{ color: '#fff', padding: 16, fontSize: 12 }}>
        RTSP streams cannot be played directly in the browser. Run a local
        <code style={{ margin: '0 4px' }}>ffmpeg → HLS</code>
        bridge on your network and add the resulting <code>.m3u8</code> URL as an HLS stream.
        <br /><br />
        Example:
        <pre style={{ background: '#222', padding: 8, marginTop: 8 }}>
{`ffmpeg -rtsp_transport tcp -i ${stream.url} \\
  -c:v copy -f hls -hls_time 2 -hls_list_size 3 \\
  /var/www/cam.m3u8`}
        </pre>
      </div>
    );
  }

  if (stream.kind === 'mjpeg') {
    return <img alt={stream.label} src={stream.url} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  }

  if (stream.kind === 'http') {
    const sep = stream.url.includes('?') ? '&' : '?';
    return <img alt={stream.label} src={`${stream.url}${sep}_t=${imgTick}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  }

  if (stream.kind === 'mp4') {
    // Direct progressive/streamed MP4 over http(s). CSP media-src allows http(s); a
    // local file:// path would not load (not in media-src) — point users to a URL.
    return <video controls autoPlay muted loop src={stream.url} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  }

  return <video ref={videoRef} controls autoPlay muted style={{ maxWidth: '100%', maxHeight: '100%' }} />;
}
