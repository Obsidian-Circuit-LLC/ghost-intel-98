/**
 * GeoINT — shared Live News feed controls: the Stream dropdown (+ remove button) and the
 * Add-stream modal (AddStreamDialog). Extracted out of LiveNewsPanel so BOTH the inline GeoINT panel
 * and the standalone/pop-out News module (NewsViewModule) manage the SAME settings.geoint.newsStreams
 * list with identical behavior — a feed added on either surface is immediately selectable on the other.
 *
 * Reads/writes settings.geoint directly via useSettings(). patchNews sends ONLY the changed
 * field(s) (newsStreams/newsStreamIndex) — main deep-merges the geoint sub-object (json-fs.ts
 * mergeSettings), so a partial write here cannot drop the other geoint fields (tileServerUrl/
 * basemap/cctv settings/etc); re-sending the whole block from this cache could instead clobber
 * a sibling a different window had just changed.
 *
 * validateStreamUrl/isPublicHost live here (addStream needs them); LiveNewsPanel re-exports
 * validateStreamUrl so existing importers/tests keep resolving it from there.
 */

import { useState } from 'react';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { parseYouTubeId } from '@shared/youtube';
import type { AppSettings } from '@shared/types';
import type { NewsStream, NewsStreamKind } from './NewsStreamView';
import { AddStreamDialog } from './AddStreamDialog';

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

export function NewsFeedControls(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);

  // Defensive read (mirrors GeoIntModuleInner): a partial/legacy settings object must not crash.
  const g = settings?.geoint;
  const streams: NewsStream[] = g?.newsStreams ?? [];
  const rawIndex = g?.newsStreamIndex ?? 0;
  const index = streams.length === 0 ? 0 : Math.min(Math.max(rawIndex, 0), streams.length - 1);
  const active: NewsStream | undefined = streams[index];

  const [form, setForm] = useState<{ label: string; url: string; kind: NewsStreamKind }>({ label: '', url: '', kind: 'hls' });
  const [adding, setAdding] = useState(false);

  // `settingsStore.update` deep-merges the `geoint` sub-object main-side (json-fs.ts
  // `mergeSettings`), so sending ONLY the changed field(s) is safe and cannot drop siblings —
  // whereas re-sending the whole block reconstructed from this (possibly stale) renderer cache
  // could clobber a sibling field a different window had just changed. Never spread `g` here.
  function patchNews(p: Partial<{ newsStreams: NewsStream[]; newsStreamIndex: number }>): void {
    // `patch`'s Partial<AppSettings> is a SHALLOW partial — it doesn't make AppSettings['geoint']'s
    // own fields optional — but main's mergeSettings deep-merges geoint regardless of what TS
    // thinks the shape is, so a genuinely-partial geoint payload is cast past that shallow check
    // rather than fabricating the other fields just to satisfy the type.
    void patch({ geoint: p } as Partial<AppSettings>);
  }

  function selectStream(i: number): void {
    patchNews({ newsStreamIndex: i });
  }

  // Accepts an explicit draft (from AddStreamDialog's onSubmit) so the validated write path
  // doesn't depend on a stale `form` closure across the async state update that opening/closing
  // the modal triggers; falls back to the `form` state for any other caller.
  // Returns true only on a successful add, so the caller (the modal) keeps the dialog open — with the
  // user's typed label/URL intact — when validation fails, instead of discarding the input.
  function addStream(draft?: { label: string; url: string; kind: NewsStreamKind }): boolean {
    const source = draft ?? form;
    const label = source.label.trim();
    const url = source.url.trim();
    if (!label) {
      toast.error('Give the stream a label.');
      return false;
    }
    if (!validateStreamUrl(url, source.kind)) {
      toast.error(
        source.kind === 'youtube'
          ? 'Not a parseable YouTube URL (watch?v=, youtu.be/, or /live/).'
          : 'HLS needs a public http(s) URL (an .m3u8 manifest).'
      );
      return false;
    }
    if (source.kind === 'hls' && !/\.m3u8(\?|#|$)/i.test(url)) {
      // Soft warning only — some live manifests omit the extension; we already enforced public http(s).
      toast.warn('That HLS URL does not end in .m3u8 — it may not play.');
    }
    const next = [...streams, { label, url, kind: source.kind }];
    patchNews({ newsStreams: next, newsStreamIndex: next.length - 1 });
    setForm({ label: '', url: '', kind: 'hls' });
    toast.success(`Added “${label}”.`);
    return true;
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
    <>
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
        {active && <button title="Remove this stream" onClick={() => removeStream(index)}>✕</button>}
      </div>

      <div className="field-row" style={{ marginTop: 6 }}>
        <button onClick={() => setAdding(true)}>Add stream</button>
      </div>
      {adding && (
        <AddStreamDialog
          onCancel={() => setAdding(false)}
          onSubmit={(v) => {
            if (addStream(v)) setAdding(false);
          }}
        />
      )}
    </>
  );
}
