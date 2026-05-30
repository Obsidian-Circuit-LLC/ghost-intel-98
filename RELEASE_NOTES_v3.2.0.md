# Ghost Access 98 — v3.2.0

Adds the **Jukebox** — a Windows 98 / WinAmp-styled, offline-first audio player — plus a
batch of fixes from live Windows testing of v3.1.0.

## New: Jukebox (🎵)

A retro media player that keeps your music inside the app. Local-first by design.

- **Local playback** — MP3, OGG/Vorbis/Opus, FLAC, WAV, M4A. Point it at one or more
  music folders (**Add folder…**) and it remembers them, indexing embedded tags
  (artist / title / album) and cover art. Or **Open files…** for one-offs.
- **Playlists** — load and save standard **`.m3u` / `.m3u8`** playlists.
- **WinAmp skin** — green LCD readout, transport controls, seek, volume, and a
  Web-Audio **spectrum visualizer** (toggleable).
- **Internet radio** — off by default. The **Stations** pane stays dark until you press
  **Allow internet streaming**; only then will the player reach the network (Icecast /
  SHOUTcast, and HLS audio). Local playback never touches the internet.

Local audio is served through a path-confined internal protocol — the player can only
read files inside your chosen folders.

## Fixes (from v3.1.0 Windows testing)

- **DialTerm** dial-up/error text is now readable green-on-black (was pale green on a
  white box).
- **Settings → Theme** changes apply to the desktop **instantly** (desktop colour and
  background image), and the **Intensity** selector now does something — Lite (flat,
  calm), Classic (standard 98), Maximum (CRT scanlines + vignette).
- **Case sharing** is clearer: per-case **Share…** / **Import…** buttons, and shareable
  case files now use the **`.ghost`** extension named `<reference>-<title>.ghost`
  (e.g. `0001-John Smith.ghost`). Old `.ga98case` files still import.

## Attribution / notes

Built on the v3.0.0 encrypt-at-rest base. The local-AI online wizard from v3.1.0 is
included. This build is **unsigned** — SmartScreen will warn; **More info → Run anyway**.

---

**Artifact:** `GhostAccess98-Setup-3.2.0.exe` (~118 MB, NSIS, x64, unsigned)
**SHA-256:** `ad06ac5d1cacb161b664d529b9f15372237a7bf634e7c7721853b045ee6e611b`
