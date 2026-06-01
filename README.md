# Ghost Access 98

A Windows 98–inspired case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

Ghost Access 98 looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management tool that happens to wear a retro shell.

## TL;DR

A retro-skinned but serious, **offline-first** investigative workspace. Cases with attachments,
entities, timelines, exports, and an in-app document viewer — plus a suite of self-owned tools
that never depend on a third-party staying up:

- **Case Files** — the spine: attachments (drag-drop), entities, timeline, bio photos, PDF/HTML/CSV
  exports, cross-case search, and shareable `.ghost` case bundles.
- **Bookmarks** *(new)* — an offline start.me: drag-organized link board, per-link glyph/emoji/favicon,
  shareable `.ghostbookmarks` file.
- **GeoINT / EyeSpy / Jukebox** — pluggable geopolitical feeds + map, your own/authorized camera
  streams, and a WinAmp-style audio player.
- **AI Assistant** — local (Ollama) or remote LLM, opt-in case context, **offline voice
  conversation** (push-to-talk + hands-free, on-device Vosk STT + TTS), API keys encrypted.
- **DialTerm / Net Explorer / Mail** — SSH/Telnet/FTP with a dial-up handshake, a Firefox launcher,
  and IMAP/SMTP.
- **Private by construction:** no telemetry, no phone-home; all egress is explicit and consent-gated;
  optional encrypt-at-rest login (AES-256-GCM). Windows installer; per-user, no admin.

> **Install:** download [`GhostAccess98-Setup-3.4.2.exe`](https://github.com/Dezirae-Stark/ghost-access-98/releases/latest), verify the SHA-256, **More info → Run anyway** (unsigned).

## Status

**v3.4.2** — current release (a fix release on the v3.4.0 base; see the changelog). The v3.4.0 base added **offline voice conversation** to the AI Assistant: talk to it and
hear replies aloud, fully on-device. **Push-to-talk** and **hands-free** (mic stays open; it listens,
answers, and speaks while you read) — speech-to-text is **Vosk on-device** (the browser's built-in
recognizer is cloud, so it's not used), and the spoken reply uses your on-device OS voices. The Vosk
model is operator-supplied (drop a `model.tar.gz` into `resources/vosk/`). A dedicated red-team pass
over the voice surface (0 Critical) scoped mic permission to audio + the app window, closed mic-leak
and double-start paths, and made voice streams cancellable.

**v3.3.0** — a feature release on top of the v3.2.x base, with two full adversarial red-team rounds:

- **Bookmarks** *(new module)* — an offline, self-owned start.me-style link dashboard. Category cards
  you organize by dragging; per-link icon of your choice (glyph / emoji / consent-gated favicon);
  **Share** your board as a portable `.ghostbookmarks` file. Encrypted at rest.
- **AI text-to-speech** *(new)* — replies read aloud with your **on-device** OS voices; cloud voices
  are refused by design. Plus a **STFU** button to stop generation.
- **Net Explorer → Firefox Portable** — the internal browser now launches a bundled Firefox (you
  supply the payload; see [Releases & changelog](#releases--changelog)).
- **Live-testing fixes** — Jukebox & GeoINT now on the desktop/menu; large videos stream; PDFs render;
  retro click + boot sounds; DialTerm touch-tone keypad + Uplink-style connect animation; Help → RTFM.

All offline-first with consent-gated egress. Two red-team rounds on 2026-05-31: **0 Critical**, every
High/Medium closed and regression-tested. See [Releases & changelog](#releases--changelog) and
[`SECURITY.md`](SECURITY.md).

> **Earlier installers (v3.2.x and below) are superseded** — use **v3.3.0**.

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Dezirae-Stark/ghost-access-98/releases) and run it.

Direct link to current release: [`GhostAccess98-Setup-3.4.2.exe`](https://github.com/Dezirae-Stark/ghost-access-98/releases/download/v3.4.2/GhostAccess98-Setup-3.4.2.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the release notes:

```powershell
Get-FileHash .\GhostAccess98-Setup-3.4.2.exe -Algorithm SHA256
# compare against the SHA-256 printed in that version's release notes
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
| **Bookmarks** | Offline start.me-style link dashboard — **category cards** of named links you organize by **dragging**; per-link icon is your choice (glyph / emoji / **consent-gated favicon**); **Share** the whole board as a portable `.ghostbookmarks` file (merge or replace on import). Encrypted at rest; opens links in the Firefox launcher |
| Notepad 98 | Plain text editor, saves notes into a case |
| Calendar | Month grid surfacing case + global reminders and task due dates |
| Reminders / Alarm | Case-linked reminders + general alarms; native notifications + synthesized chime |
| Shred | Soft-delete bucket — restore or purge |
| Settings | Sound, theme intensity, startup sound, image/colour wallpaper, default case folder, Access shortcut editor, AI / Mail / Browser providers, and **Security** (enable/disable login, change password, lock now, recovery key) |
| Access Menu | Editable program + web-link shortcuts |
| Net Explorer | **Firefox Portable launcher** — opens URLs in a bundled Firefox (you supply the payload in `resources/firefox/`); bookmark bar + save-URL-to-case retained |
| Mail | IMAP/SMTP client (imapflow + nodemailer), encrypted credentials, synthesized "You have mail" alert |
| DialTerm | SSH / Telnet / FTP client (ssh2 + xterm.js) with a 90s dial-up handshake animation; key-based auth preferred; passwords encrypted at rest; plaintext-protocol warnings |
| EyeSpy | Authorized camera streams — manual URL entry **and bulk import** (CSV/JSON/URL-list) of your own/public feeds (HLS / MJPEG / HTTP refresh; RTSP requires a local ffmpeg→HLS bridge). **No discovery / scanning / brute-force code paths exist** — import parses a file you choose |
| AI Assistant | Pluggable Ollama (local) / OpenAI-compatible providers, with an in-app **"Set up local AI"** wizard; case context is opt-in per message; API keys encrypted at rest. **Offline voice conversation** — push-to-talk + hands-free, with **on-device Vosk** speech-to-text (model operator-supplied in `resources/vosk/`) and on-device **text-to-speech** for replies (cloud voices refused); **STFU** stops generation |

## Releases & changelog

The current build is **v3.4.2**. Each release page carries its own notes + SHA-256.

- **v3.4.2** — fixes from the next field report. **Jukebox icons visible again** — the v3.4.1 SVG icons inherited the button-face grey and drew invisibly (you could still hover/click them); the icon colour is now pinned. **Internal PDF reader fixed** (`a.toHex is not a function`) — pdf.js parses in a Web Worker (its own JS realm), so the compatibility shim that ran on the main thread never reached it; it now loads inside the worker. **Desktop wallpaper** — a theme image only showed on the lock screen because the desktop layer painted a solid colour over it; the desktop is now transparent to the wallpaper in every intensity. **Friendlier copy** — the Firefox "not bundled" message no longer says *payload*. 205 tests.
- **v3.4.1** — fixes from the v3.4.0 field report: **Jukebox tape-deck transport** — crisp inline-SVG icons replacing the missing-font Unicode glyphs that rendered as boxes, plus **Shuffle** and **Repeat** (off/all/one, with a real shuffle back-history); **GeoINT discoverability** — a default OpenStreetMap basemap the moment you opt into the network (the egress gate is unchanged) and every previously-silent failure now surfaced; and a **responsive STFU** — the streaming render is coalesced to ~16 fps so the stop button isn't starved on huge replies. 205 tests; pure unit-tested playlist-navigation logic.
- **v3.4.0** — **offline voice conversation** in the AI Assistant: push-to-talk + hands-free, on-device **Vosk** speech-to-text (model operator-supplied) + on-device TTS replies, with the mic paused while the AI speaks (no feedback loop). Hardened by a dedicated red-team pass over the voice surface (0 Critical): mic permission scoped to audio + the app window, mic-leak / double-start paths closed, voice streams made cancellable. *Vosk model is operator-supplied — drop a `model.tar.gz` in `resources/vosk/`.*
- **v3.3.0** — **Bookmarks** dashboard (offline start.me, `.ghostbookmarks` share), **AI offline text-to-speech** + **STFU** stop, **Net Explorer → Firefox Portable** launcher, and live-testing fixes (Jukebox/GeoINT discoverability, large-video streaming, PDF render fix, retro click/boot sounds, DialTerm DTMF + Uplink animation, Help → RTFM). **Two red-team rounds: 0 Critical, all High/Medium fixed.** *Firefox payload is operator-supplied — drop it in `resources/firefox/`.*
- **v3.2.3** — GeoINT → case integration (save events to cases, auto location-entity, timeline) **+ all red-team security fixes** (GeoINT SSRF guard, save-to-case validation, `.m3u`/album-art/stream-URL hardening). *Superseded by 3.3.0.*
- **v3.2.2** — GeoINT dashboard (pluggable feeds + Leaflet map + offline geocoding). *Superseded by 3.2.3.*
- **v3.2.1** — EyeSpy bulk feed import. *Superseded by 3.2.3.*
- **v3.2.0** — Jukebox media player. *Superseded by 3.2.3.*
- **v3.1.0** — turnkey local-AI "Set up local AI" wizard (detect/reuse Ollama → pull a model → auto-configure).
- **v3.0.0** — major consolidated release: optional **encrypt-at-rest login**, in-app **document viewer**, cross-case **entity registry**, **bio photos**, auto-emitting **timeline**, **PDF/HTML/CSV exports**, cross-case **search**, a **whiteboard** canvas, **Telnet + FTP** in DialTerm, **backup/restore** + single-case `.ga98case` sharing, image wallpaper, and the Net Explorer fix. Three rounds of adversarial review on the encrypt-at-rest subsystem.

### Security review

The 3.2.x surface went through a dedicated adversarial red-team pass on 2026-05-31 (**0 Critical**, all fixed in v3.2.3). The v3.3.0 additions went through **two further red-team rounds** the same day — **0 Critical**, every High/Medium fixed and regression-tested. Notable: TTS no-cloud is *enforced* (cloud voices refused, fails closed); media streaming is path-confined, media-extension-restricted, and revoked on vault lock; the Firefox launcher's argument-injection surface was probed and held; Bookmarks import is size-capped, re-validated on read, and favicons are limited to base64 raster images fetched behind an SSRF guard + timeout. The **v3.4.0 voice surface** went through its own two-agent pass (0 Critical): microphone permission is scoped to **audio + the main window only** (request *and* check handlers; the unused in-app `<webview>` is disabled), the mic is released on every error/teardown path, double-start is guarded, voice AI streams are cancellable, and Vosk adds **no network egress** (self-contained, model served locally, replies on the on-device TTS path). See [`SECURITY.md`](SECURITY.md).

## Build from source

You only need this section if you want to modify the code or build the installer yourself. For just running the app, use the installer link above.

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **pnpm 9+** (`npm install -g pnpm`)
- For producing the Windows installer from Linux: **Wine** (used by `electron-builder` for icon work)

### Setup

```bash
git clone https://github.com/Dezirae-Stark/ghost-access-98.git
cd ghost-access-98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:Dezirae-Stark/ghost-access-98.git` also works. The HTTPS form above requires no key setup.

## Run (development)

```bash
pnpm dev
```

This starts the Vite dev server (HMR) and the Electron main process.

## Build

```bash
pnpm build        # type-check + bundle main / preload / renderer
pnpm test         # vitest suite (194 tests as of v3.4.0)
pnpm package      # platform installer for the current host
pnpm package:win  # cross-build Windows NSIS installer
```

Output lands in `release/`.

## Data location

Ghost Access 98 stores all user data under your OS userData directory in a `GhostAccess98/` folder. Locations:

- Windows: `%APPDATA%\ghost-access-98\GhostAccess98\`
- macOS: `~/Library/Application Support/ghost-access-98/GhostAccess98/`
- Linux: `~/.config/ghost-access-98/GhostAccess98/`

Within that folder you'll find `settings.json`, a `cases/` directory (one folder per case — each with its attachments, notes, bio-images, entity links, whiteboard, timeline, and **saved GeoINT events**), a global `entities.json` registry, `streams.json` (EyeSpy feeds), `media-library.json` + `geoint-sources.json` (Jukebox / GeoINT config), `bookmarks-board.json` (Bookmarks dashboard), `shred/` (soft-deleted items), `reminders.global.json`, `alarms.json`, and `secrets.enc` (Electron `safeStorage`-encrypted credentials for Mail / SSH / AI).

When **login is enabled**, an `auth.json` appears (the scrypt-wrapped data key and recovery wrap — safe in the clear) and every case-data file on disk becomes AES-256-GCM ciphertext (prefixed with a `GA98ENC1` magic header). `settings.json` stays plaintext so the lock screen can render your theme/wallpaper before you unlock. Deleting the whole `GhostAccess98/` folder resets all state; if login was enabled, that also discards the encrypted data permanently (there is no key escrow).

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action and, for the newer modules, gated behind an explicit off-by-default toggle:
  - **Jukebox** plays local files with zero network; internet radio resolves only after you enable streaming.
  - **GeoINT** fetches no feed and loads no map tile until you tick *Allow GeoINT network*; source URLs are restricted to public hosts (no loopback/private/metadata SSRF), on add, on OPML import, and on every redirect hop.
  - **Bookmarks** stores and opens links with zero network; favicon fetching happens only after you enable it (off by default), behind the same public-host SSRF guard + a fetch timeout.
  - **AI voice** is fully on-device: speech-to-text uses **Vosk** (WASM, in-app — never the browser's cloud recognizer), the model is served locally, and replies use on-device OS voices only (cloud voices refused). The microphone is granted only to the app window for audio, and released on teardown. Voice turns send case metadata context only.
  - Net Explorer hands URLs to a bundled Firefox (a separate process with its own engine). Mail, DialTerm, EyeSpy, and the AI Assistant all act only on hosts/credentials you supply.
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.
- **Optional encrypt-at-rest**: enable login to encrypt all case data with AES-256-GCM behind a master password. See [`SECURITY.md`](SECURITY.md) for the full model, the backup trust boundary, and how to report a vulnerability.

## License

[MIT](LICENSE) — © 2026 Desirae Stark.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- [Leaflet](https://leafletjs.com/) (BSD-2) for the GeoINT map; tile imagery comes from the tile server **you** configure (e.g. OpenStreetMap, subject to its tile-usage policy).
- [music-metadata](https://github.com/borewit/music-metadata) (MIT) for Jukebox tag reading, [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0) for HLS, [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT) for GeoINT feed parsing, and [world-countries](https://github.com/mledoze/countries) (ODbL) for the offline gazetteer.
- All audio chrome (chimes, dial-up, mouse clicks, boot swell, DTMF) is synthesized at runtime via the Web Audio API. No copyrighted Windows or AOL sound assets are bundled.
- Text-to-speech uses the OS's own voices via the Web Speech API (no bundled voices, on-device only).
- Offline speech-to-text uses [Vosk](https://alphacephei.com/vosk/) via [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Apache-2.0, WASM). The speech model is **not** vendored in this repo and is supplied by the operator (`resources/vosk/model.tar.gz`); verify the model's license before bundling it in a published installer.
- The Net Explorer launcher targets [Firefox Portable](https://www.mozilla.org/firefox/) (Mozilla, MPL-2.0). The Firefox payload is **not** vendored in this repo and is supplied by the operator; bundling/redistributing it must follow Mozilla's trademark and distribution policy.
