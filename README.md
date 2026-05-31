# Ghost Access 98

A Windows 98–inspired case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

Ghost Access 98 looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management tool that happens to wear a retro shell.

## Status

**v3.2.3** — current release. The 3.2.x line added three modules on top of the v3.0.0 base, then a full adversarial red-team pass that hardened the lot:

- **Jukebox** — a WinAmp-styled, offline-first audio player (local MP3/OGG/FLAC/WAV/M4A + M3U, spectrum visualizer, opt-in internet radio).
- **EyeSpy bulk feed import** — load your own / authorized camera feeds en masse from a CSV / JSON / URL-list file.
- **GeoINT** — a pluggable geopolitical-monitoring dashboard (RSS/Atom/GeoJSON sources + OPML, a Leaflet map with your own tile server, offline gazetteer geocoding) that can **save events into cases** (record / link / note), auto-link a location entity, and write the case timeline.

All of it is offline-first with consent-gated egress, and v3.2.3 folds in every fix from the 2026-05-31 red-team review (0 Critical; 2 High / 3 Medium / 2 Low, all closed). See [Releases & changelog](#releases--changelog), [`SECURITY.md`](SECURITY.md) for the security model, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map, and [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md) for how the build is reviewed.

> **Earlier 3.2.x installers (v3.2.0 / v3.2.1 / v3.2.2) are superseded** — they predate the red-team hardening. Use **v3.2.3**.

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Obsidian-Circuit-LLC/ghost-access-98/releases) and run it.

Direct link to current release: [`GhostAccess98-Setup-3.2.3.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-access-98/releases/download/v3.2.3/GhostAccess98-Setup-3.2.3.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the release notes:

```powershell
Get-FileHash .\GhostAccess98-Setup-3.2.3.exe -Algorithm SHA256
# expected: 2eaaa90ef74c5250021ecdfe5106b5d72869dcd035f3c411d90d9163fd97ef25
```

The installer is **unsigned** (no code-signing certificate yet), so SmartScreen will warn on first run — click **More info → Run anyway**. The app installs per-user (no admin required) and creates a desktop + Start menu shortcut.

To uninstall: Settings → Apps → Ghost Access 98 → Uninstall.

## Modules

| Module | Purpose |
|---|---|
| Case Files | Create, open, rename, archive, delete cases; per-case dashboard with timeline / tasks / links / reminders / attachments / **entities (Family/Associates/Other)** / **bio photos** / **GeoINT events**; **document viewer**, **exports** (PDF/HTML/CSV), and **backup/share** |
| Doc Viewer | In-app viewer for case attachments — PDF, DOCX, HTML, images, CSV, JSON, EML, text (sanitized; no remote fetches) |
| Search | Cross-case search over metadata, entities, and extracted attachment text; exportable results |
| Whiteboard | Per-case pannable/zoomable canvas — text/image/file/link nodes + connectors |
| **Jukebox** | Win98/WinAmp-styled audio player — local **MP3 / OGG / FLAC / WAV / M4A** + **M3U** playlists, spectrum visualizer; internet radio is **opt-in** (off by default). Local files are served through a path-confined internal protocol |
| **GeoINT** | Pluggable geopolitical-monitoring dashboard — **RSS / Atom / GeoJSON** sources + **OPML** import, a **Leaflet** map using a tile server you configure, offline **gazetteer** geocoding + manual pins. Network is **opt-in** (off by default). Save an event into a case as a record / link / note, with an auto-linked location entity + timeline entry |
| Notepad 98 | Plain text editor, saves notes into a case |
| Calendar | Month grid surfacing case + global reminders and task due dates |
| Reminders / Alarm | Case-linked reminders + general alarms; native notifications + synthesized chime |
| Shred | Soft-delete bucket — restore or purge |
| Settings | Sound, theme intensity, startup sound, image/colour wallpaper, default case folder, Access shortcut editor, AI / Mail / Browser providers, and **Security** (enable/disable login, change password, lock now, recovery key) |
| Access Menu | Editable program + web-link shortcuts |
| Net Explorer | Internal browser (`<webview>`); save URLs to a case |
| Mail | IMAP/SMTP client (imapflow + nodemailer), encrypted credentials, synthesized "You have mail" alert |
| DialTerm | SSH / Telnet / FTP client (ssh2 + xterm.js) with a 90s dial-up handshake animation; key-based auth preferred; passwords encrypted at rest; plaintext-protocol warnings |
| EyeSpy | Authorized camera streams — manual URL entry **and bulk import** (CSV/JSON/URL-list) of your own/public feeds (HLS / MJPEG / HTTP refresh; RTSP requires a local ffmpeg→HLS bridge). **No discovery / scanning / brute-force code paths exist** — import parses a file you choose |
| AI Assistant | Pluggable Ollama (local) / OpenAI-compatible providers, with an in-app **"Set up local AI"** wizard; case context is opt-in per message; API keys encrypted at rest |

## Releases & changelog

The current build is **v3.2.3**. Each release page carries its own notes + SHA-256.

- **v3.2.3** — GeoINT → case integration (save events to cases, auto location-entity, timeline) **+ all red-team security fixes** (GeoINT SSRF guard, save-to-case validation, `.m3u`/album-art/stream-URL hardening). Recommended for everyone on 3.2.x.
- **v3.2.2** — GeoINT dashboard (pluggable feeds + Leaflet map + offline geocoding). *Superseded by 3.2.3.*
- **v3.2.1** — EyeSpy bulk feed import. *Superseded by 3.2.3.*
- **v3.2.0** — Jukebox media player. *Superseded by 3.2.3.*
- **v3.1.0** — turnkey local-AI "Set up local AI" wizard (detect/reuse Ollama → pull a model → auto-configure).
- **v3.0.0** — major consolidated release: optional **encrypt-at-rest login**, in-app **document viewer**, cross-case **entity registry**, **bio photos**, auto-emitting **timeline**, **PDF/HTML/CSV exports**, cross-case **search**, a **whiteboard** canvas, **Telnet + FTP** in DialTerm, **backup/restore** + single-case `.ga98case` sharing, image wallpaper, and the Net Explorer fix. Three rounds of adversarial review on the encrypt-at-rest subsystem.

### Security review

The 3.2.x surface went through a dedicated adversarial red-team pass on 2026-05-31: **0 Critical**, with 2 High / 3 Medium / 2 Low findings — all fixed and regression-tested in **v3.2.3**. The path-confinement, egress-gate, and HTML-sanitization surfaces held; the gaps were edge-case input validation and SSRF, now closed. See [`SECURITY.md`](SECURITY.md).

## Build from source

You only need this section if you want to modify the code or build the installer yourself. For just running the app, use the installer link above.

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **pnpm 9+** (`npm install -g pnpm`)
- For producing the Windows installer from Linux: **Wine** (used by `electron-builder` for icon work)

### Setup

```bash
git clone https://github.com/Obsidian-Circuit-LLC/ghost-access-98.git
cd ghost-access-98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:onna-bugeisha-dev-team/ghost-access-98.git` also works. The HTTPS form above requires no key setup.

## Run (development)

```bash
pnpm dev
```

This starts the Vite dev server (HMR) and the Electron main process.

## Build

```bash
pnpm build        # type-check + bundle main / preload / renderer
pnpm test         # vitest suite (162 tests as of v3.2.3)
pnpm package      # platform installer for the current host
pnpm package:win  # cross-build Windows NSIS installer
```

Output lands in `release/`.

## Data location

Ghost Access 98 stores all user data under your OS userData directory in a `GhostAccess98/` folder. Locations:

- Windows: `%APPDATA%\ghost-access-98\GhostAccess98\`
- macOS: `~/Library/Application Support/ghost-access-98/GhostAccess98/`
- Linux: `~/.config/ghost-access-98/GhostAccess98/`

Within that folder you'll find `settings.json`, a `cases/` directory (one folder per case — each with its attachments, notes, bio-images, entity links, whiteboard, timeline, and **saved GeoINT events**), a global `entities.json` registry, `streams.json` (EyeSpy feeds), `media-library.json` + `geoint-sources.json` (Jukebox / GeoINT config), `shred/` (soft-deleted items), `reminders.global.json`, `alarms.json`, and `secrets.enc` (Electron `safeStorage`-encrypted credentials for Mail / SSH / AI).

When **login is enabled**, an `auth.json` appears (the scrypt-wrapped data key and recovery wrap — safe in the clear) and every case-data file on disk becomes AES-256-GCM ciphertext (prefixed with a `GA98ENC1` magic header). `settings.json` stays plaintext so the lock screen can render your theme/wallpaper before you unlock. Deleting the whole `GhostAccess98/` folder resets all state; if login was enabled, that also discards the encrypted data permanently (there is no key escrow).

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action and, for the newer modules, gated behind an explicit off-by-default toggle:
  - **Jukebox** plays local files with zero network; internet radio resolves only after you enable streaming.
  - **GeoINT** fetches no feed and loads no map tile until you tick *Allow GeoINT network*; source URLs are restricted to public hosts (no loopback/private/metadata SSRF), on add, on OPML import, and on every redirect hop.
  - Net Explorer, Mail, DialTerm, EyeSpy, and the AI Assistant all act only on hosts/credentials you supply.
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.
- **Optional encrypt-at-rest**: enable login to encrypt all case data with AES-256-GCM behind a master password. See [`SECURITY.md`](SECURITY.md) for the full model, the backup trust boundary, and how to report a vulnerability.

## License

[MIT](LICENSE) — © 2026 Obsidian Circuit.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- [Leaflet](https://leafletjs.com/) (BSD-2) for the GeoINT map; tile imagery comes from the tile server **you** configure (e.g. OpenStreetMap, subject to its tile-usage policy).
- [music-metadata](https://github.com/borewit/music-metadata) (MIT) for Jukebox tag reading, [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0) for HLS, [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT) for GeoINT feed parsing, and [world-countries](https://github.com/mledoze/countries) (ODbL) for the offline gazetteer.
- All audio chrome (chimes, dial-up) is synthesized at runtime via the Web Audio API. No copyrighted Windows or AOL sound assets are bundled.
