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

> **Install:** download [`DCS98-Setup-3.12.0-beta.1.exe`](https://github.com/Obsidian-Circuit-LLC/dcs98/releases/latest), verify the SHA-256, **More info → Run anyway** (unsigned). *(Current build includes the **experimental** Tor P2P chat — see Status.)*

## Status

**v3.12.0-beta.1** — current release. A large one — post-quantum hardening, games, and case tooling:

- **PQ hardening — ML-KEM-1024 via AWS-LC.** The chat handshake's ML-KEM leg moves from the
  unaudited pure-JS ML-KEM-768 to **ML-KEM-1024** (CNSA 2.0 / FIPS-203 category 5), served by a native
  **AWS-LC** sidecar behind a fail-closed seam in `crypto.ts` — addressing the implementation
  side-channel + parameter-strength gaps that formal verification can't see. The handshake construction
  is unchanged and still **EXPERIMENTAL / not formally verified**. *(The Windows installer bundles a
  functional cross-built helper; the FIPS-validated module build is a CI follow-up — see release notes.)*
- **Games.** **Minesweeper**, **Chess** (full legal-move engine — castling, en passant, promotion,
  check/checkmate/stalemate), and a Win98-style **Pinball**, grouped under a new Access **"Games ▸"**
  submenu (off the desktop).
- **Case evidence migration.** Four buttons in the case detail — **Copy Evidence / Zip Files / Export to
  Desktop / Import Case** — for moving cases + their evidence between app users.
- **ExifTool metadata.** Rich attachment metadata in the ⓘ panel via an optional bundled ExifTool.
- **RTFM Hacktivist Ethos** content ("The Ten Nodes of Hacktivism", by GhostExodus), **whiteboard tile
  colours**, and a **chat first-run guide** (Don't-show-again).

434 automated tests. *Everything from v3.11.x and earlier carries forward unchanged.*

**v3.11.1-beta.1** — Fixes invisible checkboxes:

- **Checkboxes are visible again.** 98.css draws a checkbox's box via an `input + label` sibling
  element and hides the real input; DCS98's checkboxes nest the input inside the label, so the box
  never drew — every checkbox (Settings, GeoINT, Mail TLS, case tasks, …) rendered as a label with no
  visible box. They still toggled when you clicked the text, but there was nothing to see. A single CSS
  rule restores a real, visible control. This is what made the new **Legacy sound pack** toggle look
  missing in v3.11.0.

429 automated tests. *Everything from v3.11.0-beta.1 (opt-in Legacy sound pack + uninstall fix) and
earlier carries forward unchanged.*

**v3.11.0-beta.1** — Optional Legacy sound pack + an uninstall fix:

- **Legacy sound pack (opt-in).** A new **Settings → Sound** toggle swaps the startup chime and the
  DialTerm dial-up for **AI-reworked recordings of the classic Windows startup jingle and dial-up
  handshake**. **Off by default**; the synthesized sounds remain the default. These two clips are the
  only bundled audio in the app, and they are **derivative works of their originals** — shipped as a
  deliberate, opt-in choice. When Legacy dial-up is on, the connection client's stage stepper and log
  are paced to the clip's length.
- **Fixed: the uninstaller could fail after enabling chat.** The app spawns a bundled `tor.exe` for
  P2P chat; the on-quit teardown that kills it ran in an `async` handler Electron didn't wait for, so
  the process could orphan and hold a file lock inside the install directory, breaking uninstall. Quit
  now blocks on teardown (bounded by a timeout) before exiting. *(Already-stuck installs: end any
  `tor.exe` in Task Manager, then uninstall.)*

429 automated tests. *Everything from v3.10.0-beta.1 (DialTerm dial-up client + authentic handshake)
and earlier carries forward unchanged.*

**v3.10.0-beta.1** — DialTerm gets a dial-up *client* and an authentic handshake:

- **DCS98 dial-up connection client** — the DialTerm connecting screen is now a familiar dial-up-client
  layout: a **DCS98 logo header**, a three-panel **DIAL → LINK → AUTH** stage stepper (with a little
  walking "marcher" in the active panel and ✓ on completed stages) and an AOL-style status caption —
  wrapped around the existing uplink **packet animation** and the live negotiation log. DCS98-branded,
  no third-party marks.
- **Authentic dial-up handshake** — the DialTerm connect sound is rebuilt to follow a real V-series
  sequence: **dial tone → DTMF dialing → 2100 Hz answer + V.8 "bong" → V.21 negotiation → echo-cancel
  tone → V.34 line-probe "gallop" → scrambled-data roar**, beat-locked to the packet animation so the
  stage stepper, log, and audio advance together. Still **fully synthesized at runtime** from functional
  telephony / V-series frequencies — no sampled or copyrighted assets.

429 automated tests. *Everything from v3.9.1-beta.1 (Notepad icon + reworked startup/hang-up sounds),
v3.9.0-beta.1 (photo-embedding case reports, RTFM left-rail manual) and v3.8.0-beta.1 (experimental Tor
P2P chat, offline Piper TTS) carries forward unchanged.*

**v3.9.1-beta.1** — a look-and-feel pass:

- **New Notepad desktop icon** — a hand-drawn Windows-98-style spiral notepad (teal header, ruled
  page, spiral binding) replacing the generic glyph, in the same crisp-pixel style as My Computer.
- **Reworked sounds (all still synthesized at runtime — no sampled assets):** a warmer, more
  synthetic power-on swell; a fuller dial-up **handshake** in DialTerm whose tones are **beat-synced
  to the uplink connect animation** (each data chirp lands as a packet crosses the link, and the
  negotiation log reveals on the same beat); and a new **hang-up** sound — a legacy handset dropped
  back onto its cradle.

429 automated tests. *Everything from v3.9.0-beta.1 (photo-embedding case reports, RTFM left-rail
manual) and v3.8.0-beta.1 (experimental Tor P2P chat, offline Piper TTS) carries forward unchanged.*

**v3.9.0-beta.1** — two refinements on top of the v3.8.0 feature set:

- **Case reports now embed photos.** Exporting a case (Export… → **HTML** or **PDF**) inlines the
  case's **bio images** and any **image attachments** directly in the report, instead of just listing
  attachment names. Images are decrypted in the main process and embedded as `data:` URIs (the only
  thing the offline, script-disabled PDF renderer can show); a 24 MiB total / 8 MiB per-image budget
  keeps reports from ballooning, and anything skipped is footnoted.
- **RTFM is now a left-rail manual.** The Help (RTFM) window gained a sidebar: **Manual**
  (shortcuts + module reference + privacy), **OpChildSafety** (lifted into its own page),
  **Hacktivist Ethos**, and **OSINT**. The last two are live nav slots with placeholder pages —
  content from GhostExodus to drop in.

429 automated tests. *Everything from v3.8.0-beta.1 (experimental Tor P2P chat, offline Piper TTS)
carries forward unchanged.*

**v3.8.0-beta.1** — two big additions, both opt-in:

- **P2P chat over Tor** (⚠ **EXPERIMENTAL** — the PQ-hybrid handshake crypto is **not yet formally
  verified**; a loud in-app banner says so, and it's off by default). Invite-link **1:1** with an
  X25519 + ML-KEM-768 handshake (no hosting, loopback-only sockets), plus **file attachments**
  (whole-file SHA-256 verified before anything touches disk, received files held in an encrypted-at-rest
  quarantine with an explicit Save step), **small groups** (client-side fan-out — *zero new
  cryptography*; each message rides your existing 1:1 sessions), and **case-aware sharing** (a 📤 action
  on case entities and attachments sends them straight into a chat). Each phase was adversarially
  red-teamed and authorization-hardened.
- **Offline neural TTS (Piper)** — a bundled, fully-offline voice (`en_US-ljspeech-high`, **public-domain**
  LJ Speech dataset) as a selectable engine in the AI assistant, default when present, with the OS /
  Web-Speech path retained as fallback. Synthesizes locally, model bundled → **zero runtime egress**.

424 automated tests. *Bundled Tor + Piper binaries are fetched + SHA-256-verified (fail-closed) at
build time; see `scripts/fetch-tor.mjs` / `scripts/fetch-piper.mjs`.*

**v3.7.0-beta.1** — first cut of the experimental Tor-only P2P chat (invite-link 1:1; PQ-hybrid
handshake; bundled SHA-256-verified Tor). Superseded by v3.8.0-beta.1.

**v3.6.8** — a new **OpChildSafety** section in **RTFM** (Help) — field guidance for
grassroots child-protection / OSINT investigators on reporting CSAM lawfully through the proper
channels (NCMEC, IWF, CEOP, HSI, ACCCE, Cybertip.ca, Europol IRU, INHOPE, NCA) **without** viewing,
downloading, or mishandling material, plus evidence-handling do's and don'ts. Reference content only;
official reporting links open in your OS browser. Contributed by GhostExodus.

**v3.6.7** — a proper in-app **exit**. The Access (Start) menu now has a
**Shut Down…** entry (with a confirm) that quits the app cleanly — previously the only way out was the
native title-bar X, which a Win98-style shell trains you not to look for. Also: the **GeoINT** left
menu is a little wider so the View row and event titles no longer clip.

**v3.6.6** — a **warmer, lower startup chime** (an original synthesized power-on
swell — no sampled assets), and two **TTS voice-picker** fixes. The on-device voice selector no
longer **silently disappears** when no eligible voice is found — it now says *why* (cloud voices are
blocked by design; install Windows Natural voices) — and voice discovery is now **live**, so voices
that the OS populates after launch (or a freshly installed voice pack) appear without a restart.

**v3.6.5** — the **AI can now read PDF case attachments**. PDFs were previously
rejected as binary; the assistant now extracts the PDF **text layer** (offline, through the same
pdf.js engine the viewer uses — no OCR, no network) and folds it into case context, under the same
remote-egress confirmation and size caps as every other attachment. Also: **sticky notes are now
resizable** — drag the grip in a note's bottom-right corner; the size persists per note.

**v3.6.4** — the **in-app PDF viewer renders again** (it relied on a JS method
Electron 33's Chromium doesn't ship yet; v3.6.4 polyfills it). This cleared the v3.6.3 known issue.

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
adversarial red-team (**0 Critical**; all High/Medium fixed). **254 tests.**

The v3.5.0 base added a **Markets** module, a stronger **GeoINT** (satellite, search, auto-refresh), and
**in-app playback of encrypted media**. v3.4.x added **offline voice conversation** to the AI Assistant —
on-device Vosk STT + OS TTS, fully local. See [Releases & changelog](#releases--changelog) and
[`SECURITY.md`](SECURITY.md).

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Obsidian-Circuit-LLC/dcs98/releases) and run it.

Direct link to the current release: [`DCS98-Setup-3.12.0-beta.1.exe`](https://github.com/Obsidian-Circuit-LLC/dcs98/releases/download/v3.12.0-beta.1/DCS98-Setup-3.12.0-beta.1.exe)
(experimental P2P chat + Piper TTS; the chat crypto is unverified — see Status). The last
fully-stable build is [`DCS98-Setup-3.6.8.exe`](https://github.com/Obsidian-Circuit-LLC/dcs98/releases/download/v3.6.8/DCS98-Setup-3.6.8.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the release notes:

```powershell
Get-FileHash .\DCS98-Setup-3.12.0-beta.1.exe -Algorithm SHA256
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
| AI Assistant | Pluggable Ollama (local, default model `qwen3-abliterated:4b`) / OpenAI-compatible providers, with an in-app **"Set up local AI"** wizard; **saved-conversation memory**; case context opt-in per message; API keys encrypted. **Offline voice conversation** — push-to-talk + hands-free, **on-device Vosk** STT (model operator-supplied in `resources/vosk/`) and on-device **TTS** for replies; **STFU** stops generation. TTS has a bundled offline **Piper** neural-voice engine (selectable alongside OS voices; zero egress) |
| **Chat** *(beta, experimental)* | Opt-in **Tor-only P2P chat** — invite-link **1:1** with a PQ-hybrid X25519 + ML-KEM-768 handshake (no hosting, loopback-only sockets), **file attachments** (hash-verified, encrypted quarantine + explicit save), **small groups** (client-side fan-out), and **case-aware sharing** from the case module. ⚠ The handshake crypto is **EXPERIMENTAL / not formally verified** (loud in-app banner); off by default. Bundled SHA-256-verified Tor (`resources/tor/` via `scripts/fetch-tor.mjs`) |

## Releases & changelog

The current build is **v3.12.0-beta.1**. Each release page carries its own notes + SHA-256.

- **v3.12.0-beta.1** — **PQ hardening + games + case tooling.** Chat's ML-KEM leg → **ML-KEM-1024 via an
  AWS-LC native sidecar** (CNSA 2.0 / FIPS-203 cat 5), fail-closed behind `crypto.ts`; construction
  unchanged + still EXPERIMENTAL (Windows bundles a functional cross-built helper; FIPS module = CI
  follow-up). **Games:** Minesweeper, Chess (full legal-move engine), Win98 **Pinball**, under a new
  Access **"Games ▸"** submenu (off the desktop). **Case migration:** Copy Evidence / Zip Files / Export
  to Desktop / Import Case buttons. **ExifTool** attachment metadata (optional bundled binary). RTFM
  **Ten Nodes of Hacktivism** content, **whiteboard tile colours**, **chat first-run guide**. **434 tests.**
- **v3.11.1-beta.1** — **Fix: invisible checkboxes.** 98.css hides the native checkbox and redraws it
  via an `input + label` sibling element; DCS98 nests the input inside its label, so the box never drew
  and every checkbox (Settings incl. the new Legacy sound pack toggle, GeoINT, Mail TLS, case tasks, …)
  rendered with no visible control — they toggled on a text-click but looked absent. One CSS rule in
  `98.overrides.css` restores a real, visible control app-wide. CSS-only. **429 tests.**
- **v3.11.0-beta.1** — **Optional Legacy sound pack + uninstall fix.** A new **Settings → Sound** toggle
  (off by default) swaps the startup chime and DialTerm dial-up for **AI-reworked recordings** of the
  classic Windows startup jingle + dial-up handshake — the only bundled audio in the app, and
  **derivative works** of their originals (shipped as a deliberate opt-in). When Legacy dial-up is on,
  the connection client's stepper/log pace to the clip length. **Fix:** the bundled `tor.exe` (P2P chat)
  could orphan on quit and lock the install dir, breaking the uninstaller — quit now blocks on teardown
  before exiting (already-stuck installs: end `tor.exe` in Task Manager, then uninstall). **429 tests.**
- **v3.10.0-beta.1** — **DialTerm dial-up client + authentic V-series handshake.** The connecting screen
  is now a familiar dial-up-*client* layout — **DCS98 logo header**, a three-panel **DIAL → LINK → AUTH**
  stage stepper (walking "marcher" + ✓ on completed stages) and an AOL-style status caption — wrapped
  around the kept uplink **packet animation** + live negotiation log (DCS98-branded; no third-party
  marks/mascot). The DialTerm connect **sound** is rebuilt to follow a real handshake: dial tone → DTMF →
  2100 Hz answer + V.8 "bong" → V.21 negotiation → echo-cancel → V.34 line-probe → scrambled-data roar,
  **beat-locked** to the animation (stepper, log, and audio advance together). Reproduced synthetically
  from functional telephony / V-series frequencies — **no sampled or copyrighted assets**. **429 tests.**
- **v3.9.1-beta.1** — **Look-and-feel pass.** New hand-drawn Windows-98-style **Notepad desktop icon**
  (teal spiral pad, matching the My Computer glyph). Reworked **sounds**, all still synthesized at
  runtime (no sampled assets): a warmer/more-synthetic power-on swell; a fuller DialTerm **dial-up
  handshake** whose tones are **beat-synced to the uplink connect animation** (each data chirp lands
  as a packet crosses the link; the negotiation log reveals on the same beat); and a new **hang-up**
  sound (a legacy handset dropped onto its cradle). **429 tests.**
- **v3.9.0-beta.1** — **Photo-embedding case reports + RTFM left-rail manual.** Case exports (Export… →
  HTML/PDF) now inline the case's **bio images** and **image attachments** as `data:` URIs (decrypted in
  main; 24 MiB total / 8 MiB per-image budget; skipped images footnoted) instead of listing names only.
  **RTFM (Help)** gained a sidebar — **Manual**, **OpChildSafety** (its own page now), **Hacktivist
  Ethos**, **OSINT** (the last two are live placeholders for forthcoming GhostExodus content). Everything
  from v3.8.0-beta.1 carries forward; chat handshake crypto **remains EXPERIMENTAL / unverified**. **429 tests.**
- **v3.8.0-beta.1** — **P2P chat Phases 2–4 + Piper neural TTS**. File **attachments** (chunked over the
  encrypted channel, whole-file SHA-256 verified before disk, encrypted quarantine + explicit save),
  **small groups** (client-side fan-out — *zero new cryptography*), and **case-aware sharing** (entity →
  text, attachment → file, straight into a chat). Plus an offline **Piper** neural TTS engine (bundled
  **public-domain** `en_US-ljspeech-high` voice; selectable alongside the OS voices; zero runtime
  egress). Each phase adversarially red-teamed + authorization-hardened. **Chat handshake crypto remains
  EXPERIMENTAL / unverified** (loud in-app banner). Bundled Tor + Piper fetched + SHA-256-verified at
  build. **424 tests.**
- **v3.7.0-beta.1** — **Experimental P2P chat (Tor), Phase 1**. Opt-in, invite-link **1:1** chat over
  Tor onion services with a PQ-hybrid X25519 + ML-KEM-768 handshake, forward-secret message ratchet,
  TOFU + safety-number trust, encrypt-at-rest history, loopback-only sockets (no firewall prompt).
  Bundled SHA-256-verified Tor. **Crypto EXPERIMENTAL — not formally verified.**
- **v3.6.8** — **OpChildSafety (RTFM)**. A new reference section in Help/RTFM with field guidance for
  grassroots child-protection / OSINT investigators: report CSAM lawfully through the proper channels
  (NCMEC, IWF, CEOP, HSI, ACCCE, Cybertip.ca, Europol IRU, INHOPE, NCA) **without** viewing,
  downloading, or mishandling material; evidence-handling do's and don'ts; terminal-browser tooling
  notes; and website-investigation steps. Static reference text — official reporting links open in the
  OS browser (deny-by-default window-open path), no new background egress. Contributed by GhostExodus.
- **v3.6.7** — **In-app exit** + **GeoINT layout**. The Access (Start) menu gains a **Shut Down…**
  entry (with a confirm) that quits the app cleanly via a new `system:quit` IPC → `app.quit()` (runs
  the existing before-quit cleanup: SSH drain, AI-stream cancel). Previously the only way out was the
  native title-bar X, which a Win98-style shell trains users not to look for — so there was effectively
  no discoverable exit. The **GeoINT** left column widened 340→380px so the View row (2D Map /
  Satellite / Street View / Labels) and event titles stop clipping. UI/IPC change; 254 tests.
- **v3.6.6** — **Warmer startup chime** + **TTS voice-picker fixes**. The launch sound is a revoiced,
  lower-register **original** synthesized power-on swell (F-major bed + slow arpeggio + soft bells; no
  sampled assets — it is *not* the Win9x recording). The on-device voice selector no longer **silently
  vanishes** when no eligible voice exists — it explains *why* (cloud voices are blocked by design;
  install Windows Natural voices) — and voice discovery is now **live** via a persistent
  `voiceschanged` subscription, so voices that populate after launch (or a newly installed voice pack)
  appear without a restart instead of being lost to the old one-shot fetch window. 254 tests (3 new).
- **v3.6.5** — **AI reads PDFs** + **resizable sticky notes**. PDF case attachments were rejected as
  binary; the assistant now extracts the PDF **text layer** through the same offline pdf.js engine the
  viewer uses (no OCR, no network) and includes it in case context under the existing remote-egress
  confirmation and per-item/total size caps — a scanned image-only PDF yields no text and is reported as
  such, not silently dropped. Sticky notes gain a **bottom-right resize grip**; the chosen size persists
  per note and is bounded by the main-process validator. 251 tests (8 new).
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
pnpm test         # vitest suite (434 tests as of v3.12.0-beta.1)
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
- Audio chrome (clicks, boot swell, hang-up, DTMF, and the default dial-up handshake) is synthesized at runtime via the Web Audio API. The **optional Legacy sound pack** (off by default; Settings → Sound) is the one exception: it bundles two AI-reworked recordings of the classic dial-up handshake and Windows startup jingle, which are **derivative works of their respective originals** — they play only if you opt in.
- Text-to-speech uses the OS's own voices via the Web Speech API (no bundled voices, on-device only).
- Offline speech-to-text uses [Vosk](https://alphacephei.com/vosk/) via [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Apache-2.0, WASM). The speech model is **not** vendored in this repo and is supplied by the operator (`resources/vosk/model.tar.gz`); verify the model's license before bundling it in a published installer.
- The Net Explorer launcher targets [Firefox Portable](https://www.mozilla.org/firefox/) (Mozilla, MPL-2.0). The Firefox payload is **not** vendored in this repo and is supplied by the operator; bundling/redistributing it must follow Mozilla's trademark and distribution policy.
