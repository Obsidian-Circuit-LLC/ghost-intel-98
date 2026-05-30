# Ghost Access 98 — Jukebox (Win98 media player) design

**Date:** 2026-05-30
**Module key:** `media-player` · **Display name:** "Jukebox"
**Status:** design approved (operator: GhostExodus), pending implementation plan.

## Purpose

A Windows 98–styled, offline-first audio player so the operator can keep music
running *inside* Ghost Access 98 without leaving the UI (ADD focus). Local-first
by design; internet streaming is a deliberate, opt-in egress feature. Full
WinAmp-flavored skin with the spectrum visualizer on by default.

## Locked decisions

1. **Library model:** a remembered set of folder roots (persisted) plus ad-hoc
   "Open files…". Open the player and the library is already there.
2. **Formats:** MP3, OGG/Vorbis/Opus, FLAC, WAV, M4A via the renderer's HTML5
   `<audio>` element (Electron's Chromium ships the proprietary-codec build).
   M4A/AAC playback to be confirmed against the actual build during implementation.
3. **Metadata:** parse embedded tags (ID3 / Vorbis comments / MP4 atoms) and cover
   art in the main process, cached on indexing. Pure-JS parser only (candidate:
   `music-metadata`) — must vendor with **no native modules** (`npmRebuild:false`
   is enforced); verified before the dependency is locked.
4. **Streaming:** full support (saved stations + arbitrary stream URLs + HLS audio
   via the already-bundled `hls.js`), but **dark until one opt-in toggle**
   (`media.streamingEnabled`, default `false`), enforced at the CSP layer, not just
   hidden in the UI.
5. **Skin:** full WinAmp-flavored 98.css skin; **spectrum visualizer on by default**.
6. **Audio delivery (the architecture fork):** **Approach B** — a privileged
   `ga98media://` protocol with HTTP range support for local files, path-confined to
   the library roots / ad-hoc allowlist. (Rejected Approach A, blob-from-bytes:
   loads whole files into renderer memory and makes seeking clumsy.)

## Hard invariants (inherited, non-negotiable)

- `contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`. Renderer never
  touches the filesystem or network directly except the gated `<audio>`/`hls.js`
  stream fetch.
- All capability via typed IPC: `src/shared/ipc-contracts.ts` → `src/main/ipc/register.ts`
  (`safeHandle` + validators in `src/main/security/validate.ts`) → preload → `api.d.ts`.
- Offline-first, local-only, **no telemetry / no egress** except the explicit
  streaming opt-in. No network when the toggle is off — enforced by CSP.
- No native modules. Persisted state under `dataRoot` flows through the existing
  `fileStore`/secure-fs shim (vault-encrypted at rest when login is enabled).
- Retro 98.css UI. Preserve existing data (additive, ENOENT-safe).

## Architecture

### Module registration (4 canonical points)
- `ModuleKey` union — `src/renderer/state/store.ts`
- `ModuleHost` switch — `src/renderer/shell/ModuleHost.tsx`
- `GLYPHS` — `src/renderer/shell/Icon.tsx`
- `moduleTitles` — `src/renderer/shell/Desktop.tsx`

### Local playback — `ga98media://` protocol (security-critical unit)
Registered in the main process on app ready (`protocol.handle`). For each request:
1. Decode the requested path; `realpath` it.
2. Assert it is within a **remembered library root** OR the **session ad-hoc
   allowlist** (paths the user opened via the dialog this session). Reject anything
   else (traversal, symlink escape, outside-roots) with 403/404.
3. Honor the `Range` request header; stream the byte range. No whole-file buffering.

This handler is *the* red-team target: it is the only thing between a renderer URL
and the filesystem. Confinement = `realpath` + root membership + explicit allowlist;
fail closed.

### Library index & metadata
`media-library.json` under `dataRoot` (vault-encrypted at rest via `fileStore`):

```
{
  "roots": string[],                  // remembered library folders
  "tracks": [
    { "path", "mtime", "size",
      "title?", "artist?", "album?", "durationMs?", "artRef?" }
  ],
  "stations": [ { "id", "label", "url" } ],   // stream presets (see Streaming)
  "playlists?": ...                            // saved queues, optional
}
```

On open / refresh: main walks the roots; for new or changed files (mtime+size
delta) it parses tags via the pure-JS parser and updates the entry. Cover art is
extracted to a small cache (served via `ga98media://` or inlined as a thumbnail
data-URI, mirroring `CaseSummary.primaryBioThumb`). Indexing is incremental and
cancellable; a missing root is skipped, not fatal (ENOENT-safe).

### IPC surface (`media.*`, all validated, all behind the vault gate)
- `media.getLibrary()` → index snapshot.
- `media.addRoot()` / `media.removeRoot(root)` — folder picker for add; `ensureWithin`/
  path validation; triggers (re)index.
- `media.refresh()` — re-walk roots, incremental re-parse.
- `media.openFiles()` — multi-file picker; adds chosen paths to the session ad-hoc
  allowlist (so `ga98media://` will serve them) and returns their parsed metadata.
- `media.loadPlaylist()` / `media.savePlaylist(queue)` — M3U load/save via the
  dialog-confined pattern used by the case bundle.
- `media.getStations()` / `media.upsertStation(s)` / `media.deleteStation(id)` —
  stream presets; URL-validated; only meaningful when streaming is enabled.

Validators (in `validate.ts`): `ensureMediaRoot` (existing dir, realpath), playlist
path confinement, `ensureStationInput` (label bounds + `validateExternalUrl` on the
stream URL, `http`/`https` only).

### Skin, transport, visualizer (renderer)
- WinAmp-flavored 98.css layout: LCD readout (scrolling Artist — Title + bitrate/
  time), transport (prev / play / pause / stop / next), seek bar, volume slider,
  shuffle + repeat, attached playlist pane.
- Visualizer (on by default, toggleable): `AudioContext` → `MediaElementSource(audio)`
  → `AnalyserNode` → `requestAnimationFrame` canvas spectrum bars. The
  `MediaElementSource` node is created once per `<audio>` and also connected to
  `destination` so audio still plays.
- Keyboard: space = play/pause, media keys where the platform delivers them.

### Playlists (M3U / M3U8)
Pure-text parse: `#EXTM3U` header, `#EXTINF:<secs>,<title>` display hints, one entry
per line. Local relative paths resolve against the playlist file's directory and are
added to the ad-hoc allowlist on load; `http(s)` entries are treated as streams
(only resolve when streaming is enabled — otherwise listed but skipped with a note).
Save = write the current queue as a valid M3U via the confined save dialog.

### Streaming (opt-in egress)
- Setting `media.streamingEnabled`, default **false**, in `AppSettings`.
- **Off:** stations UI is dark; remote URLs and `http(s)` M3U entries do not resolve;
  no network is reachable for media — CSP forbids it.
- **On:** saved **Stations** + arbitrary stream URLs play through `<audio>`; HLS
  (`.m3u8` audio) plays via the bundled `hls.js`.
- **Enforcement:** the renderer session's CSP `media-src` / `connect-src` is set via
  `session.defaultSession.webRequest.onHeadersReceived` keyed on the toggle —
  `'self' blob: ga98media:` when off; plus the stream origins (or `https:`) when on.
  Streaming is blocked at the engine level until the operator flips it, not merely
  hidden. Toggling updates the CSP for subsequent loads.

## Error handling
- Unreadable/missing track → marked unavailable in the list, playback skips to next,
  surfaced as a toast; never a silent stall.
- Decode failure (unsupported/corrupt) → explicit "can't play this file" toast with
  the filename; advance.
- Stream failure (offline, bad URL, 4xx/5xx) → toast; the player does not hang.
- Streaming-disabled + stream entry → visible "internet streaming is off" note, not a
  silent no-op.
- Protocol handler denial → 403/404; renderer shows the track as unavailable.

## Security surface (red-team targets)
1. `ga98media://` path confinement — traversal, symlink escape, outside-root,
   non-allowlisted ad-hoc paths. Fail closed.
2. No egress when streaming is off — assert at the CSP layer (not just UI state).
3. Station/stream URL validation — `http`/`https` only, no `file:`/`javascript:` etc.
4. M3U entries cannot smuggle out-of-root local paths into the allowlist beyond their
   own directory's resolved files.

## Testing
**Vitest (main-process logic, headless):**
- M3U parser: well-formed, `#EXTINF`, relative-path resolution, `http` entries,
  adversarial/garbage lines, CRLF.
- Protocol-handler confinement: in-root OK; traversal (`../`), symlink escape,
  outside-root, non-allowlisted ad-hoc path all rejected.
- Library indexing: initial walk, incremental re-parse on mtime/size change, missing
  root skipped, `.extracted`/cache files not surfaced as tracks.
- Station URL validation (accept http/https, reject others).
- Streaming-off behavior: remote/`http` entries skipped; CSP string is the locked-down
  variant.

**xvfb smoke:** module opens; a local fixture track (committed test asset) plays;
visualizer paints; transport works; no console/main errors.

## Out of scope (v1)
- Video (this is audio-only; EyeSpy owns video/feeds).
- Equalizer/DSP, gapless playback, crossfade, replaygain.
- Custom downloadable WinAmp `.wsz` skins.
- Editing tags / writing files (read-only library).
- Playing while the vault is locked (module stays gated; revisit later if wanted).

## Open items for implementation
- Confirm `music-metadata` (or chosen parser) vendors with no native modules and
  bundles for the main process under `externalizeDepsPlugin`.
- Confirm M4A/AAC playback on the packaged Electron build.
- Decide cover-art cache form (separate files served via protocol vs. inlined
  thumbnail data-URIs) during the plan.
