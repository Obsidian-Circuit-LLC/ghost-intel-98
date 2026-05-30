/**
 * Jukebox — a Win98/WinAmp-styled local-first audio player.
 *
 * Local files play through the ga98media:// protocol (path-confined in main). Internet
 * radio is gated by settings.media.streamingEnabled (off by default); resolveSource is
 * the single choke point that refuses remote URLs until the operator opts in. The Web
 * Audio graph (AudioContext → MediaElementSource → AnalyserNode → destination) is built
 * lazily on the first play (autoplay policy needs a user gesture) and reused.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { MediaLibrarySnapshot, MediaStation } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { resolveSource, isHlsUrl } from './resolveSource';
import { Visualizer } from './Visualizer';

interface QueueItem { title: string; path?: string; url?: string }

function baseName(p: string): string { return p.split(/[\\/]/).pop() ?? p; }
function trackLabel(t: { title?: string; artist?: string; path: string }): string {
  if (t.artist && t.title) return `${t.artist} — ${t.title}`;
  return t.title ?? baseName(t.path);
}
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function MediaPlayerModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const streamingEnabled = settings?.media.streamingEnabled ?? false;
  const visualizer = settings?.media.visualizer ?? true;

  const [snap, setSnap] = useState<MediaLibrarySnapshot | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);
  const [busy, setBusy] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const loadSnapshot = useCallback(async () => {
    const s = await window.api.media.getSnapshot();
    setSnap(s);
    // Default queue = the whole library, sorted by label.
    const items: QueueItem[] = s.tracks
      .map((t) => ({ title: trackLabel(t), path: t.path }))
      .sort((a, b) => a.title.localeCompare(b.title));
    setQueue(items);
  }, []);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  // Tear down the audio graph + hls on unmount.
  useEffect(() => () => {
    hlsRef.current?.destroy();
    void ctxRef.current?.close();
  }, []);

  function ensureGraph(): AnalyserNode | null {
    const audio = audioRef.current;
    if (!audio) return null;
    if (!ctxRef.current) {
      const Ctx = window.AudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      src.connect(an);
      an.connect(ctx.destination);
      ctxRef.current = ctx;
      sourceRef.current = src;
      analyserRef.current = an;
      setAnalyser(an);
    }
    void ctxRef.current.resume();
    return analyserRef.current;
  }

  const playItem = useCallback((item: QueueItem, index: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const resolved = resolveSource(item, streamingEnabled);
    if (!resolved) {
      toast.warn('Internet streaming is off — enable it to play radio stations.');
      return;
    }
    ensureGraph();
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (resolved.kind === 'stream' && isHlsUrl(resolved.src) && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(resolved.src);
      hls.attachMedia(audio);
      hlsRef.current = hls;
    } else {
      audio.src = resolved.src;
    }
    setCurrent(index);
    audio.play().then(() => setPlaying(true)).catch((err) => {
      toast.error(`Can't play "${item.title}": ${(err as Error).message}`);
      setPlaying(false);
    });
  }, [streamingEnabled]);

  const playLibraryTrack = (index: number): void => { playItem(queue[index], index); };

  const next = useCallback(() => {
    if (queue.length === 0) return;
    const n = current + 1;
    if (n < queue.length) playItem(queue[n], n);
    else setPlaying(false);
  }, [current, queue, playItem]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    const p = current - 1;
    if (p >= 0) playItem(queue[p], p);
  }, [current, queue, playItem]);

  function togglePlay(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (current < 0 && queue.length > 0) { playItem(queue[0], 0); return; }
    if (audio.paused) { void audio.play(); setPlaying(true); }
    else { audio.pause(); setPlaying(false); }
  }

  function stop(): void {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setPlaying(false);
  }

  // ---- library / playlist actions ----
  async function addFolder(): Promise<void> {
    setBusy(true);
    try { setSnap(await window.api.media.addRoot()); await loadSnapshot(); }
    catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }
  async function refresh(): Promise<void> {
    setBusy(true);
    try { setSnap(await window.api.media.refresh()); await loadSnapshot(); }
    catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }
  async function openFiles(): Promise<void> {
    try {
      const tracks = await window.api.media.openFiles();
      if (tracks.length === 0) return;
      const items: QueueItem[] = tracks.map((t) => ({ title: t.title ?? baseName(t.path), path: t.path }));
      setQueue(items);
      playItem(items[0], 0);
    } catch (err) { toast.error((err as Error).message); }
  }
  async function loadPlaylist(): Promise<void> {
    try {
      const items = await window.api.media.loadPlaylist();
      if (items.length === 0) return;
      setQueue(items);
      playItem(items[0], 0);
    } catch (err) { toast.error((err as Error).message); }
  }
  async function saveQueue(): Promise<void> {
    if (queue.length === 0) { toast.warn('Nothing in the queue to save.'); return; }
    try { const f = await window.api.media.savePlaylist(queue); if (f) toast.success(`Saved ${f}`); }
    catch (err) { toast.error((err as Error).message); }
  }

  // ---- stations ----
  const [stationLabel, setStationLabel] = useState('');
  const [stationUrl, setStationUrl] = useState('');
  async function addStation(): Promise<void> {
    try {
      await window.api.media.upsertStation({ label: stationLabel, url: stationUrl });
      setStationLabel(''); setStationUrl('');
      await loadSnapshot();
    } catch (err) { toast.error((err as Error).message); }
  }
  async function deleteStation(id: string): Promise<void> {
    try { await window.api.media.deleteStation(id); await loadSnapshot(); }
    catch (err) { toast.error((err as Error).message); }
  }
  function playStation(s: MediaStation): void { playItem({ title: s.label, url: s.url }, -1); }
  function enableStreaming(): void { void patch({ media: { streamingEnabled: true, visualizer } }); }
  function toggleVisualizer(): void { void patch({ media: { streamingEnabled, visualizer: !visualizer } }); }

  const currentItem = current >= 0 ? queue[current] : null;

  return (
    <div className="ga98-jukebox">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onEnded={next}
        style={{ display: 'none' }}
      />

      <div className="ga98-jukebox-lcd">
        <div className="ga98-jukebox-title">{currentItem ? currentItem.title : 'Ghost Access 98 — Jukebox'}</div>
        <div className="ga98-jukebox-time">{fmtTime(now)} / {currentItem?.url ? '∞' : fmtTime(dur)}</div>
      </div>

      <Visualizer analyser={analyser} enabled={visualizer} />

      <input
        type="range" min={0} max={dur || 0} step={0.1} value={now} disabled={!currentItem || !!currentItem.url}
        onChange={(e) => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }}
        style={{ width: '100%' }}
      />

      <div className="ga98-jukebox-transport">
        <button onClick={prev} title="Previous">⏮</button>
        <button onClick={togglePlay} title="Play/Pause">{playing ? '⏸' : '▶'}</button>
        <button onClick={stop} title="Stop">⏹</button>
        <button onClick={next} title="Next">⏭</button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11 }}>Vol</label>
        <input type="range" min={0} max={1} step={0.01} defaultValue={1}
          onChange={(e) => { const a = audioRef.current; if (a) a.volume = Number(e.target.value); }} style={{ width: 80 }} />
        <label style={{ fontSize: 11, marginLeft: 8 }}>
          <input type="checkbox" checked={visualizer} onChange={toggleVisualizer} /> Viz
        </label>
      </div>

      <div className="ga98-toolbar" style={{ marginTop: 6 }}>
        <button onClick={() => void addFolder()} disabled={busy}>Add folder…</button>
        <button onClick={() => void openFiles()} disabled={busy}>Open files…</button>
        <button onClick={() => void loadPlaylist()} disabled={busy}>Load playlist…</button>
        <button onClick={() => void saveQueue()} disabled={busy}>Save queue…</button>
        <button onClick={() => void refresh()} disabled={busy}>{busy ? 'Working…' : 'Refresh'}</button>
      </div>

      <div className="ga98-jukebox-panes">
        <fieldset className="ga98-jukebox-pane">
          <legend>Library ({queue.length})</legend>
          {queue.length === 0
            ? <p style={{ fontSize: 11, color: '#555' }}>No tracks. Add a music folder or open files.</p>
            : <ul className="ga98-list ga98-jukebox-list">
                {queue.map((q, i) => (
                  <li key={`${q.path ?? q.url}-${i}`} data-active={i === current}
                      onDoubleClick={() => playLibraryTrack(i)} title="Double-click to play">
                    {q.title}
                  </li>
                ))}
              </ul>}
        </fieldset>

        <fieldset className="ga98-jukebox-pane">
          <legend>Stations</legend>
          {!streamingEnabled ? (
            <div style={{ fontSize: 11 }}>
              <p style={{ color: '#555' }}>Internet streaming is off. Local playback never touches the network; turning this on lets the Jukebox reach the internet for radio.</p>
              <button onClick={enableStreaming}>Allow internet streaming</button>
            </div>
          ) : (
            <>
              <ul className="ga98-list ga98-jukebox-list">
                {(snap?.stations ?? []).map((s) => (
                  <li key={s.id} onDoubleClick={() => playStation(s)} title="Double-click to play">
                    <span style={{ flex: 1 }}>{s.label}</span>
                    <button onClick={() => void deleteStation(s.id)} style={{ minWidth: 0, padding: '0 6px' }}>✕</button>
                  </li>
                ))}
              </ul>
              <div className="field-row" style={{ marginTop: 6, gap: 4 }}>
                <input className="ga98-text" placeholder="Label" value={stationLabel} onChange={(e) => setStationLabel(e.target.value)} style={{ flex: 1 }} />
                <input className="ga98-text" placeholder="http(s) stream URL" value={stationUrl} onChange={(e) => setStationUrl(e.target.value)} style={{ flex: 2 }} />
                <button onClick={() => void addStation()} disabled={!stationLabel || !stationUrl}>Add</button>
              </div>
            </>
          )}
        </fieldset>
      </div>
    </div>
  );
}
