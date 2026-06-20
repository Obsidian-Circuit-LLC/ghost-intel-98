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

import { useState } from 'react';
import { useSettings, useWindows } from '../../state/store';
import { toast } from '../../state/toasts';
import { parseYouTubeId } from '@shared/youtube';
import { NewsStreamView, type NewsStream, type NewsStreamKind } from './NewsStreamView';
import { newsWindowSpec } from './newsWindow';

// Re-export so existing callers/tests that import parseYouTubeId from this module still resolve.
export { parseYouTubeId };

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
          <>
            <button title="Pop out to its own window" onClick={() => useWindows.getState().open(newsWindowSpec(active))}>⧉</button>
            <button title="Remove this stream" onClick={() => removeStream(index)}>✕</button>
          </>
        )}
      </div>

      <div
        className="ga98-livenews-video"
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', marginBottom: 6 }}
      >
        {!active ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 12, textAlign: 'center', padding: 12 }}>
            No stream selected. Add one below.
          </div>
        ) : (
          <NewsStreamView stream={active} />
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
