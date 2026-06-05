# Dead Cyber Society 98

A Windows 98–inspired OSINT / case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

**Dead Cyber Society 98 (DCS98)** looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management and OSINT tool that happens to wear a retro shell.

> **Formerly "Ghost Access 98."** v3.6.0 renames the program to Dead Cyber Society 98. Your data is migrated forward automatically on first launch (see [Data location](#data-location)).

## TL;DR

A retro-skinned but serious, **offline-first** investigative workspace. Cases with attachments,
entities, timelines, exports, and an in-app document viewer — plus a suite of self-owned tools
that never depend on a third-party staying up:

- **My Cases** — the spine: attachments (drag-drop), entities, timeline, bio photos, PDF/HTML/CSV
  exports, cross-case search, and shareable `.ghost` case bundles.
- **Sticky Notes** *(new)* — Win95-style draggable desktop notes (text, icon, color); fired reminders
  surface as notes you dismiss with **OK**; a global **Hide**. Persists, encrypted at rest.
- **AI Assistant** — local (Ollama) or remote LLM, opt-in case context, **conversation memory**
  (ChatGPT-style saved-chat sidebar), right-click copy, and **offline voice conversation**
  (push-to-talk + hands-free, on-device Vosk STT + TTS), API keys encrypted.
- **Markets** — offline-first market overview (crypto / FX / indices / equities / commodities) with an
  editable watchlist and bring-your-own feeds, off by default.
- **GeoINT / EyeSpy / Jukebox** — pluggable geopolitical feeds + map (2D / satellite / **Street View**),
  your own/authorized camera streams, and a Win98 CD-Player audio player.
- **Bookmarks** — an offline start.me: drag-organized link board, per-link glyph/emoji/favicon,
  shareable `.ghostbookmarks` file.
- **Briefcase & Solitaire** — a home for loose notes that aren't tied to a case, and a full Klondike
  card game (drag-and-drop + win cascade) for the Win98 vibes.
- **DialTerm / Net Explorer / Mail** — SSH/Telnet/FTP with a dial-up handshake, a Firefox launcher,
  and IMAP/SMTP.
- **Private by construction:** no telemetry, no phone-home; all egress is explicit and consent-gated;
  optional encrypt-at-rest login (AES-256-GCM). Windows installer; per-user, no admin.

> **Install:** download [`DCS98-Setup-3.6.4.exe`](https://github.com/Obsidian-Circuit-LLC/dcs98/releases/latest), verify the SHA-256, **More info → Run anyway** (unsigned).

## Status

**v3.6.4** — current release: the **in-app PDF viewer renders again** (it relied on a JS method
Electron 33's Chromium doesn't ship yet; v3.6.4 polyfills it). This clears the v3.6.3 known issue.

**v3.6.3** added **desktop polish** — the **DCS98 flame wallpaper** as the default background,
desktop icons in a single **vertical left-edge column**, an authentic Win95 **My Computer** icon for
**My Cases**, and a **draggable sticky-notes bar** that no longer overlaps the window minimise/close
buttons.

**v3.6.2** added **Solitaire** (Klondike, with full card drag-and-drop and the classic
bouncing-card win cascade), in the Access menu.

**v3.6.1** added the **Briefcase** (standalone text notes not tied to any case — browse them in the
Briefcase app or save straight there from Notepad 98), GeoINT **street-name labels** + a one-click tile
**Reset**, and **Shred** pinned to the bottom-right corner like the Recycle Bin.

**v3.6.0** renamed the program to **Dead Cyber Society 98 (DCS98)** (with automatic data migration from the
old install) and cleared a full field-report punch list:

- **Sticky Notes** *(new module)* — a Win95-style desktop note layer (drag, type, pick icon + color),
  fired reminders rendered as notes, and a global Hide.
- **AI conversation memory** *(new)* — a ChatGPT-style sidebar of saved chats: new / resume / delete,
  auto-saved; plus **right-click to copy** a message or the whole conversation, and a default model of
  `qwen3-abliterated:4b`.
- **GeoINT** — **Street View**, a proper **Load** button for custom tiles, "Street" renamed **2D Map**,
  and a map that resizes correctly.
- **Markets** — a first-run intro popup with "Don't show again."
- **Fixes** — minimizing a window no longer wipes its state (the **Jukebox keeps playing**, the **AI
  conversation and Notepad text survive**); **Mail** connects (provider
  presets, STARTTLS, app-password guidance) and the Compose window can always be closed; **My Cases** no
  longer shows the previous case's identity when you switch; the **Calendar** off-by-one is fixed with a
  right-click delete; the **Jukebox** double-pause is gone; **Bookmarks** scale to their link count; and
  **Net Explorer** gains an "Open the Firefox folder" button.

Migration carries an existing **Ghost Access 98** install's data forward on first launch (copy-not-move,
and only committed if every file copies — no silent loss). Every release is hardened by a pre-release
adversarial red-team (**0 Critical**; all High/Medium fixed). **243 tests.**

The v3.5.0 base added a **Markets** module, a stronger **GeoINT** (satellite, search, auto-refresh), and
**in-app playback of encrypted media**. v3.4.x added **offline voice conversation** to the AI Assistant —
on-device Vosk STT + OS TTS, fully local. See [Releases & changelog](#releases--changelog) and
[`SECURITY.md`](SECURITY.md).

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Obsidian-Circuit-LLC/dcs98/releases) and run it.

Direct link to the current release: [`DCS98-Setup-3.6.4.exe`](https://github.com/Obsidian-Circuit-LLC/dcs98/releases/download/v3.6.4/DCS98-Setup-3.6.4.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the release notes:

```powershell
Get-FileHash .\DCS98-Setup-3.6.4.exe -Algorithm SHA256
# compare against the SHA-256 printed in that version's release notes
```

The installer is **unsigned** (no code-signing certificate yet), so SmartScreen will warn on first run — click **More info → Run anyway**. The app installs per-user (no admin required) and creates a desktop + Start menu shortcut.

To uninstall: Settings → Apps → Dead Cyber Society 98 → Uninstall.

## Modules

| Module | Purpose |
|---|---|
| My Cases | Create, open, rename, archive, delete cases; per-case dashboard with timeline / tasks / links / reminders / attachments / **entities (Family/Associates/Other)** / **bio photos** / **GeoINT events**; **document viewer**, **exports** (PDF/HTML/CSV), and **backup/share** |
| Sticky Notes | Win95-style draggable desktop notes — text, a chosen icon and color; **fired reminders appear as notes** (OK to clear); a global **Hide**. Persists, encrypted at rest, zero network |
| Briefcase | Standalone text notes not tied to any case — browse/edit/delete them here, or pick **💼 Briefcase** in Notepad 98's selector to save straight in. Encrypted at rest, zero network |
| Doc Viewer | In-app viewer for case attachments — PDF, DOCX, HTML, images, CSV, JSON, EML, text (sanitized; no remote fetches) |
| Search | Cross-case search over metadata, entities, and extracted attachment text; exportable results |
| Whiteboard | Per-case pannable/zoomable canvas — text/image/file/link nodes + connectors |
| **Markets** | Offline-first market overview — crypto (CoinGecko), FX (Frankfurter/ECB), indices/equities/commodities (Yahoo); editable watchlist + bring-your-own custom feeds. Network is **opt-in** (off by default); 60s auto-refresh while on |
| **Jukebox** | Win98 CD-Player audio player — local **MP3 / OGG / FLAC / WAV / M4A** + **M3U** playlists, spectrum visualizer; internet radio is **opt-in** (off by default). Local files are served through a path-confined internal protocol |
| **GeoINT** | Pluggable geopolitical-monitoring dashboard — **RSS / Atom / GeoJSON** sources + **OPML** import, a **Leaflet** map (**2D** custom tiles, **Satellite**, **Street View**), offline **gazetteer** geocoding + manual pins. Network is **opt-in** (off by default). Save an event into a case as a record / link / note |
| **Bookmarks** | Offline start.me-style link dashboard — **category cards** of named links you organize by **dragging** (cards auto-scale to their link count); per-link icon of your choice (glyph / emoji / **consent-gated favicon**); **Share** the whole board as a portable `.ghostbookmarks` file |
| Notepad 98 | Plain text editor — saves notes into a case, or into the **Briefcase** when "💼 Briefcase" is picked in the selector |
| Solitaire | Klondike card game — full drag-and-drop, foundations A→K, Draw 1/3, double-click-to-foundation, and the classic bouncing-card **win cascade**. Self-contained, offline, zero data |
| Calendar | Month grid surfacing case + global reminders and task due dates; right-click a reminder to delete it |
| Reminders / Alarm | Case-linked reminders + general alarms; native notifications + synthesized chime; fired reminders surface as desktop sticky notes |
| Shred | Soft-delete bucket — restore or purge |
| Settings | Sound, theme intensity, startup sound, image/colour wallpaper, default case folder, Access shortcut editor, AI / Mail / Browser providers, and **Security** (enable/disable login, change password, lock now, recovery key) |
| Access Menu | Editable program + web-link shortcuts |
| Net Explorer | **Firefox Portable launcher** — opens URLs in a bundled Firefox (you supply the payload in `resources/firefox/`; an **"Open the Firefox folder"** button takes you straight there); bookmark bar + save-URL-to-case retained |
| Mail | IMAP/SMTP client (imapflow + nodemailer) with provider presets + app-password guidance, encrypted credentials, synthesized "You have mail" alert |
| DialTerm | SSH / Telnet / FTP client (ssh2 + xterm.js) with a 90s dial-up handshake animation; key-based auth preferred; passwords encrypted at rest; plaintext-protocol warnings |
| EyeSpy | Authorized camera streams — manual URL entry **and bulk import** (CSV/JSON/URL-list) of your own/public feeds (HLS / MJPEG / HTTP refresh; RTSP requires a local ffmpeg→HLS bridge). **No discovery / scanning / brute-force code paths exist** |
| AI Assistant | Pluggable Ollama (local, default model `qwen3-abliterated:4b`) / OpenAI-compatible providers, with an in-app **"Set up local AI"** wizard; **saved-conversation memory**; case context opt-in per message; API keys encrypted. **Offline voice conversation** — push-to-talk + hands-free, **on-device Vosk** STT (model operator-supplied in `resources/vosk/`) and on-device **TTS** for replies; **STFU** stops generation |

## Releases & changelog

The current build is **v3.6.4**. Each release page carries its own notes + SHA-256.

- **v3.6.4** — **PDF viewer fix**: the in-app Doc Viewer renders PDFs again. pdfjs-dist 5.x calls
  `Map.prototype.getOrInsertComputed()` during render — a TC39 method Electron 33's Chromium 130
  doesn't ship — so render threw and the viewer blanked; v3.6.4 adds a spec-faithful polyfill (Map +
  WeakMap) in both the renderer and pdf.js worker realms, guarded to no-op once Chromium ships it.
  Renderer-only. 243 tests (5 new).
- **v3.6.3** — **Desktop polish**: the **DCS98 flame** image is the default wallpaper (desktop + lock
  screen); desktop icons flow as a single **vertical left-edge column**; **My Cases** uses an authentic
  Win95 **My Computer** icon (pixel-art SVG); and the **New note / Hide notes** bar is a **draggable**
  widget with a grip handle, defaulted to bottom-centre so it no longer covers the window minimise/close
  buttons (position remembered). Renderer/UI only — no IPC, egress, or crypto touched. 238 tests.
- **v3.6.2** — **Solitaire (Klondike)**: green-felt card game with full drag-and-drop (move a card and the
  run beneath it), build foundations A→K, double-click to a foundation, Draw 1/3, and the iconic
  bouncing-card **win cascade**. Self-contained — no network, storage, or data. In the Access menu. 238 tests.
- **v3.6.1** — **Briefcase** (standalone text notes not tied to a case, with a 💼 target in Notepad 98's
  selector); **GeoINT** street/place-name **Labels** overlay (Esri reference layers, gated, no new egress
  domain) + a tile **Reset** + the default OSM URL shown as a placeholder; **Shred** moved to the
  bottom-right corner. Red-team: fixed a save/read UUID-validation mismatch in the Briefcase + AI-conversation
  stores. 232 tests.
- **v3.6.0** — **Renamed to Dead Cyber Society 98 (DCS98)** with automatic data migration from the old
  install. New: **Sticky Notes** desktop layer; **AI conversation memory** (saved-chat sidebar) + right-click
  copy + default `qwen3-abliterated:4b`; **GeoINT Street View** + custom-tile **Load** button + **2D Map**
  relabel + map-resize fix; **Markets** first-run tutorial. Fixes: **minimize no longer wipes state**
  (Jukebox keeps playing, AI/Notepad preserved), **Mail** (provider presets, STARTTLS,
  always-closable Compose), **My Cases** rename + cross-case identity-leak fix, **Calendar** off-by-one +
  right-click delete, **Jukebox** double-pause, **Bookmarks** auto-scale, Net Explorer **"Open the Firefox
  folder"** button. Pre-release red-team (0 Critical; all High/Medium fixed). 228 tests.
- **v3.5.0** — **Markets module** (offline-first market overview, off by default); **GeoINT** Street/Satellite toggle, place search, 5-min auto-refresh, layout fix; **Bookmarks** vertically resizable; **Jukebox** restyled to the Win98 CD Player; **encrypted media plays in-app**. Pre-release red-team — DNS-aware SSRF guard, fetch timeout/size caps. 218 tests.
- **v3.4.x** — **offline voice conversation** in the AI Assistant: push-to-talk + hands-free, on-device **Vosk** STT + on-device TTS replies, mic paused while the AI speaks. Dedicated voice red-team (0 Critical). Plus Jukebox transport/icons, GeoINT discoverability, responsive STFU, PDF/wallpaper/copy fixes. *Vosk model is operator-supplied — drop a `model.tar.gz` in `resources/vosk/`.*
- **v3.3.0** — **Bookmarks** dashboard (offline start.me, `.ghostbookmarks` share), **AI offline text-to-speech** + **STFU**, **Net Explorer → Firefox Portable** launcher, live-testing fixes. **Two red-team rounds: 0 Critical.** *Firefox payload is operator-supplied — drop it in `resources/firefox/`.*
- **v3.2.x** — Jukebox media player, EyeSpy bulk feed import, GeoINT dashboard + case integration, with red-team security fixes (SSRF guard, save-to-case validation, `.m3u`/stream-URL hardening).
- **v3.1.0** — turnkey local-AI "Set up local AI" wizard (detect/reuse Ollama → pull a model → auto-configure).
- **v3.0.0** — major consolidated release: optional **encrypt-at-rest login**, in-app **document viewer**, cross-case **entity registry**, **bio photos**, auto-emitting **timeline**, **PDF/HTML/CSV exports**, cross-case **search**, a **whiteboard** canvas, **Telnet + FTP** in DialTerm, **backup/restore** + single-case `.ga98case` sharing, image wallpaper, and the Net Explorer fix.

### Security review

Every feature release goes through an adversarial red-team pass; the standing bar is **0 Critical**, with
all High/Medium findings fixed and regression-tested. Highlights across the suite: TTS no-cloud is
*enforced* (cloud voices fail closed); media streaming is path-confined and revoked on vault lock; outbound
fetches (market/geoint/favicon) reject hosts that *resolve* to loopback/private/metadata and are
timeout/size-capped; the GeoINT Street View embed loads Google imagery **only on explicit action while the
GeoINT network is on**, nothing third-party loads until you open it, and a Firefox fallback covers blocked
framing; the v3.6.0 data migration commits only when every file copies (no partial-copy data loss). See
[`SECURITY.md`](SECURITY.md).

## Build from source

You only need this section if you want to modify the code or build the installer yourself. For just running the app, use the installer link above.

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **pnpm 9+** (`npm install -g pnpm`)
- For producing the Windows installer from Linux: **Wine** (used by `electron-builder` for icon work)

### Setup

```bash
git clone https://github.com/Obsidian-Circuit-LLC/dcs98.git
cd dcs98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:Obsidian-Circuit-LLC/dcs98.git` also works. The HTTPS form above requires no key setup.

## Run (development)

```bash
pnpm dev
```

This starts the Vite dev server (HMR) and the Electron main process.

## Build

```bash
pnpm build        # type-check + bundle main / preload / renderer
pnpm test         # vitest suite (243 tests as of v3.6.4)
pnpm package      # platform installer for the current host
pnpm package:win  # cross-build Windows NSIS installer
```

Output lands in `release/`.

## Data location

Dead Cyber Society 98 stores all user data under your OS userData directory in a `GhostAccess98/` folder
(the inner folder name is kept stable across the rename so existing data resolves unchanged). Locations:

- Windows: `%APPDATA%\Dead Cyber Society 98\GhostAccess98\`
- macOS: `~/Library/Application Support/Dead Cyber Society 98/GhostAccess98/`
- Linux: `~/.config/Dead Cyber Society 98/GhostAccess98/`

On first launch after upgrading from **Ghost Access 98**, the app copies your old data
(`%APPDATA%\Ghost Access 98\…`) into the new location — it **copies, never moves**, leaving the old data
intact as a safety net, and only marks the migration done if every file copied.

Within that folder you'll find `settings.json`, a `cases/` directory (one folder per case — each with its attachments, notes, bio-images, entity links, whiteboard, timeline, and **saved GeoINT events**), a global `entities.json` registry, `streams.json` (EyeSpy feeds), `media-library.json` + `geoint-sources.json` (Jukebox / GeoINT config), `bookmarks-board.json` (Bookmarks dashboard), `sticky-notes.json`, `ai-conversations.json`, `shred/` (soft-deleted items), `reminders.global.json`, `alarms.json`, and `secrets.enc` (Electron `safeStorage`-encrypted credentials for Mail / SSH / AI).

When **login is enabled**, an `auth.json` appears (the scrypt-wrapped data key and recovery wrap — safe in the clear) and every case-data file on disk becomes AES-256-GCM ciphertext (prefixed with a `GA98ENC1` magic header). `settings.json` stays plaintext so the lock screen can render your theme/wallpaper before you unlock. Deleting the whole `GhostAccess98/` folder resets all state; if login was enabled, that also discards the encrypted data permanently (there is no key escrow).

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action and, for the newer modules, gated behind an explicit off-by-default toggle:
  - **Sticky Notes**, **Bookmarks** (storage), **Jukebox** (local files), and **My Cases** touch the network never.
  - **Markets** and **GeoINT** fetch nothing until you enable their network toggle; outbound hosts are restricted to public addresses (no loopback/private/metadata SSRF) on add, on import, and on every redirect hop, with fetch timeouts and response-size caps.
  - **GeoINT Street View** loads Google's street imagery only when you open it while the GeoINT network is on; an "Open in Firefox" fallback covers blocked framing.
  - **AI voice** is fully on-device: speech-to-text uses **Vosk** (WASM, in-app — never the browser's cloud recognizer), the model is served locally, and replies use on-device OS voices only (cloud voices refused).
  - Net Explorer hands URLs to a bundled Firefox (a separate process). Mail, DialTerm, EyeSpy, and the AI Assistant act only on hosts/credentials you supply.
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.
- **Optional encrypt-at-rest**: enable login to encrypt all case data with AES-256-GCM behind a master password. See [`SECURITY.md`](SECURITY.md) for the full model, the backup trust boundary, and how to report a vulnerability.

## License

[MIT](LICENSE) — © 2026 Desirae Stark.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- [Leaflet](https://leafletjs.com/) (BSD-2) for the GeoINT map; tile imagery comes from the tile server **you** configure (e.g. OpenStreetMap, subject to its tile-usage policy). Street View imagery is Google's, loaded only on explicit action.
- [music-metadata](https://github.com/borewit/music-metadata) (MIT) for Jukebox tag reading, [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0) for HLS, [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) for the PDF viewer, [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT) for GeoINT feed parsing, and [world-countries](https://github.com/mledoze/countries) (ODbL) for the offline gazetteer.
- All audio chrome (chimes, dial-up, mouse clicks, boot swell, DTMF) is synthesized at runtime via the Web Audio API. No copyrighted Windows or AOL sound assets are bundled.
- Text-to-speech uses the OS's own voices via the Web Speech API (no bundled voices, on-device only).
- Offline speech-to-text uses [Vosk](https://alphacephei.com/vosk/) via [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Apache-2.0, WASM). The speech model is **not** vendored in this repo and is supplied by the operator (`resources/vosk/model.tar.gz`); verify the model's license before bundling it in a published installer.
- The Net Explorer launcher targets [Firefox Portable](https://www.mozilla.org/firefox/) (Mozilla, MPL-2.0). The Firefox payload is **not** vendored in this repo and is supplied by the operator; bundling/redistributing it must follow Mozilla's trademark and distribution policy.
