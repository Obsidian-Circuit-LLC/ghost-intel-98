/**
 * GeoINT — Live News video panel (R12). A user-managed playlist of news streams played inline:
 *   - kind 'hls'     → hls.js into a muted, autoplaying <video> (same pattern as EyeSpy Viewer).
 *   - kind 'youtube' → a sandboxed www.youtube-nocookie.com/embed iframe (the single, operator-
 *                      authorized exception to the renderer frame-src invariant; host-scoped in
 *                      src/renderer/index.html).
 *
 * Like every GeoINT surface, the panel is gated on settings.geoint.networkEnabled: with the
 * network off it loads NOTHING (no HLS chunks, no iframe) and shows a placeholder.
 *
 * parseYouTubeId / validateStreamUrl are exported as pure functions so they're unit-tested
 * (test/geoint-livenews.test.ts) without rendering.
 */

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';

export type NewsStreamKind = 'hls' | 'youtube';
export interface NewsStream {
  label: string;
  url: string;
  kind: NewsStreamKind;
}

// Hosts we will treat as YouTube. An arbitrary host that merely *carries* a `watch?v=` query
// (e.g. evil.com/watch?v=...) is NOT YouTube and must never yield an embeddable id — otherwise
// we'd frame attacker-controlled content under the youtube-nocookie embed exception.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be'
]);

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract the 11-char YouTube video id from a watch / youtu.be / live / embed URL.
 * Returns null for any non-YouTube host, any unparseable URL, or any id of the wrong shape.
 * Crucially host-checked: a YouTube-shaped path on a non-YouTube host yields null.
 */
export function parseYouTubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let candidate: string | null = null;
  if (host === 'youtu.be') {
    // https://youtu.be/<id>
    candidate = u.pathname.split('/').filter(Boolean)[0] ?? null;
  } else {
    const v = u.searchParams.get('v');
    if (v) {
      candidate = v;
    } else {
      // /live/<id>, /embed/<id>, /shorts/<id>, /v/<id>
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'v')) {
        candidate = parts[1];
      }
    }
  }
  if (candidate && YT_ID.test(candidate)) return candidate;
  return null;
}

/**
 * Validate a user-supplied stream URL for the given kind.
 *  - 'hls':     must be a public http(s) URL (rejects javascript:/data:/file:, and private/loopback
 *               hosts). A .m3u8 path is preferred but not strictly required (some live manifests
 *               omit the extension); the http(s)+public check is the security-relevant one.
 *  - 'youtube': must parse to a real YouTube video id on a YouTube host (parseYouTubeId).
 */
export function validateStreamUrl(url: string, kind: NewsStreamKind): boolean {
  if (kind === 'youtube') return parseYouTubeId(url) !== null;

  // kind === 'hls'
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return isPublicHost(u.hostname);
}

/** Reject loopback / link-local / RFC1918 private hosts so a stream URL can't be a pivot into
 *  the local network or app host. Hostname-only check (no DNS); a conservative literal match. */
function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return false;
  // IPv4 private / loopback / link-local ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return false;
  }
  return true;
}

function youtubeEmbedSrc(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1`;
}

function HlsVideo({ url }: { url: string }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    // Safari / native HLS fallback.
    video.src = url;
    return () => {
      video.src = '';
      video.load();
    };
  }, [url]);
  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      playsInline
      controls
      style={{ width: '100%', height: '100%', background: '#000' }}
    />
  );
}

export function LiveNewsPanel(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);

  // Defensive read (mirrors GeoIntModuleInner): a partial/legacy settings object must not crash.
  const g = settings?.geoint;
  const net = g?.networkEnabled ?? false;
  const streams: NewsStream[] = g?.newsStreams ?? [];
  const rawIndex = g?.newsStreamIndex ?? 0;
  const index = streams.length === 0 ? 0 : Math.min(Math.max(rawIndex, 0), streams.length - 1);
  const active: NewsStream | undefined = streams[index];

  const [form, setForm] = useState<{ label: string; url: string; kind: NewsStreamKind }>({ label: '', url: '', kind: 'hls' });

  // Carry the full geoint block on every write (the renderer store shallow-replaces the whole
  // geoint object, so a news write must re-send the unchanged tile/basemap fields or they'd drop).
  // We default each field defensively in case a partial/legacy settings object slipped through.
  function patchNews(p: Partial<{ newsStreams: NewsStream[]; newsStreamIndex: number }>): void {
    void patch({
      geoint: {
        networkEnabled: net,
        tileServerUrl: g?.tileServerUrl ?? '',
        tileAttribution: g?.tileAttribution ?? '',
        basemap: g?.basemap ?? 'street',
        newsStreams: streams,
        newsStreamIndex: index,
        ...p
      }
    });
  }

  function selectStream(i: number): void {
    patchNews({ newsStreamIndex: i });
  }

  function addStream(): void {
    const label = form.label.trim();
    const url = form.url.trim();
    if (!label) {
      toast.error('Give the stream a label.');
      return;
    }
    if (!validateStreamUrl(url, form.kind)) {
      toast.error(
        form.kind === 'youtube'
          ? 'Not a parseable YouTube URL (watch?v=, youtu.be/, or /live/).'
          : 'HLS needs a public http(s) URL (an .m3u8 manifest).'
      );
      return;
    }
    if (form.kind === 'hls' && !/\.m3u8(\?|#|$)/i.test(url)) {
      // Soft warning only — some live manifests omit the extension; we already enforced public http(s).
      toast.warn('That HLS URL does not end in .m3u8 — it may not play.');
    }
    const next = [...streams, { label, url, kind: form.kind }];
    patchNews({ newsStreams: next, newsStreamIndex: next.length - 1 });
    setForm({ label: '', url: '', kind: 'hls' });
    toast.success(`Added “${label}”.`);
  }

  function removeStream(i: number): void {
    const next = streams.filter((_, j) => j !== i);
    // Keep the active selection pointing at a valid entry after removal.
    let nextIndex = index;
    if (i < index) nextIndex = index - 1;
    else if (i === index) nextIndex = Math.min(index, next.length - 1);
    patchNews({ newsStreams: next, newsStreamIndex: Math.max(0, nextIndex) });
  }

  const ytId = active && active.kind === 'youtube' ? parseYouTubeId(active.url) : null;

  return (
    <fieldset className="ga98-livenews">
      <legend>Live News</legend>

      <div className="field-row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <label style={{ minWidth: 50 }}>Stream:</label>
        <select
          className="ga98-select"
          value={index}
          disabled={streams.length === 0}
          onChange={(e) => selectStream(Number(e.target.value))}
          style={{ flex: 1 }}
        >
          {streams.length === 0 && <option value={0}>— no streams —</option>}
          {streams.map((s, i) => (
            <option key={`${s.kind}:${s.url}:${i}`} value={i}>
              {s.label} {s.kind === 'youtube' ? '(YouTube)' : '(HLS)'}
            </option>
          ))}
        </select>
        {active && (
          <button title="Remove this stream" onClick={() => removeStream(index)}>✕</button>
        )}
      </div>

      <div
        className="ga98-livenews-video"
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', marginBottom: 6 }}
      >
        {!net ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 12, textAlign: 'center', padding: 12 }}>
            Enable the GeoINT network to play live news.
          </div>
        ) : !active ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 12, textAlign: 'center', padding: 12 }}>
            No stream selected. Add one below.
          </div>
        ) : active.kind === 'hls' ? (
          <HlsVideo key={active.url} url={active.url} />
        ) : ytId ? (
          <iframe
            key={ytId}
            title={active.label}
            src={youtubeEmbedSrc(ytId)}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="no-referrer"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e88', fontSize: 12, textAlign: 'center', padding: 12 }}>
            Cannot parse a YouTube video id from this stream URL.
          </div>
        )}
      </div>

      <div className="ga98-livenews-add" style={{ borderTop: '1px solid #888', paddingTop: 6 }}>
        <div className="field-row" style={{ gap: 6, marginBottom: 4 }}>
          <input
            className="ga98-text"
            placeholder="Label"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            style={{ flex: 1 }}
          />
          <select
            className="ga98-select"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as NewsStreamKind }))}
          >
            <option value="hls">HLS</option>
            <option value="youtube">YouTube</option>
          </select>
        </div>
        <div className="field-row" style={{ gap: 6 }}>
          <input
            className="ga98-text"
            placeholder={form.kind === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://…/stream.m3u8'}
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') addStream(); }}
            style={{ flex: 1 }}
          />
          <button onClick={addStream}>Add stream</button>
        </div>
      </div>
    </fieldset>
  );
}
