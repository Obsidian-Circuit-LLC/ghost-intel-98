# Jukebox Rebuild + News Add-Stream Modal — Design

**Date:** 2026-07-08
**Origin:** GhostExodus field feedback (8 images). Two independent UI features shipping in one release, in the v3.34.0 "feedback batch" style.
**Repo:** `/dcs98` (core, MIT). No plugin or cross-repo work.

## Goals

1. **News module** — replace the always-visible inline add-stream form with an **Add stream** button that opens a modal (Label + kind + URL, OK/Cancel). Remove the per-row pop-out (`⧉`) button. Keep the Stream dropdown and the `✕` remove.
2. **Jukebox module** — rebuild the WinAmp/WMP-styled player into the rounded chrome shell from the mockup, **faithful to the mockup** (real EQ, full station manager, real metadata readout), with a **3-state shade** (strip → deck → full) and the current docked width preserved.

Operator decisions (2026-07-08):
- **Faithful to the mockup** — build EQ, station Edit / Test / Save-List / Up-Down reorder as real functions, not dead buttons.
- **Keep a slim shade mode** — three states: `strip` (deck only), `deck` (+ playlist), `full` (+ stations drawer).
- **Parse real MP3 metadata** — surface bitrate / sample-rate / channels from the existing `music-metadata` parse.

## Non-negotiable constraints (charter)

- **No new dependency.** `music-metadata` is already a dep and already parses every track on refresh (`src/main/media/library.ts`); the metadata readout only widens the fields it reads. EQ and shade use Web Audio + local state only.
- **No new network egress / no telemetry.** Streaming stays gated behind `settings.media.streamingEnabled` (off by default); `resolveSource` remains the single choke point that refuses remote URLs until opt-in. **Test** (below) plays through that same gate — it cannot reach the network while streaming is off.
- **No fabricated data.** MP3 is lossy and carries no bit-depth; `music-metadata` returns `bitsPerSample` only for containers that declare it (WAV/FLAC/AIFF). We show bit-depth **only when present** and omit it otherwise — we do not print a "16-bit" the file does not have, even though the mockup shows one on an MP3.
- **Settings safety.** Every new nested `AppSettings.media` field (`eq`, `jukeboxMode`) is added to the `mergeSettings` deep-merge list **and** its upgrade test, per the v3.24.0 upgrade-dataloss lesson — or an upgrader silently drops it and consumers crash.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify`, no AI trailers, explicit-path `git add` only; never stage the known-dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`).

---

## Feature A — News Add-Stream modal

**Today** (`src/renderer/modules/geoint/NewsFeedControls.tsx`, shared by the inline GeoINT panel and the pop-out News window): a `Stream:` dropdown row with `⧉` pop-out + `✕` remove buttons, and below it an always-visible add-form (Label input, HLS/YouTube `kind` select, URL input, "Add stream" button).

**Change:**
- **Remove** the `⧉` pop-out button (line ~149). The pop-out *window* feature itself is untouched — only this redundant per-row control goes.
- **Keep** the `✕` remove (line ~150) and the `Stream:` dropdown verbatim.
- **Replace** the inline add-form (lines ~155–184) with a single **`Add stream`** button. Clicking it opens `AddStreamDialog` — a modal reusing the existing `.ga98-dialog-veil` / `.ga98-dialog-window` chrome (same as `DialogHost`): **Label** text field, **kind** select (HLS / YouTube — retained because it is load-bearing for YouTube feeds), **URL** text field, and **OK / Cancel**. Enter submits, Esc/Cancel closes with no change.
- **OK** runs the *exact* existing path: `validateStreamUrl(url, kind)` → the same soft `.m3u8` warning → `patchNews({ newsStreams: next, newsStreamIndex: next.length - 1 })`. The validation logic (`validateStreamUrl`, `isPublicHost`) is not touched — the modal is a presentation change over the same guarded write.

**Why a dedicated component, not `DialogHost`'s prompt:** the shared prompt is single-field; Label + kind + URL is three fields. `AddStreamDialog` is a small focused component that owns its own draft state and calls back with `{label, kind, url}` on OK.

**Files:** create `src/renderer/modules/geoint/AddStreamDialog.tsx`; modify `NewsFeedControls.tsx`.

---

## Feature B — Jukebox rebuild

`MediaPlayerModule.tsx` (447 lines today) is the orchestrator and has grown enough that the rebuild is also a decomposition. New responsibility-scoped files below; the module keeps state + wiring and renders the sub-components.

### B1 — Shell & 3-state shade

**Shell:** rounded/chrome CSS matching the mockup — a Now-Playing deck (note icon, large title, artist, tagline, `Stream`/kbps/kHz badges, spectrum visualizer pinned top-right), the seek bar + `mm:ss / mm:ss`, a control row (`Playlist` toggle, `EQ` toggle, `Shuffle`, `Repeat`, volume), the MP3 playlist list beside the format/art panel, and the big five-button transport (rewind/play/pause/stop/fast-forward) with the dot-matrix + G-logo. New styles live under the existing `ga98-jukebox` / `ga98-wmp-*` namespace in `theme.css`.

**Shade model** (`shade.ts`, pure, replaces `jukebox-window.ts`):

```ts
export type ShadeMode = 'strip' | 'deck' | 'full';
export const SHADE_HEIGHTS: Record<ShadeMode, number> = { strip: 150, deck: 470, full: 780 }; // logical px, tunable
export function shadeHeight(m: ShadeMode): number;
export function toggleShade(m: ShadeMode): ShadeMode;     // strip<->deck; from 'full' -> 'strip' (collapse all)
export function toggleStations(m: ShadeMode): ShadeMode;  // deck<->full; only ever called from deck/full
export function modeFromLegacy(expanded: boolean | undefined): ShadeMode; // true->'full', false/undefined->'strip'
```

**Two controls, not three** — the mockup's `Playlist` button IS the shade toggle; the down-arrow between deck and drawer IS the stations toggle. There is no separate caret:
- **`Playlist` button (control row)** → `toggleShade`: `strip ↔ deck` (show/hide the playlist). From `full` it collapses all the way to `strip`.
- **Down-arrow (between deck and drawer)** → `toggleStations`: `deck ↔ full` (open/close the STREAM STATIONS drawer). Shown only in `deck`/`full`; hidden in `strip`.

- **strip** = the deck + transport + seek only (the slim WinAmp-shade the operator asked to keep; ≈ today's compact). Only the `Playlist` button is shown (as "expand").
- **deck** = strip + the MP3 playlist list + format panel (the mockup's main body). Shows the `Playlist` button and the stations down-arrow.
- **full** = deck + the STREAM STATIONS drawer open.
- **Width** stays at the current docked default (`register-builtins.tsx` `defaultWidth: 380`). Only height changes with mode, via `useWindows.update(spec.id, { height: shadeHeight(mode) })` — same mechanism as today's `jukeboxWindowHeight`. `defaultHeight` in `register-builtins.tsx` is aligned to `SHADE_HEIGHTS.strip` for a clean first paint; the module still reconciles height to the persisted mode on mount (as today).
- **Persistence:** `settings.media.jukeboxMode: ShadeMode`, seeded once from the legacy `jukeboxExpanded` boolean via `modeFromLegacy` when `jukeboxMode` is absent, then written on every mode change (using the live mode, never the settings-derived lag — the existing `!collapsed` correctness note carries over).

### B2 — Real equalizer

**Graph** (`audio-graph.ts`): the lazy Web Audio graph moves here from `ensureGraph`. Chain becomes
`MediaElementSource → band[0] → … → band[9] → AnalyserNode → destination`, so the **visualizer taps the EQ'd signal** (what you hear). Exposes `ensureGraph(audio)`, `applyGains(gains: number[])`, `setBandGain(i, db)`, and returns the `AnalyserNode`.

**Bands & presets** (`eq.ts`, pure, unit-tested):

```ts
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]; // Hz, ISO octaves
export const EQ_GAIN_MIN = -12, EQ_GAIN_MAX = 12; // dB
export function clampGain(db: number): number;
export const EQ_PRESETS: Record<string, number[]>; // 'Flat' (all 0) + Rock/Pop/Bass/Vocal/Classical
export function presetGains(name: string): number[]; // falls back to Flat on unknown name
```

Each band is a `BiquadFilterNode` `type: 'peaking'`, `Q ≈ 1.0`, `gain` in dB. **Disabled EQ = all gains flat (0 dB)** — transparent, no reconnect churn; the `enabled` flag only governs whether the panel applies preset/slider gains or forces flat.

**UI** (`EqPanel.tsx`): the `EQ` control-row button toggles it; when on, the panel renders in the deck body (below the control row, over the playlist/format area) — ten vertical sliders (−12…+12), a preset `<select>`, and an on/off checkbox. Toggling `EQ` off returns the playlist/format view. Persists to `settings.media.eq = { enabled: boolean; gains: number[]; preset: string }`.

### B3 — Station manager (drawer)

The `full`-state drawer is the mockup's STREAM STATIONS panel (`StationsDrawer.tsx`), gated — like today — behind the streaming opt-in (the "Allow internet streaming" card shows when off).

- **List** of stations, selectable; double-click or a Play control plays one (existing `playStation`).
- **Add / Edit** — one shared modal (`AddStationDialog.tsx`: Label + URL + OK/Cancel). Add appends; Edit opens pre-filled and updates. Both call the existing `upsertStation({ id?, label, url })` (id present → update, absent → insert).
- **Remove** — existing `deleteStation(id)`.
- **Up / Down reorder** — renderer computes the new id order and calls a new main function `reorderStations(orderedIds: string[]): Promise<MediaLibrarySnapshot>` (reorders `s.stations` to match; unknown ids ignored, any missing appended). One new IPC channel.
- **Save List…** — `exportStations(): Promise<string | null>` — a save dialog writing the station list as JSON, paralleling the existing `savePlaylist`. One new IPC channel. (JSON, not M3U, so the list round-trips back cleanly if an import is added later.)
- **Test** — attempts to load the currently-typed/selected URL through the same egress-gated `resolveSource` + hls.js/`<audio>` path used for playback, with an ~8 s timeout (`withTimeout` pure helper), and reports reachable/unreachable via a status dot in the **Now Playing Station** panel + a toast. Disabled (and network-blocked) when streaming is off.
- **Now Playing Station** panel — the current station's label + derived badges + the G-logo art + the Test status dot.

**Files:** create `StationsDrawer.tsx`, `AddStationDialog.tsx`; modify `src/main/media/library.ts` (+`reorderStations`, +`exportStations`) and the media IPC registration.

### B4 — Metadata readout

Widen the `music-metadata` parse in `library.ts` `refresh()` to also read `format.bitrate`, `format.sampleRate`, `format.numberOfChannels`, `format.bitsPerSample`, `format.codec`, storing them on new **optional** `MediaTrack` fields. The deck renders `codec · bitrate kbps · (Stereo|Mono) · sampleRate kHz`, appending `· N-bit` **only when `bitsPerSample` is present**. Streams (no file metadata) show `Stream` plus whatever the manifest/context exposes. Unreadable tags still degrade to a filename-only track (existing `catch`).

---

## Shared / settings changes

- `src/shared/post-mvp-types.ts` — extend `MediaTrack` with optional `bitrate?`, `sampleRate?`, `channels?`, `bitsPerSample?`, `codec?`.
- `src/shared/types.ts` (`AppSettings.media`) — add `eq: { enabled: boolean; gains: number[]; preset: string }` and `jukeboxMode: ShadeMode`. Provide defaults (`eq`: disabled, Flat gains, `'Flat'`; `jukeboxMode`: `modeFromLegacy(jukeboxExpanded)`).
- `mergeSettings` (json-fs) — add `media.eq` and `media.jukeboxMode` to the deep-merge list; extend the merge/upgrade test to assert an old settings blob upgrades without dropping them.
- IPC contracts — add `media.reorderStations(ids)` and `media.exportStations()`; extend the media API surface in preload + `api.d.ts`.

## File structure

**New (renderer):** `media/audio-graph.ts`, `media/eq.ts`, `media/shade.ts`, `media/EqPanel.tsx`, `media/StationsDrawer.tsx`, `media/AddStationDialog.tsx`, `geoint/AddStreamDialog.tsx`.
**New (test):** `test/media-eq.test.ts`, `test/media-shade.test.ts`, `test/media-stations-reorder.test.ts` (+ metadata-field + mergeSettings assertions in their existing suites).
**Modified:** `media/MediaPlayerModule.tsx` (slimmed orchestrator), `media/jukebox-window.ts` → removed/replaced by `shade.ts`, `geoint/NewsFeedControls.tsx`, `main/media/library.ts`, media IPC register, preload media API + `api.d.ts`, `shared/post-mvp-types.ts`, `shared/types.ts`, json-fs `mergeSettings`, `styles/theme.css`.

## Data flow

- **Playback:** unchanged — queue → `resolveSource` (gate) → `<audio>`/hls.js → `audio-graph` (EQ → analyser). EQ slider/preset change → `applyGains` on the live chain + persist to `media.eq`.
- **Shade:** caret/arrow → `toggleShade`/`toggleStations` → `setMode` → window height update + persist `media.jukeboxMode`.
- **Stations:** Add/Edit → `upsertStation`; Remove → `deleteStation`; reorder → `reorderStations(ids)`; export → `exportStations()`; each returns/refreshes the snapshot. Test → `resolveSource` + timed load → status.
- **News:** Add stream button → `AddStreamDialog` → OK → `validateStreamUrl` → `patchNews` (partial geoint write; main deep-merges).

## Error handling

- Streaming off → Test and station playback blocked at `resolveSource` with the existing "streaming is off" toast; the drawer shows the opt-in card.
- Test timeout / load error → red status dot + toast; never throws into the render path.
- Unreadable metadata → filename-only track (existing behavior); missing `bitsPerSample` → readout omits bit-depth.
- Legacy settings without `jukeboxMode`/`eq` → defaults filled by `mergeSettings`; no crash, no dropped siblings.
- `reorderStations` with stale/unknown ids → ignored; list stays consistent.

## Testing

- `eq.ts` — band table shape, `clampGain` bounds, `presetGains` incl. unknown→Flat fallback.
- `shade.ts` — every transition (`toggleShade`/`toggleStations` from each mode), `shadeHeight`, `modeFromLegacy`.
- Station reorder — move-up/down at bounds, unknown-id handling, ordering preserved.
- Metadata — parsed `format.*` maps to the new `MediaTrack` fields; MP3 without `bitsPerSample` yields no bit-depth.
- `mergeSettings` — old blob upgrades with `media.eq` + `media.jukeboxMode` present and other `media` fields intact.
- Modal validation — `AddStreamDialog` reuses `validateStreamUrl`; existing tests cover the guard.
- EQ graph wiring — smoke test with a mocked `AudioContext` asserting the band chain is built and `applyGains` sets `.gain.value`.

## Honest caveats

1. **MP3 bit-depth is not real** — surfaced only when the container declares it (see charter constraint). The mockup's "16-bit" on an MP3 will not appear on MP3s; WAV/FLAC will show it.
2. **Feel/height tuning** — the three shade heights (150/470/780) are nominal; expect one interactive tuning pass with the operator after first build, like pinball.
3. **Test is best-effort reachability**, not a deep stream validator — a URL that loads a manifest but stalls mid-play reports reachable.

## Out of scope (YAGNI)

- Station *import* (only export/Save-List is requested; JSON format keeps import cheap to add later).
- Cover-art extraction/display (still no secure read path; unchanged from today's deliberate omission).
- EQ spectrum-analyzer overlay beyond the existing visualizer.
- Any change to the News pop-out *window* itself (only the per-row `⧉` button is removed).
