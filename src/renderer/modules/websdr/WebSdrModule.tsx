/**
 * WebSDR Viewer — renderer module (Phase 4, R9/R10 + control bar + host + notes + archive).
 *
 * A hardened, faithful port of GhostExodus's "SDR Eaves-Dropper" `src/App.tsx` onto the GI98
 * surface. The behaviour is his — a manager + host for PUBLIC WebSDR/KiwiSDR/OpenWebRX websites:
 * customizable Station Menu, receiver directory + search + favorites, the freq/mode/volume control
 * bar, listening notes, and a recording archive — but every seam is the GI98 hardened one:
 *
 *   - Persistence is `window.api.websdr.*` (P1 secure-fs stores), NOT his plaintext localStorage /
 *     JSON DB. The Station Menu config round-trips through `getMenu`/`saveMenu` (encrypt-at-rest).
 *   - The receiver page is a MAIN-managed `persist:websdr` `WebContentsView` overlay (P2), not a
 *     renderer iframe/webview — this host only reports its on-screen bounds so the overlay tracks
 *     it (`receiverPresent`), and detaches it while a GI98 modal is open (`receiverModal`).
 *   - Egress is CLEARNET by default with a warned Tor toggle (the app's ONE narrow exception); a
 *     marker always shows the live path. Toggling calls `receiverEgressApply` (P2) which persists,
 *     re-routes the session proxy, and returns the one-time "Tor may break live audio" flag.
 *   - Recordings persist ENCRYPTED at rest (P3); playback reads decrypted bytes via `recordingData`
 *     into an in-memory Blob URL — there is no plaintext file to "reveal", so his Show-File action
 *     is replaced by the save-dialog-gated `exportRecording` (the one plaintext egress).
 *
 * Look: his green console reproduced as a FIXED theme via the `--ga98-sdr-*` token namespace under
 * `.sdr-root` (websdr.css), identical in classic + QUIET AMETHYST — token-only, no raw literals.
 *
 * Icons are inline SVG (icons.tsx) — GI98 does not carry lucide-react.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import './websdr.css';
import bannerImage from '../../assets/websdr-banner.png';
// window.prompt is a no-op in Electron's renderer (returns null) — use in-app dialogs instead.
import { PromptDialog } from '../../components/CaseDialogs';
import { useWindows } from '../../state/store';
import { confirmDialog } from '../../state/dialogs';
import type {
  WebSdrReceiver,
  WebSdrPreset,
  WebSdrNote,
  WebSdrRecordingMeta,
  WebSdrMenuItem,
  WebSdrStationMenu,
  WebSdrEgressMode,
} from '@shared/websdr/types';
import {
  IconRadio, IconPlus, IconPencil, IconTrash, IconStar, IconExternal, IconActivity, IconSave,
  IconVolume, IconVolumeMute, IconRefresh, IconList, IconBookmark, IconSliders, IconMenu,
  IconChevronUp, IconChevronDown, IconEye, IconEyeOff, IconReset, IconSettings, IconAlert,
  IconFile, IconX, IconArchive, IconVideo, IconSquare, IconDownload, IconSearch, IconShield,
} from './icons';

type Panel = 'feeds' | 'favorites' | 'presets' | 'notes' | 'recordings';

const MODES = ['AM', 'SAM', 'USB', 'LSB', 'CW', 'FM'];
const BLANK: WebSdrReceiver = { id: '', name: '', url: 'https://', type: 'Generic', location: '', notes: '', favorite: false };

/** The renderer's canonical Station Menu built-ins — his seven sections. On load these are merged
 *  over whatever `getMenu` returns (his `readNav` merge), so a menu persisted with the P1 five-item
 *  default still surfaces Notes + Recordings, and a user's renames/reorders/hides are preserved. */
const CANONICAL: Array<{ key: string; label: string }> = [
  { key: 'all-feeds', label: 'All SDR Feeds' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'presets', label: 'Frequency Presets' },
  { key: 'notes', label: 'Listening Notes' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'add-feed', label: 'Add SDR Feed' },
  { key: 'customize', label: 'Customize Menu' },
];

/** The panel a built-in menu key selects, if any (add-feed/customize/custom shortcuts are actions). */
const KEY_TO_PANEL: Record<string, Panel> = {
  'all-feeds': 'feeds',
  favorites: 'favorites',
  presets: 'presets',
  notes: 'notes',
  recordings: 'recordings',
};

function menuIcon(item: WebSdrMenuItem): JSX.Element {
  if (!item.builtin) return <IconRadio size={16} />;
  switch (item.key) {
    case 'all-feeds': return <IconList size={16} />;
    case 'favorites': return <IconStar size={16} />;
    case 'presets': return <IconBookmark size={16} />;
    case 'notes': return <IconFile size={16} />;
    case 'recordings': return <IconArchive size={16} />;
    case 'add-feed': return <IconPlus size={16} />;
    case 'customize': return <IconSettings size={16} />;
    default: return <IconRadio size={16} />;
  }
}

/** Merge the persisted menu with the canonical built-ins (append any missing) — his readNav. */
function mergeMenu(persisted: WebSdrMenuItem[]): WebSdrMenuItem[] {
  const present = new Set(persisted.map((i) => i.key));
  const missing = CANONICAL.filter((c) => !present.has(c.key)).map<WebSdrMenuItem>((c) => ({
    key: c.key,
    label: c.label,
    hidden: false,
    builtin: true,
  }));
  return [...persisted, ...missing];
}

function formatHz(h: number): string {
  if (h >= 1e6) return `${(h / 1e6).toFixed(6)} MHz`;
  if (h >= 1e3) return `${(h / 1e3).toFixed(3)} kHz`;
  return `${h} Hz`;
}
function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function formatBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n || 0} B`;
}
function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function WebSdrModule({ windowId }: { windowId?: string } = {}): JSX.Element {
  const api = (globalThis as unknown as { window: { api?: { websdr?: GhostWebSdrApi } } }).window?.api?.websdr;

  // The native receiver overlay (a WebContentsView) composites ABOVE all DOM, so it must be shown ONLY
  // when THIS is the focused, non-minimized GI98 window — otherwise it paints over whatever window is
  // now in front. No windowId (e.g. tests) ⇒ treat as active.
  const windowActive = useWindows((s) => {
    if (!windowId) return true;
    if (s.focusStack[s.focusStack.length - 1] !== windowId) return false;
    return !s.windows.find((w) => w.id === windowId)?.minimized;
  });

  const [bootError, setBootError] = useState('');
  const [receivers, setReceivers] = useState<WebSdrReceiver[]>([]);
  const [presets, setPresets] = useState<WebSdrPreset[]>([]);
  const [notes, setNotes] = useState<WebSdrNote[]>([]);
  const [recordings, setRecordings] = useState<WebSdrRecordingMeta[]>([]);
  const [menu, setMenu] = useState<WebSdrMenuItem[]>([]);
  const [egressMode, setEgressMode] = useState<WebSdrEgressMode>('clearnet');
  const [torWarning, setTorWarning] = useState(false);

  const [selected, setSelected] = useState<WebSdrReceiver | null>(null);
  const [editing, setEditing] = useState<WebSdrReceiver | null>(null);
  const [customizing, setCustomizing] = useState(false);
  // In-app entry dialogs replacing his window.prompt() calls (which return null in Electron's
  // renderer, making the preset + shortcut creators dead buttons in the shipped app). The preset
  // dialog snapshots the freq/mode/receiver at the moment the save action is taken, matching his
  // synchronous prompt semantics even though the GI98 dialog resolves asynchronously.
  const [presetDialog, setPresetDialog] = useState<{ frequencyHz: number; mode: string; receiverId?: string } | null>(null);
  const [shortcutDialog, setShortcutDialog] = useState(false);
  const [panel, setPanel] = useState<Panel>('feeds');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('Ready.');

  const [hz, setHz] = useState(7100000);
  const [mode, setMode] = useState('USB');
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  const [noteDraft, setNoteDraft] = useState<WebSdrNote | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordStarted, setRecordStarted] = useState<string | null>(null);
  const [activeRecording, setActiveRecording] = useState<WebSdrRecordingMeta | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [recordingNotes, setRecordingNotes] = useState('');

  const host = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<{ state: string; stop: () => void; mimeType?: string } | null>(null);
  const mediaStream = useRef<{ getTracks: () => Array<{ stop: () => void }> } | null>(null);
  const audioMonitor = useRef<{ close: () => Promise<void> } | null>(null);
  const chunks = useRef<Blob[]>([]);
  const playbackUrlRef = useRef('');
  // Refs mirror state for the resize/observer callbacks (which capture a stale closure otherwise).
  const selectedRef = useRef<WebSdrReceiver | null>(null);
  const panelRef = useRef<Panel>('feeds');
  const windowActiveRef = useRef(windowActive);
  selectedRef.current = selected;
  panelRef.current = panel;
  windowActiveRef.current = windowActive;

  // ---- init -------------------------------------------------------------
  useEffect(() => {
    if (!api) {
      setBootError('The WebSDR preload bridge did not load. Rebuild the application.');
      return;
    }
    Promise.all([
      api.listReceivers(),
      api.listPresets(),
      api.listNotes(),
      api.listRecordings(),
      api.getMenu(),
      api.getEgress(),
    ])
      .then(([rs, ps, ns, recs, m, eg]) => {
        setReceivers(rs);
        setPresets(ps);
        setNotes(ns);
        setRecordings(recs);
        setMenu(mergeMenu((m as WebSdrStationMenu).items ?? []));
        setEgressMode(eg.mode);
      })
      .catch((e: unknown) => setBootError((e as Error)?.message || 'Could not initialize the WebSDR database.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- receiver overlay bounds / visibility -----------------------------
  const boundsRetryRef = useRef(0);
  function syncBounds(): void {
    if (!api) return;
    // Show the overlay only when this window is active, a receiver is loaded, and we're not on the
    // recordings panel; otherwise HIDE (never leave it floating). windowActive/selected drive the gate.
    const wantShow = !!selectedRef.current && panelRef.current !== 'recordings' && windowActiveRef.current;
    if (!wantShow) {
      boundsRetryRef.current = 0;
      const why = !windowActiveRef.current ? 'window-inactive' : !selectedRef.current ? 'no-receiver' : 'recordings-panel';
      void api.receiverPresent({ visible: false, diag: why });
      return;
    }
    const r = host.current?.getBoundingClientRect();
    // v3.72.1 blank-view fix: DON'T park the native view at 0×0 (it renders blank) before the host has
    // laid out. Retry on the next frame (bounded) until the host reports real bounds, then show once.
    if (!r || r.width < 2 || r.height < 2) {
      if (boundsRetryRef.current < 40) {
        boundsRetryRef.current += 1;
        requestAnimationFrame(syncBounds);
      } else {
        void api.receiverPresent({ visible: false, diag: 'host-zero-bounds' });
      }
      return;
    }
    boundsRetryRef.current = 0;
    void api.receiverPresent({ visible: true, bounds: { x: r.left, y: r.top, width: r.width, height: r.height }, diag: 'shown' });
  }

  // Detach the overlay while any GI98 modal is open (his v0.1.6 fix) so it never paints over it.
  useEffect(() => {
    if (!api) return;
    void api.receiverModal(Boolean(editing) || customizing || Boolean(presetDialog) || shortcutDialog);
  }, [api, editing, customizing, presetDialog, shortcutDialog]);

  // Show/hide + reposition the overlay as selection / panel / window focus+minimize change. syncBounds
  // itself decides visibility, so a blur, cover, or minimize (windowActive → false) hides the overlay.
  useEffect(() => {
    if (!api) return;
    // While a GI98 modal is open the receiverModal effect already detached the overlay; don't fight it.
    if (editing || customizing) return;
    const t = setTimeout(syncBounds, 20);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, panel, windowActive]);

  // Tear the native overlay DOWN when the module unmounts (window closed). Without this the
  // WebContentsView stays attached to contentView, visible, audio playing, over the whole desktop
  // until app quit (its controlling component is gone).
  useEffect(() => {
    return () => { void api?.receiverHide(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track host resizes so the native overlay follows the window/host geometry.
  useEffect(() => {
    const sync = (): void => syncBounds();
    sync();
    window.addEventListener('resize', sync);
    const ob = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    if (ob && host.current) ob.observe(host.current);
    return () => {
      window.removeEventListener('resize', sync);
      ob?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, panel, windowActive]);

  // Revoke the previous object URL when playback changes / on unmount (no dangling blob).
  useEffect(() => {
    playbackUrlRef.current = playbackUrl;
  }, [playbackUrl]);
  useEffect(() => {
    return () => {
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    };
  }, []);

  // ---- derived ----------------------------------------------------------
  const sorted = useMemo(
    () => [...receivers].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)),
    [receivers],
  );
  const shownReceivers = useMemo(() => {
    const base = panel === 'favorites' ? sorted.filter((r) => r.favorite) : sorted;
    const q = query.trim().toLowerCase();
    return q ? base.filter((r) => `${r.name} ${r.location} ${r.url}`.toLowerCase().includes(q)) : base;
  }, [panel, sorted, query]);
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [notes]);
  const activeKey = useMemo(() => {
    const found = Object.entries(KEY_TO_PANEL).find(([, p]) => p === panel);
    return found ? found[0] : '';
  }, [panel]);

  // ---- receiver actions -------------------------------------------------
  async function load(r: WebSdrReceiver): Promise<void> {
    if (!api) return;
    setSelected(r);
    setPanel('feeds');
    setMessage(`Loading ${r.name}…`);
    await api.receiverLoad(r.url);
    // v3.72.1 blank-view fix: the host region often finishes laying out AFTER the load resolves, so a
    // single 100ms re-sync can still park the view at stale/zero bounds. Re-assert across a frame and a
    // few settle points (syncBounds is idempotent + self-guards against zero bounds).
    requestAnimationFrame(syncBounds);
    for (const ms of [100, 400, 1000]) setTimeout(syncBounds, ms);
    setMessage(`${r.name} loaded.`);
  }
  async function saveReceiver(r: WebSdrReceiver): Promise<void> {
    if (!api) return;
    try {
      setReceivers(await api.saveReceiver(r));
      setEditing(null);
      setMessage('Receiver saved.');
    } catch (e: unknown) {
      setMessage((e as Error)?.message || 'Could not save receiver.');
    }
  }
  async function del(r: WebSdrReceiver): Promise<void> {
    if (!api || !window.confirm(`Remove ${r.name}?`)) return;
    setReceivers(await api.deleteReceiver(r.id));
    setMenu((items) => items.filter((i) => i.receiverId !== r.id));
    if (selected?.id === r.id) {
      setSelected(null);
      await api.receiverHide();
    }
  }
  async function toggleFavorite(r: WebSdrReceiver): Promise<void> {
    if (!api) return;
    const u = { ...r, favorite: !r.favorite };
    setReceivers(await api.saveReceiver(u));
    if (selected?.id === r.id) setSelected(u);
    setMessage(u.favorite ? `${r.name} bookmarked.` : `${r.name} removed from favorites.`);
  }
  async function check(r: WebSdrReceiver): Promise<void> {
    if (!api) return;
    setStatus((s) => ({ ...s, [r.id]: 'checking' }));
    const x = await api.receiverStatus(r.url);
    setStatus((s) => ({ ...s, [r.id]: x.online ? 'online' : 'offline' }));
  }

  // ---- control bar ------------------------------------------------------
  async function tune(): Promise<void> {
    if (!api) return;
    const r = await api.receiverTune(hz);
    setMessage(r.message);
  }
  async function setModeAndPush(m: string): Promise<void> {
    if (!api) return;
    setMode(m);
    const r = await api.receiverMode(m);
    setMessage(r.message);
  }
  function changeVolume(v: number): void {
    setVolume(v);
    void api?.receiverVolume(v);
  }
  function toggleMute(): void {
    const next = !muted;
    setMuted(next);
    void api?.receiverMute(next);
  }

  // ---- presets ----------------------------------------------------------
  function savePreset(): void {
    if (!api) return;
    setPresetDialog({ frequencyHz: hz, mode, receiverId: selected?.id });
  }
  async function confirmPreset(name: string): Promise<void> {
    const snap = presetDialog;
    setPresetDialog(null);
    if (!api || !snap) return;
    setPresets(await api.savePreset({ id: '', name, frequencyHz: snap.frequencyHz, mode: snap.mode, receiverId: snap.receiverId, notes: '' }));
  }
  async function deletePreset(p: WebSdrPreset): Promise<void> {
    if (!api) return;
    if (window.confirm(`Delete preset ${p.name}?`)) setPresets(await api.deletePreset(p.id));
  }
  async function usePreset(p: WebSdrPreset): Promise<void> {
    if (!api) return;
    setHz(p.frequencyHz);
    setMode(p.mode);
    if (p.receiverId) {
      const r = receivers.find((x) => x.id === p.receiverId);
      if (r && selected?.id !== r.id) await load(r);
    }
    setTimeout(async () => {
      await api.receiverTune(p.frequencyHz);
      await api.receiverMode(p.mode);
    }, 250);
  }

  // ---- notes ------------------------------------------------------------
  function newNote(): void {
    const now = new Date().toISOString();
    setNoteDraft({
      id: '',
      title: selected ? `${selected.name} observation` : 'Listening note',
      body: '',
      createdAt: now,
      updatedAt: now,
      receiverId: selected?.id,
      frequencyHz: hz,
      mode,
    });
  }
  async function saveNote(): Promise<void> {
    if (!api || !noteDraft) return;
    setNotes(await api.saveNote({ ...noteDraft, title: noteDraft.title.trim() || 'Untitled note' }));
    setNoteDraft(null);
    setMessage('Listening note saved.');
  }
  async function deleteNote(n: WebSdrNote): Promise<void> {
    if (!api) return;
    if (window.confirm(`Delete note "${n.title}"?`)) {
      setNotes(await api.deleteNote(n.id));
      if (noteDraft?.id === n.id) setNoteDraft(null);
    }
  }

  // ---- recording --------------------------------------------------------
  async function startRecording(): Promise<void> {
    if (!api || !selected) {
      setMessage('Load a receiver before recording.');
      return;
    }
    try {
      const sourceId = await api.receiverCaptureSource();
      const constraints = {
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: sourceId } },
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: sourceId, maxFrameRate: 30 } },
      } as unknown as MediaStreamConstraints;
      const stream = (await navigator.mediaDevices.getUserMedia(constraints)) as unknown as {
        getAudioTracks: () => unknown[];
        getTracks: () => Array<{ stop: () => void }>;
      };
      mediaStream.current = stream;
      chunks.current = [];
      // Chromium tab capture suppresses the source tab's local audio; route captured audio back to
      // the output so the listener keeps hearing the SDR while recording (his monitor).
      if (stream.getAudioTracks().length && typeof AudioContext !== 'undefined') {
        const ctx = new AudioContext();
        await ctx.resume();
        const src = ctx.createMediaStreamSource(stream as unknown as MediaStream);
        src.connect(ctx.destination);
        audioMonitor.current = ctx;
      }
      const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = candidates.find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(stream as unknown as MediaStream, mime ? { mimeType: mime } : undefined);
      mediaRecorder.current = rec as unknown as { state: string; stop: () => void; mimeType?: string };
      const startedAt = new Date().toISOString();
      setRecordStarted(startedAt);
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        try {
          // His Save/Discard gate (electron/main.ts recordings:save dialog): don't silently archive a
          // fat-fingered capture — confirm before persisting an encrypted blob the user must else hunt down.
          const keep = await confirmDialog('Save this recording?', 'SDR recording');
          if (!keep) { setMessage('Recording discarded.'); return; }
          const endedAt = new Date().toISOString();
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'video/webm' });
          const data = await blob.arrayBuffer();
          const list = await api.saveRecording({
            data,
            receiverId: selected.id,
            receiverName: selected.name,
            sourceUrl: selected.url,
            startedAt,
            endedAt,
            durationMs: Date.parse(endedAt) - Date.parse(startedAt),
            frequencyHz: hz,
            mode,
            notes: '',
          });
          setRecordings(list);
          setMessage(`Recording archived (encrypted): ${selected.name}`);
        } catch (e: unknown) {
          setMessage((e as Error)?.message || 'Could not save recording.');
        } finally {
          mediaStream.current?.getTracks().forEach((t) => t.stop());
          mediaStream.current = null;
          if (audioMonitor.current) {
            try {
              await audioMonitor.current.close();
            } catch {
              /* monitor already closed */
            }
            audioMonitor.current = null;
          }
          mediaRecorder.current = null;
          chunks.current = [];
          setIsRecording(false);
          setRecordStarted(null);
        }
      };
      rec.start(1000);
      setIsRecording(true);
      setMessage(`Recording ${selected.name}…`);
    } catch (e: unknown) {
      setMessage(`Recording could not start: ${(e as Error)?.message || e}`);
    }
  }
  function stopRecording(): void {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      setMessage('Finalizing recording…');
      mediaRecorder.current.stop();
    }
  }
  async function selectRecording(r: WebSdrRecordingMeta): Promise<void> {
    if (!api) return;
    setActiveRecording(r);
    setRecordingNotes(r.notes || '');
    try {
      const { bytes, mime } = await api.recordingData(r.id);
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
      setPlaybackUrl(url);
    } catch (e: unknown) {
      setPlaybackUrl('');
      setMessage((e as Error)?.message || 'Recording file unavailable.');
    }
  }
  async function saveRecordingNotes(): Promise<void> {
    if (!api || !activeRecording) return;
    const list = await api.annotateRecording(activeRecording.id, recordingNotes);
    setRecordings(list);
    setActiveRecording(list.find((x) => x.id === activeRecording.id) || activeRecording);
    setMessage('Recording notes saved.');
  }
  async function deleteRecording(r: WebSdrRecordingMeta): Promise<void> {
    if (!api) return;
    if (!window.confirm(`Delete recording from ${r.receiverName}? This also deletes the encrypted file.`)) return;
    setRecordings(await api.deleteRecording(r.id));
    if (activeRecording?.id === r.id) {
      setActiveRecording(null);
      if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
      setPlaybackUrl('');
    }
  }

  // ---- egress toggle ----------------------------------------------------
  async function toggleEgress(): Promise<void> {
    if (!api) return;
    const next: WebSdrEgressMode = egressMode === 'clearnet' ? 'tor' : 'clearnet';
    try {
      const res = await api.receiverEgressApply(next);
      setEgressMode(res.mode);
      setTorWarning(res.showWarning);
      setMessage(res.mode === 'tor' ? 'Receiver session routed through Tor.' : 'Receiver session on clearnet.');
    } catch (e: unknown) {
      setMessage((e as Error)?.message || 'Tor is unavailable; staying on the current path.');
    }
  }

  // ---- station menu -----------------------------------------------------
  async function persistMenu(items: WebSdrMenuItem[]): Promise<void> {
    setMenu(items);
    if (api) await api.saveMenu({ items });
  }
  function activateMenu(item: WebSdrMenuItem): void {
    if (!item.builtin && item.receiverId) {
      const r = receivers.find((x) => x.id === item.receiverId);
      if (r) void load(r);
      return;
    }
    if (item.key === 'add-feed') {
      setEditing({ ...BLANK });
      return;
    }
    if (item.key === 'customize') {
      setCustomizing(true);
      return;
    }
    const p = KEY_TO_PANEL[item.key];
    if (p) setPanel(p);
  }
  function moveMenu(index: number, delta: number): void {
    setMenu((items) => {
      const n = [...items];
      const to = index + delta;
      if (to < 0 || to >= n.length) return items;
      [n[index], n[to]] = [n[to], n[index]];
      return n;
    });
  }
  function addShortcut(): void {
    if (!receivers.length) {
      window.alert('Add an SDR feed first.');
      return;
    }
    setShortcutDialog(true);
  }
  function confirmShortcut(name: string): void {
    setShortcutDialog(false);
    const r = receivers.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!r) {
      window.alert('No receiver matched that name.');
      return;
    }
    setMenu((items) => [
      ...items,
      { key: `custom-${Date.now()}`, label: r.name, hidden: false, builtin: false, receiverId: r.id },
    ]);
  }

  // ---- render -----------------------------------------------------------
  if (bootError) {
    return (
      <div className="sdr-root">
        <div className="sdr-fatal">
          <IconAlert size={52} />
          <h1>WebSDR Viewer</h1>
          <p>{bootError}</p>
          <small>This is the failure surface — the preload bridge or module load faulted.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="sdr-root">
      <div className="sdr-app">
        <header className="sdr-banner" aria-label="WebSDR Viewer">
          <img className="sdr-banner-art" src={bannerImage} alt="WebSDR radio-monitoring banner" />
        </header>
        <div className="sdr-layout">
          <aside className="sdr-sidebar">
            <div className="sdr-menu-heading">
              <IconMenu size={16} />
              <span>STATION MENU</span>
            </div>
            <nav className="sdr-nav">
              {menu
                .filter((i) => !i.hidden)
                .map((i) => (
                  <button
                    key={i.key}
                    className={i.builtin && i.key === activeKey ? 'active' : ''}
                    onClick={() => activateMenu(i)}
                  >
                    {menuIcon(i)}
                    <span>{i.label}</span>
                  </button>
                ))}
            </nav>
            <div className="sdr-side-divider" />

            {(panel === 'feeds' || panel === 'favorites') && (
              <>
                <div className="sdr-receiver-search">
                  <IconSearch size={13} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${receivers.length} receivers…`} />
                </div>
                <div className="sdr-section-title">
                  <span>{panel === 'favorites' ? 'FAVORITE RECEIVERS' : `RECEIVERS (${receivers.length})`}</span>
                  <button title="Add receiver" onClick={() => setEditing({ ...BLANK })}>
                    <IconPlus size={16} />
                  </button>
                </div>
                <div className="sdr-receiver-list">
                  {shownReceivers.map((r) => (
                    <div className={`sdr-receiver ${selected?.id === r.id ? 'active' : ''}`} key={r.id}>
                      <button className="sdr-receiver-main" onClick={() => load(r)}>
                        <span className={`sdr-dot ${status[r.id] || 'unknown'}`} />
                        <span>
                          <b>{r.name}</b>
                          <small>{r.type} · {r.location || hostname(r.url)}</small>
                        </span>
                      </button>
                      <div className="sdr-row-btns">
                        <button className={r.favorite ? 'sdr-fav active' : 'sdr-fav'} onClick={() => toggleFavorite(r)} title="Favorite">
                          <IconStar size={14} fill={r.favorite ? 'currentColor' : 'none'} />
                        </button>
                        <button onClick={() => check(r)} title="Check status"><IconActivity size={14} /></button>
                        <button onClick={() => setEditing({ ...r })} title="Edit"><IconPencil size={14} /></button>
                        <button onClick={() => del(r)} title="Remove"><IconTrash size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {panel === 'presets' && (
              <>
                <div className="sdr-section-title">
                  <span>FREQUENCY PRESETS</span>
                  <button onClick={savePreset}><IconSave size={15} /></button>
                </div>
                <div className="sdr-preset-list">
                  {presets.map((p) => (
                    <div className="sdr-preset-row" key={p.id}>
                      <button className="sdr-preset" onClick={() => usePreset(p)}>
                        <b>{p.name}</b>
                        <span>{formatHz(p.frequencyHz)} · {p.mode}</span>
                      </button>
                      <button className="sdr-preset-delete" onClick={() => deletePreset(p)}><IconTrash size={13} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {panel === 'notes' && (
              <>
                <div className="sdr-section-title">
                  <span>LISTENING NOTES</span>
                  <button onClick={newNote}><IconPlus size={16} /></button>
                </div>
                <div className="sdr-notes-pane">
                  {noteDraft ? (
                    <div className="sdr-note-editor">
                      <div className="sdr-note-editor-head">
                        <b>{noteDraft.id ? 'EDIT NOTE' : 'NEW NOTE'}</b>
                        <button onClick={() => setNoteDraft(null)}><IconX size={14} /></button>
                      </div>
                      <input className="sdr-note-title" value={noteDraft.title} onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} />
                      <div className="sdr-note-context">{selected?.name || 'General'} · {formatHz(noteDraft.frequencyHz || hz)} · {noteDraft.mode || mode}</div>
                      <textarea value={noteDraft.body} onChange={(e) => setNoteDraft({ ...noteDraft, body: e.target.value })} placeholder="What are you hearing?" />
                      <div className="sdr-note-actions">
                        <button onClick={() => setNoteDraft(null)}>Cancel</button>
                        <button className="sdr-primary" onClick={saveNote}><IconSave size={13} /> Save</button>
                      </div>
                    </div>
                  ) : (
                    <button className="sdr-new-note" onClick={newNote}><IconPlus size={14} /> New listening note</button>
                  )}
                  <div className="sdr-note-list">
                    {sortedNotes.map((n) => (
                      <div className="sdr-note-card" key={n.id}>
                        <button className="sdr-note-open" onClick={() => setNoteDraft({ ...n })}>
                          <b>{n.title}</b>
                          <span>{new Date(n.updatedAt).toLocaleString()}</span>
                          <p>{n.body || 'No text yet.'}</p>
                        </button>
                        <button className="sdr-note-delete" onClick={() => deleteNote(n)}><IconTrash size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {panel === 'recordings' && (
              <>
                <div className="sdr-section-title"><span>RECORDINGS ({recordings.length})</span></div>
                <div className="sdr-recording-side-list">
                  {recordings.length === 0 ? (
                    <p className="sdr-muted">No recordings yet.</p>
                  ) : (
                    recordings.map((r) => (
                      <button key={r.id} className={activeRecording?.id === r.id ? 'active' : ''} onClick={() => selectRecording(r)}>
                        <b>{r.receiverName}</b>
                        <span>{new Date(r.startedAt).toLocaleString()}</span>
                        <small>{formatDuration(r.durationMs)} · {formatBytes(r.sizeBytes)}</small>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            <button className="sdr-customize-bottom" onClick={() => setCustomizing(true)}>
              <IconSliders size={14} /> Customize sidebar
            </button>
          </aside>

          <main className="sdr-main">
            <section className="sdr-toolbar">
              <label>
                FREQUENCY
                <div className="sdr-freq">
                  <input
                    value={hz}
                    onChange={(e) => setHz(Number(e.target.value.replace(/\D/g, '')) || 0)}
                    onKeyDown={(e) => e.key === 'Enter' && tune()}
                  />
                  <span>Hz</span>
                  <button onClick={tune}>TUNE</button>
                </div>
              </label>
              <div className="sdr-steps">
                {[-10000, -1000, -100, 100, 1000, 10000].map((n) => (
                  <button key={n} onClick={() => setHz((h) => Math.max(0, h + n))}>
                    {n > 0 ? '+' : ''}{Math.abs(n) >= 1000 ? `${n / 1000}k` : n}
                  </button>
                ))}
              </div>
              <div className="sdr-modes">
                {MODES.map((m) => (
                  <button className={mode === m ? 'selected' : ''} key={m} onClick={() => setModeAndPush(m)}>{m}</button>
                ))}
              </div>
              <div className="sdr-egress">
                <button
                  className={`sdr-egress-marker ${egressMode}`}
                  data-mode={egressMode}
                  title="Toggle the receiver session's egress path (clearnet ⇄ Tor)"
                  onClick={toggleEgress}
                >
                  <IconShield size={13} />
                  {egressMode === 'tor' ? 'TOR' : 'CLEARNET'}
                </button>
              </div>
              <div className="sdr-volume">
                <button className="sdr-mute" onClick={toggleMute}>{muted ? <IconVolumeMute size={17} /> : <IconVolume size={17} />}</button>
                <input type="range" min="0" max="1" step=".01" value={volume} onChange={(e) => changeVolume(Number(e.target.value))} />
              </div>
            </section>

            {torWarning && (
              <div className="sdr-tor-warning" role="alert">
                <IconAlert size={14} />
                <span>Tor is enabled for this receiver session. Live SDR audio may be laggy or blocked by exit nodes.</span>
                <button onClick={() => setTorWarning(false)}><IconX size={13} /></button>
              </div>
            )}

            <section className="sdr-receiver-header">
              <div>
                <b>{panel === 'recordings' ? 'Recording Archive' : selected?.name || 'No receiver selected'}</b>
                <span>{panel === 'recordings' ? 'Encrypted SDR video/audio captures with integrated notes.' : selected?.url || 'Choose a feed from the station menu.'}</span>
              </div>
              {selected && panel !== 'recordings' && (
                <div>
                  <button className={isRecording ? 'sdr-record active' : 'sdr-record'} onClick={isRecording ? stopRecording : startRecording}>
                    {isRecording ? <><IconSquare size={13} /> STOP</> : <><IconVideo size={14} /> RECORD</>}
                  </button>
                  <button className={selected.favorite ? 'sdr-header-fav active' : 'sdr-header-fav'} onClick={() => toggleFavorite(selected)}>
                    <IconStar size={14} fill={selected.favorite ? 'currentColor' : 'none'} /> {selected.favorite ? 'Favorite' : 'Bookmark'}
                  </button>
                  <button onClick={() => load(selected)}><IconRefresh size={14} /> Reload</button>
                  <button onClick={() => void api?.receiverExternalOpen(selected.url)}><IconExternal size={14} /> Browser</button>
                </div>
              )}
            </section>

            <div className="sdr-browser-frame" ref={host}>
              {panel === 'recordings' ? (
                <RecordingArchive
                  recording={activeRecording}
                  url={playbackUrl}
                  notes={recordingNotes}
                  setNotes={setRecordingNotes}
                  saveNotes={saveRecordingNotes}
                  del={deleteRecording}
                  exportRec={(r) => void api?.exportRecording(r.id)}
                />
              ) : (
                !selected && (
                  <div className="sdr-empty">
                    <IconRadio size={54} />
                    <h2>WebSDR Viewer</h2>
                    <p>{receivers.length} KiwiSDR/public feeds are ready. Select one from the menu.</p>
                  </div>
                )
              )}
            </div>

            <footer className="sdr-footer">
              <span>
                {isRecording && recordStarted && (
                  <span className="sdr-rec-indicator">● RECORDING since {new Date(recordStarted).toLocaleTimeString()} · </span>
                )}
                {message}
              </span>
              <span>{selected ? `${selected.type} adapter · ${egressMode.toUpperCase()}` : 'Idle'}</span>
            </footer>
          </main>
        </div>

        {editing && (
          <div className="sdr-modal-shade">
            <div className="sdr-modal">
              <h2>{editing.id ? 'Edit Receiver' : 'Add Receiver'}</h2>
              <label>Name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label>URL<input value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} /></label>
              <div className="sdr-two">
                <label>
                  Receiver type
                  <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as WebSdrReceiver['type'] })}>
                    <option>WebSDR</option>
                    <option>KiwiSDR</option>
                    <option>OpenWebRX</option>
                    <option>Generic</option>
                  </select>
                </label>
                <label>Location<input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></label>
              </div>
              <label>Receiver notes<textarea rows={4} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
              <label className="sdr-check">
                <input type="checkbox" checked={editing.favorite} onChange={(e) => setEditing({ ...editing, favorite: e.target.checked })} /> Favorite receiver
              </label>
              <div className="sdr-modal-btns">
                <button onClick={() => setEditing(null)}>Cancel</button>
                <button className="sdr-primary" onClick={() => saveReceiver(editing)}>Save Receiver</button>
              </div>
            </div>
          </div>
        )}

        {customizing && (
          <div className="sdr-modal-shade">
            <div className="sdr-modal sdr-menu-editor">
              <h2>Customize Station Menu</h2>
              <p className="sdr-editor-help">Rename, reorder, show, hide, or remove shortcuts.</p>
              <div className="sdr-menu-edit-list">
                {menu.map((item, index) => (
                  <div className="sdr-menu-edit-row" key={item.key}>
                    <button
                      title={item.hidden ? 'Show' : 'Hide'}
                      onClick={() => setMenu((n) => n.map((x) => (x.key === item.key ? { ...x, hidden: !x.hidden } : x)))}
                    >
                      {item.hidden ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                    </button>
                    <button title="Move up" disabled={index === 0} onClick={() => moveMenu(index, -1)}><IconChevronUp size={15} /></button>
                    <button title="Move down" disabled={index === menu.length - 1} onClick={() => moveMenu(index, 1)}><IconChevronDown size={15} /></button>
                    <input value={item.label} onChange={(e) => setMenu((n) => n.map((x) => (x.key === item.key ? { ...x, label: e.target.value } : x)))} />
                    {item.builtin ? (
                      <span className="sdr-locked">BUILT-IN</span>
                    ) : (
                      <button className="sdr-danger" onClick={() => setMenu((n) => n.filter((x) => x.key !== item.key))}><IconTrash size={15} /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="sdr-editor-actions">
                <button onClick={addShortcut}><IconPlus size={14} /> Add receiver shortcut</button>
                <button onClick={() => setMenu(mergeMenu([]))}><IconReset size={14} /> Reset defaults</button>
              </div>
              <div className="sdr-modal-btns">
                <button className="sdr-primary" onClick={() => { void persistMenu(menu); setCustomizing(false); }}>Done</button>
              </div>
            </div>
          </div>
        )}

        {presetDialog && (
          <PromptDialog
            title="Save frequency preset"
            label="Preset name"
            placeholder={`${formatHz(presetDialog.frequencyHz)} · ${presetDialog.mode}`}
            submitLabel="Save"
            onSubmit={(n) => void confirmPreset(n)}
            onClose={() => setPresetDialog(null)}
          />
        )}

        {shortcutDialog && (
          <PromptDialog
            title="Add receiver shortcut"
            label="Receiver name"
            placeholder="Exact receiver name"
            submitLabel="Add"
            onSubmit={confirmShortcut}
            onClose={() => setShortcutDialog(false)}
          />
        )}
      </div>
    </div>
  );
}

// ---- recording archive (his RecordingArchive) ---------------------------

function RecordingArchive({
  recording,
  url,
  notes,
  setNotes,
  saveNotes,
  del,
  exportRec,
}: {
  recording: WebSdrRecordingMeta | null;
  url: string;
  notes: string;
  setNotes: (v: string) => void;
  saveNotes: () => void;
  del: (r: WebSdrRecordingMeta) => void;
  exportRec: (r: WebSdrRecordingMeta) => void;
}): JSX.Element {
  if (!recording) {
    return (
      <div className="sdr-archive-empty">
        <IconArchive size={58} />
        <h2>Recording Archive</h2>
        <p>Record a live SDR feed and it will appear here with its timestamp, receiver, frequency, mode and notes.</p>
      </div>
    );
  }
  return (
    <div className="sdr-archive">
      <div className="sdr-archive-player">
        <div className="sdr-archive-title">
          <IconArchive size={18} />
          <div>
            <h2>{recording.receiverName}</h2>
            <p>{new Date(recording.startedAt).toLocaleString()} · {formatDuration(recording.durationMs)} · {formatBytes(recording.sizeBytes)}</p>
          </div>
        </div>
        {url ? <video key={url} src={url} controls preload="metadata" /> : <div className="sdr-missing-recording">Recording file unavailable.</div>}
        <div className="sdr-archive-meta">
          <span><b>Frequency</b>{recording.frequencyHz ? formatHz(recording.frequencyHz) : 'Unknown'}</span>
          <span><b>Mode</b>{recording.mode || 'Unknown'}</span>
          <span><b>Source</b>{recording.sourceUrl}</span>
        </div>
      </div>
      <aside className="sdr-archive-notes">
        <h3>RECORDING NOTES</h3>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add observations, callsigns, timestamps, transcription notes, signal details…" />
        <button className="sdr-primary" onClick={saveNotes}><IconSave size={14} /> Save Notes</button>
        <div className="sdr-archive-actions">
          <button onClick={() => exportRec(recording)}><IconDownload size={14} /> Export .webm</button>
          <button className="sdr-danger" onClick={() => del(recording)}><IconTrash size={14} /> Delete</button>
        </div>
      </aside>
    </div>
  );
}

// ---- the P1/P2/P3 renderer API surface (typed against api.d.ts) ----------
type GhostWebSdrApi = NonNullable<NonNullable<Window['api']>['websdr']>;
