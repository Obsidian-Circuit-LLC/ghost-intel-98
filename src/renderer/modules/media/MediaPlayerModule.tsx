/**
 * Jukebox — a Win98/WinAmp-styled local-first audio player, rebuilt into the rounded WMP shell.
 *
 * Local files play through the ga98media:// protocol (path-confined in main). Internet radio is
 * gated by settings.media.streamingEnabled (off by default); resolveSource is the single choke
 * point that refuses remote URLs until the operator opts in. The Web Audio graph (JukeboxGraph:
 * MediaElementSource → 10 peaking biquads → Analyser → destination) is built lazily on the first
 * play (autoplay policy needs a user gesture) and reused; the analyser taps AFTER the EQ so the
 * spectrum reflects what you hear.
 *
 * The window is a 3-state shade (strip → deck → full): the Playlist button toggles strip↔deck; the
 * stations down-arrow toggles deck↔full. shadeHeight(mode) fits the WINDOW to the mode so no empty
 * slab is left below the deck. The mode persists to settings.media.jukeboxMode.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import Hls from 'hls.js';
import type { MediaLibrarySnapshot, MediaStation, MediaTrack } from '@shared/post-mvp-types';
import type { AppSettings, JukeboxMode } from '@shared/types';
import { useSettings, useWindows, type WindowSpec } from '../../state/store';
import { toast } from '../../state/toasts';
import { resolveSource, isHlsUrl } from './resolveSource';
import { Visualizer } from './Visualizer';
import { JukeboxGraph } from './audio-graph';
import { EqPanel, type EqState } from './EqPanel';
import { StationsDrawer } from './StationsDrawer';
import { EQ_FLAT_GAINS } from './eq';
import { shadeHeight, toggleShade, toggleStations, modeFromLegacy } from './shade';
import { nextIndex, prevIndex, endedIndex, cycleRepeat, type RepeatMode } from './playlist-nav';
import { clampSeek, SEEK_STEP } from './seek';
import logoUrl from '../../assets/logo.png';

// Format fields ride along on the queue item so the deck can render the metadata readout without a
// second lookup into the snapshot on every render. Populated from snap.tracks in loadSnapshot.
interface QueueItem {
  title: string; name?: string; artist?: string; path?: string; url?: string;
  codec?: string; bitrate?: number; sampleRate?: number; channels?: number; bitsPerSample?: number;
}

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

// Honest metadata readout. bitsPerSample is appended ONLY when music-metadata actually returned it
// (lossless containers — WAV/FLAC/AIFF); it is omitted for MP3. Never print a bit-depth the file
// does not declare. A url item is a live stream with no on-disk format to report.
function formatLine(item: QueueItem | null): string {
  if (!item) return '';
  if (item.url) return 'Stream';
  const parts: string[] = [];
  if (item.codec) parts.push(item.codec);
  if (item.bitrate) parts.push(`${Math.round(item.bitrate / 1000)} kbps`);
  if (item.channels) parts.push(item.channels === 1 ? 'Mono' : 'Stereo');
  if (item.sampleRate) parts.push(`${item.sampleRate / 1000} kHz`);
  if (item.bitsPerSample !== undefined) parts.push(`${item.bitsPerSample}-bit`);
  return parts.join(' · ');
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
function IcoRewind(): JSX.Element {
  return <svg {...SVG}><path d="M8 3 L8 13 L1 8 Z" fill="currentColor" /><path d="M15 3 L15 13 L8 8 Z" fill="currentColor" /></svg>;
}
function IcoFForward(): JSX.Element {
  return <svg {...SVG}><path d="M1 3 L1 13 L8 8 Z" fill="currentColor" /><path d="M8 3 L8 13 L15 8 Z" fill="currentColor" /></svg>;
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

export function MediaPlayerModule({ spec }: { spec: WindowSpec }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const streamingEnabled = settings?.media.streamingEnabled ?? false;
  const visualizer = settings?.media.visualizer ?? true;
  const eq: EqState = settings?.media.eq ?? { enabled: false, gains: EQ_FLAT_GAINS, preset: 'Flat' };

  const [snap, setSnap] = useState<MediaLibrarySnapshot | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showEq, setShowEq] = useState(false);

  // 3-state shade: strip (deck only) → deck (+playlist) → full (+stations drawer). Replaces the
  // old 2-state `collapsed`. Hydrate once from settings (migrating the deprecated jukeboxExpanded
  // boolean if jukeboxMode is somehow absent), mirroring the old hydratedRef pattern.
  const [mode, setMode] = useState<JukeboxMode>(settings?.media.jukeboxMode ?? modeFromLegacy(settings?.media.jukeboxExpanded));
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current && settings) {
      hydratedRef.current = true;
      setMode(settings.media.jukeboxMode ?? modeFromLegacy(settings.media.jukeboxExpanded));
    }
  }, [settings]);
  // Fit the WINDOW to the mode. shadeHeight is DPI-independent logical px; without shrinking the
  // frame a tall empty slab is left below the deck (the v3.33.0 bug).
  useEffect(() => {
    useWindows.getState().update(spec.id, { height: shadeHeight(mode) });
  }, [mode, spec.id]);

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
  const graphRef = useRef<JukeboxGraph | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Send ONLY the changed media field(s) on every settings write. mergeSettings deep-merges the
  // `media` sub-object main-side (json-fs.ts — and it deep-merges media.eq too), so a partial write
  // preserves the siblings from base.media and cannot drop them. Re-sending the whole block rebuilt
  // from this (async-lagging) renderer cache is both unnecessary and racy: a second write fired
  // before the first patch's IPC round-trip resolves would carry the stale sibling and clobber the
  // field the first write just changed (mirrors NewsFeedControls.patchNews for geoint).
  // `patch`'s Partial<AppSettings> is a SHALLOW partial, so a genuinely-partial media payload is
  // cast past that check rather than fabricating the untouched fields just to satisfy the type.
  function patchMedia(p: Partial<AppSettings['media']>): void {
    void patch({ media: p } as Partial<AppSettings>);
  }

  const loadSnapshot = useCallback(async () => {
    const s = await window.api.media.getSnapshot();
    setSnap(s);
    // Default queue = the whole library, sorted by label. Carry the format fields so the deck can
    // render an honest metadata readout during playback.
    const items: QueueItem[] = s.tracks
      .map((t: MediaTrack): QueueItem => ({
        title: trackLabel(t), name: t.title ?? baseName(t.path), artist: t.artist, path: t.path,
        codec: t.codec, bitrate: t.bitrate, sampleRate: t.sampleRate, channels: t.channels, bitsPerSample: t.bitsPerSample
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    setQueue(items);
  }, []);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  // Tear down the audio graph + hls on unmount.
  useEffect(() => () => {
    hlsRef.current?.destroy();
    graphRef.current?.close();
  }, []);

  function ensureGraph(): AnalyserNode | null {
    const audio = audioRef.current;
    if (!audio) return null;
    if (!graphRef.current) graphRef.current = new JukeboxGraph(audio);
    graphRef.current.resume();
    setAnalyser(graphRef.current.analyser);
    graphRef.current.applyGains(eq.enabled ? eq.gains : EQ_FLAT_GAINS);
    return graphRef.current.analyser;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingEnabled, eq.enabled, eq.gains]);

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

  // Rewind/fast-forward: nudge the <audio> element's currentTime by SEEK_STEP, clamped to
  // [0, duration]. clampSeek is a pure helper so the boundary math is unit-tested in isolation.
  const seek = (delta: number): void => {
    const a = audioRef.current;
    if (a) a.currentTime = clampSeek(a.currentTime, delta, a.duration);
  };

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

  // ---- shade / EQ persistence ----
  function setModePersist(nextMode: JukeboxMode): void {
    setMode(nextMode);
    patchMedia({ jukeboxMode: nextMode });
  }
  function onEqChange(nextEq: EqState): void {
    patchMedia({ eq: nextEq });
    graphRef.current?.applyGains(nextEq.enabled ? nextEq.gains : EQ_FLAT_GAINS);
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
  function playStation(s: MediaStation): void { playItem({ title: s.label, url: s.url }, -1); }
  function enableStreaming(): void { patchMedia({ streamingEnabled: true }); }
  function toggleVisualizer(): void { patchMedia({ visualizer: !visualizer }); }

  const currentItem = current >= 0 ? queue[current] : null;
  const titleText = currentItem ? (currentItem.name ?? currentItem.title) : '';
  const artistText = currentItem?.artist ?? '';
  const badge = currentItem ? (currentItem.url ? 'Stream' : formatLine(currentItem)) : '';

  return (
    <div className="ga98-jukebox ga98-jukebox-rounded" data-mode={mode}>
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onEnded={handleEnded}
        style={{ display: 'none' }}
      />

      {/* ── Deck (always visible) ─────────────────────────────────────────── */}
      <div className="ga98-wmp-deck">
        <div className="ga98-np">
          <div className="ga98-np-info">
            <div className="ga98-np-title" title={currentItem ? (titleText || currentItem.title) : undefined}>
              {currentItem ? (titleText || currentItem.title) : 'No track loaded'}
            </div>
            <div className="ga98-np-artist">{currentItem ? (artistText || 'Unknown artist') : 'Open a folder or files, then pick a track.'}</div>
            <div className="ga98-np-badges">
              {badge && <span className="ga98-np-badge">{badge}</span>}
            </div>
          </div>
          <div className="ga98-wmp-screen ga98-np-screen">
            <Visualizer analyser={analyser} enabled={visualizer} />
            <img src={logoUrl} className="ga98-wmp-logo" alt="" style={{ imageRendering: 'pixelated' }} />
          </div>
        </div>

        {/* Track picker — a live dropdown of the queue; picking one plays it. */}
        <select className="ga98-cdp-field ga98-cdp-select ga98-np-track" aria-label="Track" value={current}
          onChange={(e) => { const i = Number(e.target.value); if (i >= 0) playLibraryTrack(i); }}>
          <option value={-1}>—</option>
          {queue.map((q, i) => <option key={`${q.path ?? q.url}-${i}`} value={i}>{`${String(i + 1).padStart(2, '0')}  ${q.title}`}</option>)}
        </select>

        <input
          type="range" min={0} max={dur || 0} step={0.1} value={now} disabled={!currentItem || !!currentItem.url}
          aria-label="Seek"
          onChange={(e) => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }}
          style={{ width: '100%' }}
        />

        {/* The classic five WMP transport buttons — rewind / play / pause / stop / fast-forward. */}
        <div className="ga98-wmp-transport">
          <button onClick={() => seek(-SEEK_STEP)} title="Rewind 10s" aria-label="Rewind 10s"><IcoRewind /></button>
          <button onClick={togglePlay} title="Play" aria-label="Play"
            aria-pressed={playing} style={transportToggleStyle(playing)}><IcoPlay /></button>
          <button onClick={() => { const a = audioRef.current; if (a && !a.paused) { a.pause(); setPlaying(false); } }}
            title="Pause" aria-label="Pause" aria-pressed={!playing && !!currentItem}
            style={transportToggleStyle(!playing && !!currentItem)}><IcoPause /></button>
          <button onClick={stop} title="Stop" aria-label="Stop"><IcoStop /></button>
          <button onClick={() => seek(SEEK_STEP)} title="Fast-forward 10s" aria-label="Fast-forward 10s"><IcoFForward /></button>
        </div>

        {/* Control row: Playlist (shade toggle), EQ, Prev/Next/Shuffle/Repeat, volume, viz. */}
        <div className="ga98-cdp-status">
          <span>{fmtTime(now)} / {currentItem?.url ? '∞' : fmtTime(dur)}</span>
          <button onClick={() => setModePersist(toggleShade(mode))} aria-label="Playlist"
            aria-pressed={mode !== 'strip'} style={{ ...transportToggleStyle(mode !== 'strip'), marginLeft: 6, minWidth: 0, padding: '0 6px' }}
            title={mode === 'strip' ? 'Show playlist' : 'Hide playlist'}>Playlist</button>
          <button onClick={() => setShowEq((v) => !v)} aria-label="EQ"
            aria-pressed={showEq} style={{ ...transportToggleStyle(showEq), minWidth: 0, padding: '0 6px' }}
            title="Equalizer">EQ</button>
          <button onClick={prev} title="Previous track" aria-label="Previous track" style={{ minWidth: 0, padding: '0 6px' }}><IcoPrev /></button>
          <button onClick={next} title="Next track" aria-label="Next track" style={{ minWidth: 0, padding: '0 6px' }}><IcoNext /></button>
          <button onClick={() => setShuffle((s) => !s)} title={`Shuffle: ${shuffle ? 'on' : 'off'}`} aria-label="Shuffle"
            aria-pressed={shuffle} style={{ ...transportToggleStyle(shuffle), minWidth: 0, padding: '0 6px' }}><IcoShuffle /></button>
          <button onClick={() => setRepeat((r) => cycleRepeat(r))} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`}
            aria-pressed={repeat !== 'off'} style={{ ...transportToggleStyle(repeat !== 'off'), minWidth: 0, padding: '0 6px' }}><IcoRepeat one={repeat === 'one'} /></button>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 11 }}>Vol</label>
          <input type="range" min={0} max={1} step={0.01} defaultValue={1} aria-label="Volume"
            onChange={(e) => { const a = audioRef.current; if (a) a.volume = Number(e.target.value); }} style={{ width: 70 }} />
          <label style={{ fontSize: 11, marginLeft: 8 }}>
            <input type="checkbox" checked={visualizer} onChange={toggleVisualizer} /> Viz
          </label>
        </div>
      </div>

      {/* ── Playlist / EQ (deck + full) ───────────────────────────────────── */}
      {mode !== 'strip' && (
        <div className="ga98-jukebox-body">
          <div className="ga98-toolbar">
            <button onClick={() => void addFolder()} disabled={busy}>Add folder…</button>
            <button onClick={() => void openFiles()} disabled={busy}>Open files…</button>
            <button onClick={() => void loadPlaylist()} disabled={busy}>Load playlist…</button>
            <button onClick={() => void saveQueue()} disabled={busy}>Save queue…</button>
            <button onClick={() => void refresh()} disabled={busy}>{busy ? 'Working…' : 'Refresh'}</button>
          </div>

          {showEq ? (
            <EqPanel eq={eq} onChange={onEqChange} />
          ) : (
            <fieldset className="ga98-jukebox-pane">
              <legend>Library ({queue.length})</legend>
              {queue.length === 0
                ? <p style={{ fontSize: 11, color: 'var(--ga98-text-dim)' }}>No tracks. Add a music folder or open files.</p>
                : <ul className="ga98-list ga98-jukebox-list">
                    {queue.map((q, i) => (
                      <li key={`${q.path ?? q.url}-${i}`} data-active={i === current}
                          onDoubleClick={() => playLibraryTrack(i)} title="Double-click to play">
                        {q.title}
                      </li>
                    ))}
                  </ul>}
            </fieldset>
          )}

          {/* Stations down-arrow: toggles deck↔full. Hidden in strip (defensive; strip hides this block). */}
          <div className="ga98-stations-toggle">
            <button onClick={() => setModePersist(toggleStations(mode))} aria-label="Stations"
              aria-pressed={mode === 'full'} title={mode === 'full' ? 'Hide stations' : 'Show stations'}>
              {mode === 'full' ? '▲ Stations' : '▼ Stations'}
            </button>
          </div>
        </div>
      )}

      {/* ── Stations drawer (full only) ───────────────────────────────────── */}
      {mode === 'full' && (
        <StationsDrawer
          stations={snap?.stations ?? []}
          streamingEnabled={streamingEnabled}
          onPlay={playStation}
          onChanged={() => void loadSnapshot()}
          onEnableStreaming={enableStreaming}
        />
      )}
    </div>
  );
}
