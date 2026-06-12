/**
 * Jukebox — a Win98/WinAmp-styled local-first audio player.
 *
 * Local files play through the ga98media:// protocol (path-confined in main). Internet
 * radio is gated by settings.media.streamingEnabled (off by default); resolveSource is
 * the single choke point that refuses remote URLs until the operator opts in. The Web
 * Audio graph (AudioContext → MediaElementSource → AnalyserNode → destination) is built
 * lazily on the first play (autoplay policy needs a user gesture) and reused.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import Hls from 'hls.js';
import type { MediaLibrarySnapshot, MediaStation } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { resolveSource, isHlsUrl } from './resolveSource';
import { Visualizer } from './Visualizer';
import { nextIndex, prevIndex, endedIndex, cycleRepeat, type RepeatMode } from './playlist-nav';

interface QueueItem { title: string; name?: string; artist?: string; path?: string; url?: string }

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

// Transport icons drawn as inline SVG (currentColor) rather than Unicode media glyphs
// (⏮ ▶ ⏹ ⏭), which render as "tofu" boxes on Windows builds lacking the symbol font —
// the "wonky buttons" GhostExodus reported. SVG renders identically everywhere.
const SVG = { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true } as const;
function IcoPrev(): JSX.Element {
  return <svg {...SVG}><rect x="2" y="3" width="2" height="10" fill="currentColor" /><path d="M13 3 L13 13 L5 8 Z" fill="currentColor" /></svg>;
}
function IcoNext(): JSX.Element {
  return <svg {...SVG}><path d="M3 3 L3 13 L11 8 Z" fill="currentColor" /><rect x="12" y="3" width="2" height="10" fill="currentColor" /></svg>;
}
function IcoPlay(): JSX.Element {
  return <svg {...SVG}><path d="M4 3 L4 13 L13 8 Z" fill="currentColor" /></svg>;
}
function IcoPause(): JSX.Element {
  return <svg {...SVG}><rect x="4" y="3" width="3" height="10" fill="currentColor" /><rect x="9" y="3" width="3" height="10" fill="currentColor" /></svg>;
}
function IcoStop(): JSX.Element {
  return <svg {...SVG}><rect x="3" y="3" width="10" height="10" fill="currentColor" /></svg>;
}
function IcoShuffle(): JSX.Element {
  return (
    <svg {...SVG}>
      <g fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M1 4 H4 L11 12" /><path d="M1 12 H4 L11 4" />
      </g>
      <path d="M11 1 L15 4 L11 7 Z" fill="currentColor" />
      <path d="M11 9 L15 12 L11 15 Z" fill="currentColor" />
    </svg>
  );
}
function IcoRepeat({ one }: { one: boolean }): JSX.Element {
  return (
    <svg {...SVG}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 8 V6 A2 2 0 0 1 5 4 H12" /><path d="M13 8 V10 A2 2 0 0 1 11 12 H4" />
      </g>
      <path d="M11 2 L14 4 L11 6 Z" fill="currentColor" />
      <path d="M5 10 L2 12 L5 14 Z" fill="currentColor" />
      {one && <text x="8" y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="currentColor">1</text>}
    </svg>
  );
}
// Pressed/active look for the latching Shuffle + Repeat toggles, without touching CSS.
function transportToggleStyle(active: boolean): CSSProperties {
  return active ? { borderStyle: 'inset', background: '#bfe0bf', color: '#003300' } : {};
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
  // Collapsed = the compact "just the deck" view: hide the file toolbar + Library/Stations
  // panes, leaving the LCD/transport/fields/visualizer/seek. Lets the Jukebox shrink to a
  // WinAmp-shade-style strip without losing playback control.
  const [collapsed, setCollapsed] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  // next()/prev()/onEnded read the *latest* repeat+shuffle without re-binding their
  // useCallbacks (which depend on queue/current), so refs mirror the state.
  const repeatRef = useRef<RepeatMode>('off');
  const shuffleRef = useRef(false);
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  // Visited indices, so Previous walks back through the shuffle order rather than index-1.
  const historyRef = useRef<number[]>([]);

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
      .map((t) => ({ title: trackLabel(t), name: t.title ?? baseName(t.path), artist: t.artist, path: t.path }))
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

  const rememberCurrent = (): void => {
    if (current < 0) return;
    historyRef.current.push(current);
    if (historyRef.current.length > 256) historyRef.current.shift();
  };

  const next = useCallback(() => {
    rememberCurrent();
    const n = nextIndex({ current, length: queue.length, repeat: repeatRef.current, shuffle: shuffleRef.current, rng: Math.random });
    if (n === null) setPlaying(false);
    else playItem(queue[n], n);
  }, [current, queue, playItem]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    // In shuffle, Previous walks back through the actual play history, not index-1.
    if (shuffleRef.current) {
      const h = historyRef.current.pop();
      if (h != null && h >= 0 && h < queue.length) { playItem(queue[h], h); return; }
    }
    const p = prevIndex({ current, length: queue.length, repeat: repeatRef.current, shuffle: shuffleRef.current, rng: Math.random });
    if (p !== null) playItem(queue[p], p);
  }, [current, queue, playItem]);

  // Track ended naturally: repeat-one replays, otherwise advance like Next (respecting shuffle/repeat-all).
  const handleEnded = useCallback(() => {
    rememberCurrent();
    const n = endedIndex({ current, length: queue.length, repeat: repeatRef.current, shuffle: shuffleRef.current, rng: Math.random });
    if (n === null) setPlaying(false);
    else playItem(queue[n], n);
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
  const titleText = currentItem ? (currentItem.name ?? currentItem.title) : '';
  const artistText = currentItem?.artist ?? '';

  return (
    <div className="ga98-jukebox">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onEnded={handleEnded}
        style={{ display: 'none' }}
      />

      {/* CD-Player-style console: a green LCD (track # + elapsed) beside a beveled two-row
          transport deck. Same handlers as before — only the chrome changed. */}
      <div className="ga98-cdp">
        <div className="ga98-cdp-lcd">
          <span className="ga98-cdp-tracknum">{current >= 0 ? `[${String(current + 1).padStart(2, '0')}]` : '[--]'}</span>
          <span className="ga98-cdp-clock">{fmtTime(now)}</span>
        </div>
        <div className="ga98-cdp-deck">
          <div className="ga98-cdp-row">
            {/* Distinct Play / Pause / Stop buttons like a real CD-player deck. Play resumes or
                starts the first track; Pause only pauses. (Previously button 1 was a
                Play/Pause toggle AND there was a separate Pause button — two pause icons while
                playing.) The currently-active state is shown by highlighting, not by morphing. */}
            <button onClick={togglePlay} title="Play" aria-label="Play"
              aria-pressed={playing} style={transportToggleStyle(playing)}><IcoPlay /></button>
            <button onClick={() => { const a = audioRef.current; if (a && !a.paused) { a.pause(); setPlaying(false); } }}
              title="Pause" aria-label="Pause" aria-pressed={!playing && !!currentItem}
              style={transportToggleStyle(!playing && !!currentItem)}><IcoPause /></button>
            <button onClick={stop} title="Stop" aria-label="Stop"><IcoStop /></button>
          </div>
          <div className="ga98-cdp-row">
            <button onClick={prev} title="Previous track" aria-label="Previous track"><IcoPrev /></button>
            <button onClick={next} title="Next track" aria-label="Next track"><IcoNext /></button>
            <button onClick={() => setShuffle((s) => !s)} title={`Shuffle: ${shuffle ? 'on' : 'off'}`} aria-label="Shuffle"
              aria-pressed={shuffle} style={transportToggleStyle(shuffle)}><IcoShuffle /></button>
            <button onClick={() => setRepeat((r) => cycleRepeat(r))} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`}
              aria-pressed={repeat !== 'off'} style={transportToggleStyle(repeat !== 'off')}><IcoRepeat one={repeat === 'one'} /></button>
          </div>
        </div>
      </div>

      {/* Artist / Title / Track readout — the CD Player's labeled fields. Track is a live
          dropdown of the queue; picking one plays it. */}
      <div className="ga98-cdp-fields">
        <label>Artist:</label>
        <div className="ga98-cdp-field">{artistText || (currentItem ? '' : 'No track loaded')}</div>
        <label>Title:</label>
        <div className="ga98-cdp-field">{currentItem ? (titleText || currentItem.title) : 'Open a folder or files, then pick a track below.'}</div>
        <label>Track:</label>
        <select className="ga98-cdp-field ga98-cdp-select" value={current}
          onChange={(e) => { const i = Number(e.target.value); if (i >= 0) playLibraryTrack(i); }}>
          <option value={-1}>—</option>
          {queue.map((q, i) => <option key={`${q.path ?? q.url}-${i}`} value={i}>{`${String(i + 1).padStart(2, '0')}  ${q.title}`}</option>)}
        </select>
      </div>

      <Visualizer analyser={analyser} enabled={visualizer} />

      <input
        type="range" min={0} max={dur || 0} step={0.1} value={now} disabled={!currentItem || !!currentItem.url}
        onChange={(e) => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }}
        style={{ width: '100%' }}
      />

      <div className="ga98-cdp-status">
        <span>Track Length: {currentItem?.url ? '∞' : fmtTime(dur)} m:s</span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11 }}>Vol</label>
        <input type="range" min={0} max={1} step={0.01} defaultValue={1}
          onChange={(e) => { const a = audioRef.current; if (a) a.volume = Number(e.target.value); }} style={{ width: 70 }} />
        <label style={{ fontSize: 11, marginLeft: 8 }}>
          <input type="checkbox" checked={visualizer} onChange={toggleVisualizer} /> Viz
        </label>
        <button onClick={() => setCollapsed((c) => !c)} style={{ marginLeft: 8, minWidth: 0, padding: '0 6px' }}
          title={collapsed ? 'Expand library & stations' : 'Collapse to the compact player'}
          aria-pressed={collapsed} aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▼' : '▲'}</button>
      </div>

      {!collapsed && (
      <div className="ga98-toolbar" style={{ marginTop: 6 }}>
        <button onClick={() => void addFolder()} disabled={busy}>Add folder…</button>
        <button onClick={() => void openFiles()} disabled={busy}>Open files…</button>
        <button onClick={() => void loadPlaylist()} disabled={busy}>Load playlist…</button>
        <button onClick={() => void saveQueue()} disabled={busy}>Save queue…</button>
        <button onClick={() => void refresh()} disabled={busy}>{busy ? 'Working…' : 'Refresh'}</button>
      </div>
      )}

      {!collapsed && (
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
      )}
    </div>
  );
}
