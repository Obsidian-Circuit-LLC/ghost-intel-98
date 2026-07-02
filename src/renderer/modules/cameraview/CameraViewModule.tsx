/**
 * CCTV quick-view window — a thin wrapper that plays one camera stream in its own draggable Win98
 * window, opened from a GeoINT camera pin. Reuses the EyeSpy Viewer verbatim; the only chrome is a
 * one-line header naming the camera and its location.
 */

import { useState } from 'react';
import type { CameraStream, StreamKind } from '@shared/post-mvp-types';
import { Viewer } from '../eyespy/Viewer';
import { HostInfoView } from '../hostinfo/HostInfoView';

/** "<label> — <city · region · country>" using only the location parts that are present. */
export function cameraHeaderText(stream: CameraStream): string {
  const loc = [stream.city, stream.region, stream.country].filter((p) => p && p.trim()).join(' · ');
  return loc ? `${stream.label} — ${loc}` : stream.label;
}

/**
 * Infer the stream kind from a pasted URL — a trimmed local copy of the EyeSpy import heuristic
 * (src/main/services/feed-import.ts). Inlined rather than imported so the renderer bundle doesn't
 * reach into main-process code. Egress is unchanged: the constructed stream flows through the exact
 * same Viewer path an EyeSpy/GeoINT-launched stream does.
 */
function inferStreamKind(url: string): StreamKind {
  const u = url.toLowerCase();
  if (u.startsWith('rtsp://')) return 'rtsp';
  if (u.includes('.m3u8')) return 'hls';
  if (u.includes('.mp4')) return 'mp4';
  if (/\.(jpg|jpeg|png|gif|bmp)(\?|#|$)/.test(u)) return 'http'; // single still image
  return 'mjpeg'; // most http(s) camera feeds are MJPEG
}

/** Best-effort label from the URL host, falling back to the raw URL. */
function labelFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** Build the exact CameraStream shape the Viewer expects from a single pasted URL. */
function streamFromUrl(url: string): CameraStream {
  return { id: `manual:${url}`, label: labelFromUrl(url), url, kind: inferStreamKind(url), caseId: null, addedAt: '', notes: '' };
}

/**
 * Shown when the window is opened WITHOUT a stream (e.g. the tile is launched standalone from the
 * OSINT Toolkit). Instead of crashing on an absent stream, offer a minimal way in: paste a stream
 * URL, or launch a real camera from EyeSpy / a GeoINT camera pin.
 */
function CameraStandaloneEntry({ onOpen }: { onOpen: (stream: CameraStream) => void }): JSX.Element {
  const [url, setUrl] = useState('');
  const trimmed = url.trim();
  const submit = (): void => {
    if (trimmed) onOpen(streamFromUrl(trimmed));
  };
  return (
    <div className="ga98-panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, maxWidth: 460 }}>
      <p style={{ margin: 0 }}>No camera stream was passed to this window.</p>
      <p style={{ margin: 0, opacity: 0.75 }}>
        Open a live camera from <b>EyeSpy</b> or a <b>GeoINT</b> camera pin, or paste a stream URL below.
      </p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        stream URL (rtsp/http/hls)
        <input
          type="text"
          value={url}
          placeholder="rtsp://…  or  https://….m3u8"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </label>
      <button onClick={submit} disabled={!trimmed} style={{ alignSelf: 'flex-start' }}>Open stream</button>
    </div>
  );
}

export function CameraViewModule({ stream }: { stream?: CameraStream }): JSX.Element {
  // A window launched standalone (no stream) would otherwise crash on `stream.city`; hold any
  // pasted URL locally and fall through to the normal viewer path once a stream exists.
  const [manual, setManual] = useState<CameraStream | null>(null);
  const active = stream ?? manual;
  if (!active) {
    return <CameraStandaloneEntry onOpen={setManual} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {cameraHeaderText(active)} <span style={{ opacity: 0.6 }}>({active.kind})</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: '#000' }}>
        <Viewer stream={active} />
      </div>
      <HostInfoView stream={active} />
    </div>
  );
}
