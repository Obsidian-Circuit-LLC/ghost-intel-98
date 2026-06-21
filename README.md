# Ghost Intel 98

A Windows 98–inspired OSINT / case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

**Ghost Intel 98** looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management and OSINT tool that happens to wear a retro shell.

> **Formerly "Ghost Access 98."** The program is now **Ghost Intel 98**; your data is migrated forward automatically on first launch (see [Data location](#data-location)).

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

> **Install:** download [`GhostIntel98-Setup-3.17.1.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases/latest), verify the SHA-256, **More info → Run anyway** (unsigned). *(Current build includes the Tor P2P chat — handshake **formally verified internally**: symbolic (ProVerif) + computational (CryptoVerif), internally adversarially reviewed; **not** independently audited and **not** FIPS-validated. See Status.)*

## Status

**v3.18.0** — **Live ADS-B aircraft and AIS ships on the GeoINT globe.** Two new toggleable real-time layers in GeoINT: **Live Aircraft (ADS-B)** polls [adsb.lol](https://adsb.lol) (free, no key, ODbL) every ~15 s and renders viewport-bounded aircraft as color-coded circle pins by altitude band (ground / low / mid / high); **Live Ships (AIS)** streams from [AISStream.io](https://aisstream.io) (free WebSocket, user-supplied API key) and renders viewport-bounded vessels at up to ~2 s cadence with 10-minute prune. Both layers are in the new **Live Feeds** panel in the left rail (below Space Satellites), disabled until the GeoINT network gate is on; AIS additionally requires a stored API key (same encrypted-key UX as FIRMS/UCDP — store once, key never re-echoed to the renderer). Toggling either layer off or leaving the module clears the feed and stops all traffic. The AIS WebSocket runs exclusively in the main process; the renderer receives only parsed positions over IPC (no CSP `connect-src` change, no renderer socket). New egress hosts: `api.adsb.lol` (REST) and `stream.aisstream.io` (WSS) — both hard-pinned, gated on the existing network opt-in. ADS-B data © adsb.lol contributors (ODbL). **Everything from v3.17.1 carries forward.**

**v3.17.1** — **Hotfix: GeoINT no longer crashes on load.** v3.17.0 could throw **"Style is not done loading"** and drop GeoINT into its error screen (Reset couldn't recover): the new Space Satellites layer called MapLibre's `addSource` before the map style had finished loading — synchronously at init and from a `styledata` event that fires mid-load. Satellite-layer creation is now guarded by `isStyleLoaded()` and driven off the `load` + a self-guarded `styledata` event, so it only ever adds the source once the style is ready (and still survives basemap/network toggles). Renderer-only; everything from v3.17.0 carries forward.

**v3.17.0** — **Space Satellites on the GeoINT globe.** A new toggleable **Space Satellites layer** in GeoINT: tick **"Show Space Satellites (N)"** and every active satellite in the offline TLE snapshot drops a real-time SGP4-propagated pin on the 3D globe, color-coded by type (Starlink, GPS, weather, comms, earth-obs, space stations, scientific, other). The layer boots from a bundled offline TLE snapshot (no network needed on first toggle); enable the GeoINT network and hit **Refresh** to pull a live catalogue from CelesTrak for the group of your choice (Active Satellites, Starlink, GPS, Space Stations, etc.). Add or paste-import your own TLE sets via the **Space Satellite Manager** panel alongside — user satellites merge with the snapshot on load. A sortable, filterable table shows the propagated set (name, type, altitude, velocity, inclination) with **Track / Center / Details** row actions and a **Export…** JSON download. Per-type checkboxes filter both the table and the globe. Refresh without network enabled toasts guidance rather than fetching. No new egress beyond `celestrak.org`, already behind the existing GeoINT network opt-in. This release also **actually fixes the GeoINT map popup** that v3.16.3 tried to: that "fix" tied MapLibre's own CSS on specificity and lost on load order, leaving a white box with near-invisible coordinates — the popup is now an **opaque black card with light-grey, unobstructed coordinates and a minimal square ✕** (specificity-correct, so it wins regardless of import order). **1226 automated tests.** **Everything from v3.16.3 carries forward.**

**v3.16.3** — **Field-fix polish: the assistant stops voicing markdown, and the GeoINT map ✕ finally shrinks.** Three cosmetic fixes from the field. **(1) Spoken markdown** — the assistant's Piper/character voices no longer read formatting markers aloud (`**`, `*`, `` ` ``, `#`, `-`): the spoken text now passes through the *same* in-house markdown stripper the on-screen renderer uses, so what you hear matches what you see. **(2) GeoINT popup ✕** — the map pin/popup close button was overlapping the coordinate readout despite two prior sizing passes; root cause was a CSS scope (`.ga98-geo-right`) that never actually matched the popup, so MapLibre's oversized default ✕ kept rendering. The popup styling is now scoped globally to MapLibre's own classes (GeoINT is the only MapLibre surface), so the tight dark card + small ✕ apply for real, clear of the coordinates. **(3) Bug reports** — RTFM gains a "Found a bug?" line with a contact address. No crypto/data/protocol/egress change; renderer + CSS only. **1207 automated tests.** *Everything from v3.16.2 carries forward.*

**v3.16.2** — **Character voices.** The assistant's offline Piper voice now ships with four selectable **character voices** alongside the public-domain default — **Jarvis, HAL 9000, GLaDOS, and Wheatley** — pickable from the voice dropdown in the assistant's TTS controls. The default stays **LJ Speech (public-domain)**, so out-of-the-box behavior is unchanged; the character voices are opt-in. Each bundled voice is **SHA-256 pinned** at build time (fail-closed — a tampered model never ships) and the piper binary keeps its verify-before-exec gate; voice selection is resolved **traversal-safe in the main process** (an invalid pick falls back to the default). You can still add **your own** voices via the v3.16.1 Voices folder. The installer grows to ~837 MB to carry the four extra voices; no runtime network, no telemetry. *Everything from v3.16.0 carries forward.*

**v3.16.1** — **Bring your own TTS voice.** The AI assistant's Piper (offline neural) voice is no longer limited to the one bundled voice: drop your own `<name>.onnx` + `<name>.onnx.json` Piper voice pair into a **Voices** folder and pick it from a dropdown in the assistant's voice controls. A **📁 Voices** button opens the folder (created on first click); the picker lists every valid voice you've added alongside the bundled neural default. Voice selection is resolved **traversal-safe in the main process** (a malicious/garbage selection can never load a model outside the Voices folder — it falls back to the bundled voice), the bundled piper binary keeps its verify-before-exec hash gate, and your voice files are **local only** — nothing is bundled or downloaded, no telemetry, no new network path. *Everything from v3.16.0 carries forward.*

**v3.16.0** — **Live News pop-out, manual CCTV coordinates + export, and a readable AI assistant.** Four field-driven additions. **(1) Live News pop-out** — pick a Live News feed in GeoINT and pop it into its own draggable Win98 window (the `⧉` button beside the feed); open as many as you like, and re-popping the same feed re-focuses its window. **(2) Manual CCTV coordinates** — the EyeSpy "Set location…" right-click now takes a **Latitude** and **Longitude** for a single camera (validated, both-or-neither, clear to remove); the camera then drops a pin on the GeoINT map. **(3) Export CCTV** — a new **"Export CCTV…"** button in the EyeSpy finder writes your whole camera library back out to a `master_CCTV.json` in the same `Country → Region → City → {stream_url, coordinates}` shape the importer reads, so coordinate edits are portable and round-trip. **(4) Readable AI assistant** — the bundled assistant's replies now render as real **bold/italics/bullets/headings** (emojis pass through) instead of raw `**`/`#` symbols, via a safe in-house renderer (no new dependency, no HTML injection); a **"Formatted assistant output"** toggle in Settings (default on) returns to plain text if you prefer. Also a follow-up GeoINT fix: the map popup's **✕ is shrunk again** to a clean upper-right square after the v3.15.0 sizing wasn't tight enough. Coordinate range-gating is enforced main-side (the trust boundary); no telemetry, no new egress host, no CSP change. **1167 automated tests.** *Everything from v3.14.0 carries forward.*

**v3.15.0** — **CCTV cameras on the GeoINT map.** A new toggleable **CCTV camera layer**: tick **"CCTV cameras (N)"** in GeoINT and every catalogued camera with coordinates drops a clustered pin on the map — dense areas (e.g. London) collapse to a Win98 count badge that splits into individual camera pins as you zoom in. Click a camera pin to pop a small draggable **camera window** that plays the live feed (reusing the EyeSpy player); up to 8 windows at once, re-clicking a pin re-focuses its window. The layer reads straight from your EyeSpy library (the coordinates the v3.14.4 importer now lands), is **off by default**, and renders without enabling the GeoINT network — playback is the same direct view EyeSpy already does. Also two GeoINT polish fixes from the field: the map popup's **✕ is sized to match the window title-bar button** (was oversized), and the **left command rail now collapses** to a thin strip (« / ») so the map can use the full width. The camera layer is a pure view over local data — no telemetry, no new network path, no CSP change. *Everything from v3.14.0 carries forward.*

**v3.14.4** — **EyeSpy import: `stream_url` + nested coordinates (patch).** GhostExodus's coordinate-bearing CCTV scrapes (the insecam/TfL "by country" dump shape) imported **zero** cameras: every leaf used a `stream_url` key and a nested `coordinates: {latitude, longitude}` block, neither of which the importer recognized, so all feeds were dropped before categorization. The importer now accepts `stream_url` as a URL key and reads lat/lon from a nested `coordinates` object (flat `lat`/`lon` still win when both are present). Verified end-to-end against the real files: **0 → 2,555 cameras** import, 2,469 carrying coordinates, all filed under their country. This also unblocks the upcoming CCTV-pins-on-GeoINT-map feature, which needs lat/lon in the stream store. Main-process parser change only; geo-less and flat feeds behave exactly as before. *Everything from v3.14.0 carries forward.*

**v3.14.3** — **EyeSpy "All Cameras" finder polish (patch).** A GhostExodus field batch on the finder: a **⊟ Collapse all** button (closes every expanded country/region in one click), the location tree and feed list now **share the pane evenly** (was 40/60), the camera-feed **right-click menu no longer hides behind the taskbar** (its bottom items — Set location…, Delete — stay reachable when right-clicking a feed low in a long list), and slightly **larger finder text**. Renderer-only; no backend, IPC, or data change. *Everything from v3.14.0 carries forward.*

**v3.14.0** — **first stable release of the 3.14 line** — out of beta; the entire `beta.1 → beta.21` series is folded in and field-tested. EyeSpy bulk import now ingests a **nested Country → Region → City JSON tree**, so a large scraped-by-country camera dump imports **fully categorized** in one shot (filed under the finder tree) instead of landing flat and "Ungeocoded." New **`docs/EYESPY_IMPORT_FORMAT.md`** documents every accepted format (flat JSON array, nested tree, header CSV, URL list) and the Import button links to it. Everything from beta.20 carries forward — EyeSpy feed right-click menu clamps into the window; **GeoINT** command stack stays on-screen and map "blips" don't stack overlapping ✕ buttons; EyeSpy ➕ Add-new-feed tile reliably clickable; **Mail** select-and-copy plus an app-wide right-click **Cut / Copy / Paste / Select All** menu. Built on the copyright-safe brand art (custom "G" mark, no Microsoft Windows flag).
**new app icon + logo** and beta.12's
**rename to Ghost Intel 98** (automatic data migration on first
launch — existing cases, settings, and the encrypted vault carry forward). Otherwise identical to beta.11's
**GhostExodus field-fix batch** on top of the GeoINT reimagine: an
outer-space starfield behind the globe + translucent-dark map popups, a responsive GeoINT layout, EyeSpy
fit-to-screen tiles + double-click + **YouTube camera feeds** + a fixed "Add new feed" wall flow, and a
Mail chime that finally fires from inside the app — now **user-replaceable** (Settings → open the sounds
folder, drop in your own jingle). The beta.10 work it builds on:

- **GeoINT reimagined as a 3D command center.** A **3D MapLibre globe** replaces the flat map (toggle back to
  flat in-app; Leaflet is retained as a fallback this release). A **command-center rail** (Global Threat View,
  Monitored Situations, Visual Imagery, Situation Feed) and **live threat layers** — USGS earthquakes, GDACS,
  GDELT-DOC, war-tracker, ReliefWeb, UCDP free/no-key + NASA FIRMS / gdeltcloud / UCDP keyed (key in the OS
  keyring), plus a **CISA KEV** advisory sidebar. New **JSON Feed** source type + feed images, and a **Live
  News panel** (HLS + sandboxed YouTube). Each layer is honestly labeled by authority and attribution.
- **DialTerm — local shell (opt-in, default off).** Run a local cmd/PowerShell terminal; enabling requires a
  native confirmation dialog. (Ships dark/feature-flagged — the native terminal backend lands in a follow-up
  Windows build.) Custom host ports survive protocol changes.
- **Mail.** Fixed the "You've got mail" chime (proven audio loader; Settings has a Test button) and added an
  **opt-in background mail poller** — chime + Win98 toast even when the Mail window is closed.
- **EyeSpy.** Unlimited cameras (scrollable, column-configurable wall — no 3×3 cap) + a **Refresh tiles** button.
- **My Cases / shell.** Category collapse state persists (defaults collapsed); Share/Import moved beneath
  New/Rename; Journal Jots / GeoINT / Markets / Jukebox moved to the programs menu.

A combined red-team pass (4 adversarial reviews) fixed a local-shell enable-bypass, a cross-origin redirect
credential leak, a shell session-id validator, an EyeSpy wall-persistence truncation, and an RSS
coordinate-integrity gap. ~1057 automated tests. *Everything from v3.14.0-beta.9 carries forward.*

<details><summary>v3.14.0-beta.9 — GeoINT geo-XML formats + Mail actions</summary>

- **GeoINT KML / GPX / generic XML sources.** Add a `.kml` or `.gpx` feed URL and Point placemarks /
  waypoints become map pins (coordinate-range guarded). A new **XML (custom)** source type accepts any
  structured XML feed via a dot-path field map (itemsPath / lat / lon + optional title / summary / link /
  date) — so feeds that are neither RSS/Atom nor GeoJSON can still become pins.
- **Mail: Star, Forward, Delete, Print.** Each open message now has an action row. **Star (★)** toggles the
  IMAP `\Flagged` flag and shows in the inbox list. **Forward** opens Compose pre-filled with `Fwd:` subject
  and a quoted body. **Delete** moves the message to the Trash folder (recoverable from webmail). **Print**
  opens the native OS print dialog with a clean plaintext rendering of the message (HTML body is not used —
  XSS-safe by design).

879 automated tests. *Everything from v3.14.0-beta.8 carries forward.*

</details>

<details><summary>v3.14.0-beta.7 — GhostExodus beta.6 field-test punch-list</summary>

- **GeoINT** crash-proofing (error boundary + Purge cache), 1,500-marker cap, default Google tiles, floating
  **Play Story** transport. **Mail Send** always reachable + 30s refresh. **Bookmarks** cards auto-fit links.
  **EyeSpy** **Webpage** kind (opens viewer pages in bundled Firefox) + toolbars no longer scroll off.
  **Cases** **categories** (collapsible grouped sections, right-click to move). 810 tests.

</details>

<details><summary>v3.14.0-beta.6 — GeoINT intelligence map + EyeSpy Wall Setup + Mail notifications</summary>

- **GeoINT** becomes an intelligence map. The offline gazetteer grew **250 country names → ~61.7k cities**,
  so RSS/Atom articles that name a city now **auto-pin** (this is the fix for "feeds not showing"). Markers
  are **colored by category** (conflict/cyber/protest/disaster/crime/politics) and sized by severity;
  events corroborated by **≥2 distinct sources** glow; a **timeline scrubber** plays events over time;
  **story mode** walks a set of events as a shareable briefing; search drops a 📌. (`Places © GeoNames CC-BY`.)
- **EyeSpy — Wall Setup:** **New** configures a board by **Country/State/City** and can **import a whole CCTV
  file into that category**; **Rename** now actually works.
- **Mail:** silent background **auto-refresh** + an **audio notification** only when new mail arrives.
- Internal: a security-hardening pass on the not-yet-shipped offensive-egress capability (no user-facing change).

</details>

<details><summary>v3.14.0-beta.5 — GeoINT map fix (no ghost box / drag catch)</summary>

A targeted render-wiring fix: the GeoINT map stopped flashing a "ghost box" in the centre and catching on click-drag (the event list rebuilt every render → marker thrash + a recenter loop; fixed by memoizing + splitting the focus step). **712 tests.**

</details>

<details><summary>v3.14.0-beta.4 — EyeSpy finder + curated 3×3 wall</summary>

The EyeSpy redesign: a **finder** (Countries/Cities tabs, global search, flag + count per node, a feed list whose rows right-click to *Add to active square / Play / Edit / Set location / Delete*) and a **curated 3×3 wall** of named, persisted boards (click a square active, right-click a feed to drop it in; "＋ Add new feed" empty tile; "as of <time>" header; × to clear). One contextual Import button ("Import to London…"), Set location to file a bare archive into the tree. Replaced the beta.3 auto-grid. **712 tests.**

</details>

<details><summary>v3.14.0-beta.3 — EyeSpy location grid (superseded by the beta.4 wall)</summary>

A left-sidebar Country→State→City tree with rolled-up counts, search, and a live tile grid (capped at 9, lazy-mounted) for the selected node, with "Import here" location stamping and per-tile delete. **704 tests.** *Superseded by the beta.4 finder + curated wall.*

</details>

<details><summary>v3.14.0-beta.2 — boot-fix re-release of beta.1 (the packaged app launches)</summary>

beta.1 crashed at boot with `ERR_REQUIRE_ESM` because the new ESM-only chat-crypto module (`@noble/ciphers`) was being `require()`'d from the CommonJS main bundle; beta.2 inlines it. The feature set is the beta.1 dogfooding punch-list — a new journal app, two audio/crypto fixes, and module polish:

- **Journal Jots** — a new password-protected (4-digit PIN) journal app. Entries are consolidated inside the
  app (they don't land in the Briefcase) and are encrypted at rest with everything else under the optional
  vault login. The PIN is a rate-limited lock over that already-encrypted storage — a convenience gate, not
  the encryption boundary (the vault is).
- **Chat invite-accept fix.** The Tor P2P chat's message encryption moved to a runtime-independent
  implementation of the same cipher, resolving an "Unknown cipher" failure that broke accepting invites on
  packaged builds (the algorithm and wire format are unchanged).
- **Piper TTS no longer plays as static.** Piper now writes its audio to a seekable temp file instead of a
  stdout pipe, so the WAV length headers are correct and the player stops decoding garbage over the voice.
  (The Microsoft voices were always clean; this was Piper-specific.)
- **EyeSpy** gains a Purge-all button, lets you edit an existing stream in place, and now imports geo
  metadata (city / lat / lon / country / source) from a **header-mapped CSV**, not just JSON.
- **Jukebox** opens at a sensible size and gains a collapse/expand toggle for a compact "just the deck" view.
- **DialTerm** drops the redundant touch-tone dialpad animation, going straight to the AOL-style dial-up client.
- **Mail** account-setup dialog now closes properly (it could trap you when no account was configured yet);
  **Notepad 98** can delete entries.

690 automated tests. *Everything from v3.13.3 carries forward.*

</details>

**v3.13.3-beta.1** — New lightning boot splash + Win9x loading bar:

- **New boot splash + loading bar.** The startup screen is now the higher-resolution "Welcome Ghost Intel 98"
  lightning render (the prior grayscale logo was pixelated at full screen), with a Win9x-style scrolling
  blue-block loading bar and a *Starting Ghost Intel 98…* caption playing under it while the startup jingle sounds,
  then fading to the login screen. The bar is **indeterminate by design** (boot work — auth check + settings
  load — is near-instant) and respects `prefers-reduced-motion`. Purely presentational.

505 automated tests (unchanged). *Everything from v3.13.2 carries forward — reconnect hardening verified, chat out of EXPERIMENTAL.*

**v3.13.2-beta.1** — Reconnect hardening verified — chat leaves EXPERIMENTAL — plus a Win98 boot splash and theme polish:

- **Tor P2P chat: reconnect path formally verified; the EXPERIMENTAL banner is gone.** This closes the two
  remaining internal audit findings on the handshake — **HIGH-1** (a dropped reconnect could permanently
  strand a contact, recoverable only by a fresh out-of-band invite) and **MED-2** (reconnect had no formal
  model and no DoS pre-gate). Reconnect now self-heals in-band (an authenticated `prekey_unknown` Reject +
  one bounded retry), is DoS-gated by a per-contact keyed MAC with an enforcement bootstrap and a
  split/deduped rate-limiter, and keeps its gate key **stable per epoch**. It is verified to the same
  standard as first-contact: **ProVerif** symbolic (reconnect + Reject — injective I-auth-R, recovery
  soundness, downgrade/substitution resistance) and **CryptoVerif** computational (`mac_R` gate
  unforgeability). The design cleared three independent adversarial-review passes before implementation.
  The in-app **EXPERIMENTAL / "not formally verified" banner is removed**; the handshake is now formally
  verified *internally* — an **independent external audit and a FIPS module remain the only unmet gates**,
  so the build does not claim "externally audited" or "FIPS-validated."
- **Win98 boot splash.** A Ghost Intel 98 startup screen (the grayscale storm/flame logo) now plays before the
  login screen while the startup jingle sounds, then fades to the desktop.
- **New default wallpaper.** The desktop default is now the blue 256-color-era Ghost Intel 98 scene. Only the
  default changes — any wallpaper you set yourself is untouched.
- **Date/Time desktop widget** (analog + digital, draggable, opt-in) and **game renames** — Minesweeper →
  **Mine Detector**, Pinball → **Ghost Space Ball**.

505 automated tests. *Everything from v3.13.1 carries forward (incl. the corrected pinball geometry).*

**v3.13.1-beta.1** — Pinball playability fix + formal-verification milestone:

- **Pinball geometry corrected.** The v3.13.0 flippers were too close for their length — they overlapped,
  leaving **no center drain gap**, and the assembly was off-center. Re-centered with a real ~1.5-ball drain
  gap; **slingshots** now hug the flippers (no slip-through dead zone); and **inlane/outlane guide rails**
  turn the open sides into a flipper-feeding inlane and a narrow drain. *(Physics feel — gravity, flipper
  strength, kicks — may still be tuned in a follow-up.)*
- **Chat handshake formal verification advanced.** The **CryptoVerif** hybrid bound is now proved (both
  legs): the session root key is indistinguishable from random if **either** X25519 (CDH) **or** ML-KEM
  (IND-CCA2) survives — alongside the completed ProVerif symbolic run. This is the key-schedule core, not
  the full wire protocol end-to-end, so the handshake **stays EXPERIMENTAL / not formally verified** (an
  end-to-end model, external audit, and FIPS build remain). Banner unchanged.

454 automated tests. *Everything from v3.13.0 carries forward.*

**v3.13.0-beta.1** — Dogfooding feedback turned into features:

- **Search results are clickable.** A hit on a note opens that note in Notepad, a file hit opens the
  document viewer, a metadata hit opens the case — straight to the exact result.
- **Chess vs the computer.** New 2-player / vs-computer toggle, pick White or Black, and Easy / Medium /
  Hard (alpha-beta search). The board flips when you play Black. Engine extracted + unit-tested.
- **Pinball rebuilt as a Space-Cadet-style table** (was Pong-like): power plunger, energetic slingshots,
  pop bumpers, a drop-target bank, rollover lanes that rank you up (Cadet → Fleet Admiral), a ramp combo,
  a **wormhole lock → multiball**, fast tip-velocity flippers, a space theme, and synthesized SFX.
  *(Physics feel still wants an interactive tuning pass.)*
- **Local AI memory (offline RAG).** Opt-in: the assistant recalls relevant notes, file text, entities,
  and past conversations from your own corpus and cites them — a local vector index, served over
  **loopback only**, **encrypted at rest** in your vault, with **deterministic** retrieval and zero
  telemetry/egress. Enable + rebuild the index under **Settings → Case Memory**. The embedding model
  (`nomic-embed-text`, ~262 MB) ships **in the installer**; it goes live through the local-AI runtime
  (the bundled runtime, or any Ollama you already run on `127.0.0.1:11434` with the model pulled). *(The
  bundled model is why this installer is larger.)*

454 automated tests. The chat handshake construction is **unchanged** and **remains EXPERIMENTAL / not
formally verified** (see below). *Everything from v3.12.x carries forward.*

**v3.12.1-beta.1** — Security patch from an adversarial (black-team) pass on the v3.12.0 chat crypto:

- **Fixed (HIGH): one-time prekey double-consume.** Under the engine's concurrent inbound dispatch, a peer
  replaying the handshake's first message on two streams could get the *same* one-time prekey served to two
  sessions — a post-quantum-forward-secrecy / replay regression. Now reserved atomically on lookup and
  released on abort (with a regression test).
- **Hardening:** the ML-KEM sidecar rejects oversized frames and kills a wedged helper; the helper zeroizes
  the decryption secret key + shared secrets; chat-enable is serialized (no orphaned processes on a
  double-trigger); and the helper-binary SHA-256 verify-before-exec is now live.
- **Honesty:** corrected code comments that called the ML-KEM helper "FIPS-validated" — the shipped Windows
  helper is a functional **non-FIPS** build (the FIPS-validated module is a CI follow-up).

The chat handshake **construction** held up under the black team (hybrid soundness at ML-KEM-1024, KEM-tamper
caught by AEAD key-confirmation) but **remains EXPERIMENTAL / not formally verified** — a black team finds
attacks, it cannot prove their absence; clearing that flag requires the ProVerif + CryptoVerif proofs and an
external audit. 435 automated tests.

**v3.12.0-beta.1** — a large one — post-quantum hardening, games, and case tooling:

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
  element and hides the real input; Ghost Intel 98's checkboxes nest the input inside the label, so the box
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

- **Ghost Intel 98 dial-up connection client** — the DialTerm connecting screen is now a familiar dial-up-client
  layout: a **Ghost Intel 98 logo header**, a three-panel **DIAL → LINK → AUTH** stage stepper (with a little
  walking "marcher" in the active panel and ✓ on completed stages) and an AOL-style status caption —
  wrapped around the existing uplink **packet animation** and the live negotiation log. Ghost Intel 98-branded,
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

**v3.6.3** added **desktop polish** — the **Ghost Intel 98 flame wallpaper** as the default background,
desktop icons in a single **vertical left-edge column**, an authentic Win95 **My Computer** icon for
**My Cases**, and a **draggable sticky-notes bar** that no longer overlaps the window minimise/close
buttons.

**v3.6.2** added **Solitaire** (Klondike, with full card drag-and-drop and the classic
bouncing-card win cascade), in the Access menu.

**v3.6.1** added the **Briefcase** (standalone text notes not tied to any case — browse them in the
Briefcase app or save straight there from Notepad 98), GeoINT **street-name labels** + a one-click tile
**Reset**, and **Shred** pinned to the bottom-right corner like the Recycle Bin.

**v3.6.0** renamed the program from **Ghost Access 98** (with automatic data migration from the
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

Download the latest installer from the [Releases page](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases) and run it.

Direct link to the current release: [`GhostIntel98-Setup-3.17.1.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases/download/v3.17.1/GhostIntel98-Setup-3.17.1.exe)
(Tor P2P chat + Piper TTS; the chat handshake is **formally verified internally** — symbolic (ProVerif) +
computational (CryptoVerif), internally adversarially reviewed; **not** independently audited and **not**
FIPS-validated — see Status). The last fully-stable build is [`GhostIntel98-Setup-3.6.8.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases/download/v3.6.8/GhostIntel98-Setup-3.6.8.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the release notes:

```powershell
Get-FileHash .\GhostIntel98-Setup-3.17.1.exe -Algorithm SHA256
# compare against the SHA-256 printed in that version's release notes
```

The installer is **unsigned** (no code-signing certificate yet), so SmartScreen will warn on first run — click **More info → Run anyway**. The app installs per-user (no admin required) and creates a desktop + Start menu shortcut.

To uninstall: Settings → Apps → Ghost Intel 98 → Uninstall.

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
| **GeoINT** | Pluggable geopolitical-monitoring dashboard — **RSS / Atom / GeoJSON / KML / GPX / XML** sources + **OPML** import, a **MapLibre GL globe** (**2D** custom tiles, **Satellite**, **Street View**), offline **gazetteer** geocoding + manual pins. Network is **opt-in** (off by default). Save an event into a case as a record / link / note. **Space-satellite layer** (CelesTrak default behind the GeoINT network opt-in + offline snapshot; add/import your own TLEs). **Live ADS-B aircraft** (adsb.lol, ODbL) + **AIS ships** (AISStream.io, your key) behind the network opt-in — viewport-bounded, ~15 s / ~2 s cadence, both gated off by default |
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
| **Chat** *(beta)* | Opt-in **Tor-only P2P chat** — invite-link **1:1** with a PQ-hybrid X25519 + ML-KEM-1024 handshake (no hosting, loopback-only sockets), **file attachments** (hash-verified, encrypted quarantine + explicit save), **small groups** (client-side fan-out), and **case-aware sharing** from the case module. The handshake (first-contact **and** reconnect) is **formally verified internally** — symbolic (ProVerif) + computational (CryptoVerif, 12/12 models "all queries proved") — and internally adversarially reviewed. It is **not** independently audited and **not** FIPS-validated; those two external gates remain outstanding. Off by default. Bundled SHA-256-verified Tor (`resources/tor/` via `scripts/fetch-tor.mjs`) |

## Releases & changelog

The current build is **v3.15.0** (first stable line since v3.6.x). Each release page carries its own notes + SHA-256.

- **v3.15.0** — **CCTV cameras on the GeoINT map.** A toggleable CCTV camera layer: "CCTV cameras (N)" drops clustered camera pins (Win98 count badges that split into pins as you zoom) for every catalogued camera with coordinates; clicking a pin opens a small draggable window playing the feed (reuses the EyeSpy player; max 8 windows, re-click re-focuses). Reads the EyeSpy library directly, off by default, renders without enabling the GeoINT network (playback is the same direct view EyeSpy does). Plus two GeoINT polish fixes: the map popup ✕ is sized to the window title-bar button, and the left command rail collapses to a thin strip (« / ») to give the map full width. Pure view over local data — no telemetry, no new network path, no CSP change. 1099 automated tests; typecheck clean.
- **v3.14.4** — **EyeSpy import: `stream_url` key + nested `coordinates`.** GhostExodus's coordinate-bearing CCTV scrapes (insecam/TfL "by country" dumps) imported zero cameras because each leaf used a `stream_url` key and a nested `coordinates: {latitude, longitude}` block the importer didn't recognize. The importer now accepts `stream_url` and reads lat/lon from a nested `coordinates` object (flat `lat`/`lon` win when both present). Verified against the real files: 0 → 2,555 cameras (2,469 with coordinates), all filed under their country. Unblocks the CCTV-pins-on-GeoINT-map feature. Main-process parser change only. 1076 automated tests; typecheck clean.
- **v3.14.3** — **EyeSpy "All Cameras" finder polish.** A GhostExodus field batch: a **⊟ Collapse all** button, an **even 50/50 split** between the location tree and the feed list, the camera-feed **right-click menu clamps above the taskbar** (its bottom items stay reachable on long lists), and **larger finder text**. Renderer-only; no backend/data change. 1071 automated tests; typecheck clean.
- **v3.14.2** — **Chat-verification wording corrected to match the formal record.** v3.14.1 mistakenly described the CryptoVerif computational proof as "in progress"; the internal formal kit in fact reproduces **12/12 CryptoVerif models "all queries proved"** (CryptoVerif 2.12) plus ProVerif 4/5, with a three-pass internal adversarial review. The README and the in-app Chat info panel now read: **formally verified internally (symbolic ProVerif + computational CryptoVerif), internally adversarially reviewed; not independently audited and not FIPS-validated** (the two remaining external gates). The chat's EXPERIMENTAL banner stays off — its removal is supported by the reproduced proofs.
- **v3.14.1** — **Docs: chat-verification wording (superseded by v3.14.2).** Intended to correct the chat wording but under-stated the CryptoVerif proof state; v3.14.2 fixes it. No code changes; app identical to v3.14.0.
- **v3.14.0** — **First stable release of the 3.14 line.** Promotes `beta.21` to a production build with no code changes — the full GeoINT command-center redesign, EyeSpy finder + bulk-import (incl. nested geo-tree JSON), Mail copy/paste + background poller, the Tor P2P chat, and the GhostExodus field-test fixes (beta.1 → beta.21) are all folded in and field-tested. 1071 automated tests; typecheck clean. See the per-beta entries below for the detailed feature history.
- **v3.14.0-beta.21** — **EyeSpy bulk-import: nested geo-tree JSON + documented format.** The feed importer now walks a nested `Country → Region → City → [urls]` JSON tree and files every leaf under the finder tree, so a large scraped dump imports fully categorized in one pass (verified on a 1,644-feed / 65-country list). New `docs/EYESPY_IMPORT_FORMAT.md` documents all accepted shapes (flat JSON array, nested tree, header CSV, URL list); the Import button tooltip links to it.
- **v3.14.0-beta.20** — **EyeSpy right-click menu fix.** The camera-feed context menu now clamps fully into the window, so its bottom items (**Set location…**, **Delete**) are reachable even when right-clicking a feed low in a long list (previously they fell below the window edge). Follow-up to beta.19.
- **v3.14.0-beta.19** — **GhostExodus field-test batch.** **GeoINT:** the right command stack no longer overflows the window edge (clipping the Live-News Add-stream controls), and map "blips" no longer stack overlapping ✕ close buttons — one popup open at a time. **EyeSpy:** the **➕ Add new feed** tile is a real, reliably-clickable button and every empty tile now opens the Add form. **Mail:** message text is selectable/copyable and an app-wide right-click **Cut / Copy / Paste / Select All** menu was added (local clipboard only — no egress, no telemetry).
- **v3.14.0-beta.18** — **"You've got mail" chime fixed.** The default chime was a 192 kHz WAV the renderer couldn't decode (silent since beta.12) — re-encoded to standard 44.1 kHz PCM, and installs holding the old file are auto-repaired on launch. Command-rail scrollbar clipping re-fixed via right padding (more reliable than `scrollbar-gutter`).
- **v3.14.0-beta.17** — Boot-splash caption overlap fixed; GeoINT command-rail scrollbar overlap fixed; added the missing **Settings → Mail → "Check for new mail in the background"** toggle so the new-mail chime fires with the Mail window closed.
- **v3.14.0-beta.16** — **Copyright-safe brand art.** All theme images (wallpaper, boot/login splash, logo, app icon) redrawn with the custom "G" hexagon mark instead of the Microsoft Windows flag. Login/lock screen now uses the boot "Welcome" splash as its backdrop.
- **v3.14.0-beta.15** — Boot splash caption shortened to "Starting…" (the name is already in the splash art). Art/text only.
- **v3.14.0-beta.14** — **New boot/login splash + default wallpaper** (Ghost Intel 98 brand art). Art only; no code changes from beta.13.
- **v3.14.0-beta.13** — **New Ghost Intel 98 app icon + logo** (window/installer/Start-button icon and the in-app logo). Brand art only; no code changes from beta.12.
- **v3.14.0-beta.12** — **Renamed to Ghost Intel 98.** Product/display name, window titles, installer, and
  shortcuts are now Ghost Intel 98 (new app identity `com.ghostintel.ghostintel98`). On first launch the app
  automatically migrates your existing data directory forward, so cases, settings, sticky notes, and the
  encrypted vault are preserved. No feature changes vs. beta.11. **~1064 tests.**

- **v3.14.0-beta.11** — **GhostExodus field-fix batch.** **GeoINT:** an offline starfield space background
  behind the 3D globe, translucent-dark map popups (with the close button no longer overlapping the title),
  and a responsive 3-column layout so the left controls stop clipping on a non-maximized window. **EyeSpy:**
  camera tiles + the double-click expanded view now fill the frame (centered, contained) instead of
  letterboxing; **YouTube** is a supported camera kind (sandboxed youtube-nocookie); and the wall "Add new
  feed" tile now places the feed onto the wall instead of targeting the last-selected slot. **Mail:** adds a
  **Reply** button (it previously had only Forward); the "You've got mail" chime now fires from inside the
  app on new mail (de-duped against the background poller), and the chime is **user-replaceable** — Settings
  → Sound → *Change chime* opens a sounds folder where you drop in your own `.wav`. Default chime refreshed.
  Post-build code hygiene: removed the now-dead Leaflet map fallback (the 3D globe has been the only map
  since beta.10). **~1064 tests.**
- **v3.14.0-beta.10** — **GeoINT reimagine + beta.9 field feedback.** A big two-part release. **GeoINT** is
  reimagined as a 3D command center: a **MapLibre globe** (default; flat Leaflet map retained as an in-app
  fallback), a command-center rail (Global Threat View / Monitored Situations / Visual Imagery / Situation
  Feed), and **live threat layers** (USGS, GDACS, GDELT-DOC, war-tracker, ReliefWeb, UCDP free/no-key; NASA
  FIRMS / gdeltcloud / UCDP keyed via the OS keyring; CISA KEV advisory sidebar) — each honestly labeled by
  authority + attribution and all behind the off-by-default GeoINT network gate. Adds a **JSON Feed** source
  type + feed images and a **Live News** panel (HLS + sandboxed YouTube). **DialTerm** gains an opt-in,
  native-dialog-gated **local shell** (cmd/PowerShell; backend ships feature-flagged) + custom host ports.
  **Mail** fixes the "You've got mail" chime and adds an opt-in **background mail poller** (chime + Win98
  toast with the window closed). **EyeSpy** removes the 3×3 cap (scrollable, column-configurable wall) +
  **Refresh tiles**. **My Cases / shell**: persistent (default-collapsed) category state, Share/Import moved
  beneath New/Rename, and Journal Jots / GeoINT / Markets / Jukebox moved to the programs menu. A combined
  red-team pass (4 reviews) fixed a local-shell enable-bypass, a cross-origin redirect credential leak, a
  shell session-id validator, an EyeSpy wall-persistence truncation, and an RSS coordinate-integrity gap.
  **~1057 tests.**
- **v3.14.0-beta.9** — **GeoINT geo-XML formats + Mail actions.** **GeoINT** gains three new feed types:
  **KML** (Point placemarks, coordinate-range guarded), **GPX** (waypoints via `@_lat`/`@_lon` attributes),
  and a generic **XML (custom)** source whose dot-path field map (itemsPath / lat / lon + optional title /
  summary / link / date) turns any structured XML feed into map pins — with prototype-pollution-safe path
  walking and gazetteer geocoder fallback when coordinates are absent. **Mail** gains a per-message action
  row: **Star (★)** toggles the IMAP `\Flagged` flag and persists in the inbox list; **Forward** opens
  Compose pre-filled with `Fwd:` subject + quoted body; **Delete** moves the message to the server's Trash
  folder (special-use `\Trash` detected first, then common names, never permanent); **Print** opens the
  native OS dialog with a clean, XSS-escaped plaintext rendering (the HTML body is intentionally not used).
  All four actions are IPC-validated (uid sanitisation + flag allowlist). **879 tests.**
- **v3.14.0-beta.8** — **GhostExodus beta.7 field-test fixes.** **Mail retrieval** now fetches the **newest**
  messages by IMAP sequence instead of the oldest-unseen slice — a full inbox of unread alerts no longer
  buries a just-arrived message below the cap (the "can send but can't receive" report). **EyeSpy** gains a
  **Detect format** button: it probes a pasted camera URL, identifies the real format, and rewrites a bare
  viewer-page URL to the actual MJPEG/JPEG/HLS endpoint so the feed plays inline (a bounded, user-triggered,
  concurrency-capped direct request to the camera host — the same egress as viewing it; it deliberately
  reaches LAN cameras). **GeoINT** recovery now also **resets the saved GeoINT settings** — the one poisoned
  state that survived both reinstall and cache-purge — and the error screen **surfaces the real exception
  on-device** (no telemetry) so a stuck map can be diagnosed rather than guessed. The new egress probe
  cleared an adversarial red-team (concurrency cap, redirect/deadline bounds). **845 tests.**
- **v3.14.0-beta.7** — **GhostExodus beta.6 field-test punch-list.** **GeoINT** is crash-proof with a way
  out: a bad/oversized source (e.g. a FIRMS GeoJSON with an unreplaced `{MAP_KEY}`) can no longer take the
  map down, an **error boundary** + a **Purge cache** button recover a poisoned state that used to survive
  reinstall, markers cap at 1,500 with a count banner, default tiles are Google road tiles, and the **Play
  Story** transport floats over the map. **Mail's Send** button is always reachable (dialogs scroll, action
  row pinned) and the silent refresh is now **30s**. **Bookmarks** cards **auto-fit their links** again (the
  accidental height-freeze is gone). **EyeSpy** gains a **Webpage** kind that opens a camera viewer page in
  the bundled Firefox, and its toolbars no longer scroll off. **Cases** gain **categories** (collapsible
  grouped sections, right-click to move). Built subagent-driven; the GeoINT hardening and the webpage kind
  each cleared an adversarial red-team — which caught the first crash-fix wrapping the wrong layer (a
  call-stack overflow above the error boundary) and an iframe approach that would have holed the renderer
  CSP the plugin trust model depends on. **810 tests.**
- **v3.14.0-beta.6** — **GeoINT intelligence map + EyeSpy Wall Setup + Mail notifications.** GeoINT becomes
  an intelligence map: the offline gazetteer grew **250 country names → ~61.7k cities** so city articles
  **auto-pin** (the fix for "feeds not showing"), markers are **colored by category** and sized by severity,
  events corroborated by **≥2 sources** glow, a **timeline** plays events over time, **story mode** walks a
  set as a shareable briefing, and search drops a 📌. Built TDD with an adversarial pass that caught a
  geocoder that mislocated common-word prose (fixed: English-dictionary blocklist + capitalization gate +
  self-validating guard) and an O(n²) corroboration freeze (fixed: spatial bucketing). EyeSpy gains a
  **Wall Setup** dialog (configure New by Country/State/City, import a CCTV file into that category, rename
  that actually works); Mail gains **silent auto-refresh + a new-mail audio notification**. Plus an internal
  security-hardening pass on the not-yet-shipped offensive-egress capability. `Places © GeoNames (CC-BY)`.
  **801 tests.**
- **v3.14.0-beta.5** — **GeoINT map fix.** The GeoINT map no longer flashes a "ghost box" in the centre or
  catches when you click-drag to pan. Both were one bug: the event list was rebuilt as a fresh array every
  render, so the marker layer cleared+rebuilt on every pan frame and the "recenter on the focused event"
  step drove a recenter→re-render→rebuild **loop** (re-opening the focused popup in the centre). Fixed by
  memoizing the list and splitting the recenter into its own focus-only effect. No change to GeoINT's data,
  sources, or network gate — purely render wiring. **712 tests.**
- **v3.14.0-beta.4** — **EyeSpy redesign: finder + curated 3×3 wall.** Replaces the auto-filling grid (which
  flooded when pointed at a large archive) with two surfaces — a **finder** (Countries/Cities tabs, global
  search, **flag + count** per node, a feed list whose rows **right-click** to *Add to active square / Play /
  Edit / Set location / Delete*) and a **curated 3×3 wall** of nine slots you build deliberately (click a
  square active → right-click a feed to drop it in; the empty slot is the "＋ Add new feed" tile; an honest
  "as of <time>" header; × to clear). **Named walls** persist (save/open/rename/delete); the two redundant
  import buttons collapse into **one contextual Import** ("Import to London…" when a node's selected);
  **Set location** files a bare archive into the tree. Built TDD with an adversarial review pass (fixed a
  wall-save race, a Cities-tab filter that silently showed all cameras, and ghost slots from deleted feeds).
  Also a source-hygiene fix: control-stripping regexes in `validate.ts` + two test files used raw control
  bytes (read as binary, broke text tooling) — now escapes, with a CI guard. No discovery/scanning. **712 tests.**
- **v3.14.0-beta.3** — **EyeSpy location grid.** EyeSpy becomes a location-organised camera wall: a
  **Country → State/Region → City** sidebar tree with rolled-up per-node camera counts (variable depth —
  UK Country→City, US Country→State→City; location-less cameras bucket under "Ungeocoded"), a **search box**
  over tree + grid, and a **live tile grid** for the selected node — tiles stream live but are **capped at 9
  concurrent** and lazy-mounted (over-cap/off-screen tiles show a click-to-play poster; the cap also bounds
  connections over Tor). **"Import here"** stamps a selected location onto geo-less feeds; a per-tile **×**
  deletes a stream. Built TDD with an adversarial review pass (fixed a decoder leak, a stale-selection-after-
  import bug, and a geo-name delimiter corruption before merge). No discovery/scanning. **704 tests.**
- **v3.14.0-beta.2** — **Build-fix re-release of beta.1: the packaged app now launches.** beta.1 crashed at
  boot (`ERR_REQUIRE_ESM`) because the new ESM-only chat-crypto module (`@noble/ciphers`) was being
  `require()`'d from the CommonJS main bundle; it is now inlined (added to electron-vite's
  `externalizeDepsPlugin` exclude list). Feature set unchanged from beta.1; every beta.1 fix — including the
  chat invite-accept fix it couldn't boot to deliver — is now exercisable on a real install. **690 tests.**
- **v3.14.0-beta.1** — **Dogfooding punch-list.** New **Journal Jots** app (4-digit-PIN-locked personal
  journal, entries vault-encrypted at rest, kept out of the Briefcase); **chat invite-accept fix** (message
  encryption moved to a runtime-independent cipher implementation, clearing an "Unknown cipher" failure on
  packaged builds — algorithm/wire format unchanged); **Piper TTS static fix** (synth to a seekable temp file
  so the WAV headers are correct — no more static over the voice); **EyeSpy** purge-all + edit-a-stream +
  **geo-aware CSV import** (city/lat/lon/country/source); **Jukebox** default size + collapse toggle;
  **DialTerm** drops the dialpad animation; **Mail** setup-dialog close fix; **Notepad 98** entry delete. **681 tests.**
- **v3.13.3-beta.1** — **New lightning boot splash + Win9x loading bar.** The startup screen is now the
  higher-resolution "Welcome Ghost Intel 98" lightning render (the prior grayscale logo was pixelated), with a
  Win9x-style scrolling blue-block loading bar and a *Starting Ghost Intel 98…* caption under it, then a fade to the
  login screen. Indeterminate by design (boot work is near-instant); respects `prefers-reduced-motion`.
  Purely presentational — everything from v3.13.2 carries forward. **505 tests.**
- **v3.13.2-beta.1** — **Reconnect hardening verified; chat leaves EXPERIMENTAL; Win98 boot splash.**
  Closes audit findings **HIGH-1** (reconnect could permanently strand a contact) and **MED-2** (reconnect
  had no formal model / no DoS pre-gate): reconnect now self-heals in-band (authenticated Reject + one
  retry), is DoS-gated by a per-contact keyed MAC (enforcement bootstrap + split/deduped rate-limiter) with
  a stable-per-epoch gate key, and is verified to first-contact standard — **ProVerif** symbolic
  (reconnect + Reject) + **CryptoVerif** computational (`mac_R` unforgeability), after three adversarial
  review passes. The **EXPERIMENTAL chat banner is removed** (handshake formally verified internally;
  external audit + FIPS the only unmet gates). Also: a **Win98 boot splash** before the login screen, a new
  blue **256-color default wallpaper**, a **Date/Time** desktop widget, and game renames (**Mine Detector**,
  **Ghost Space Ball**). **505 tests.**
- **v3.13.1-beta.1** — **Pinball playability fix + formal-verification milestone.** Corrected the pinball
  flipper geometry (v3.13.0 flippers overlapped → no drain gap); slingshots now hug the flippers and
  inlane/outlane guide rails replace the open sides. Separately, the **CryptoVerif** hybrid IND-of-RK
  proof landed (both legs: RK secret if **either** X25519 or ML-KEM holds) — key-schedule core only. **454 tests.**
- **v3.13.0-beta.1** — **Dogfooding features.** Clickable search results (jump to the exact note/file/case);
  **Chess vs computer** (pick side + Easy/Medium/Hard alpha-beta); **Pinball rebuilt** into a Space-Cadet-style
  table (power plunger, slingshots, drop targets, rank ladder, wormhole **multiball**, SFX); and **offline AI
  Case Memory** (opt-in local vector RAG over notes/files/entities/conversations, bundled embedding model,
  loopback-only, encrypted at rest). Chat handshake unchanged + still EXPERIMENTAL. **454 tests.**
- **v3.12.1-beta.1** — **Security patch (black-team remediation).** Fixes a **HIGH** one-time-prekey
  double-consume TOCTOU in the chat handshake (concurrent inbound replay could reuse a one-time prekey —
  a PQ-FS/replay regression; now reserve-on-lookup + release-on-abort, with a regression test), plus
  sidecar hardening (oversized-frame reject, wedged-helper kill, live SHA-256 verify-before-exec), helper
  secret-zeroize, serialized chat-enable, and corrected FIPS comments (the Windows helper is a non-FIPS
  build). Construction held up but stays EXPERIMENTAL / not formally verified. **435 tests.**
- **v3.12.0-beta.1** — **PQ hardening + games + case tooling.** Chat's ML-KEM leg → **ML-KEM-1024 via an
  AWS-LC native sidecar** (CNSA 2.0 / FIPS-203 cat 5), fail-closed behind `crypto.ts`; construction
  unchanged + still EXPERIMENTAL (Windows bundles a functional cross-built helper; FIPS module = CI
  follow-up). **Games:** Minesweeper, Chess (full legal-move engine), Win98 **Pinball**, under a new
  Access **"Games ▸"** submenu (off the desktop). **Case migration:** Copy Evidence / Zip Files / Export
  to Desktop / Import Case buttons. **ExifTool** attachment metadata (optional bundled binary). RTFM
  **Ten Nodes of Hacktivism** content, **whiteboard tile colours**, **chat first-run guide**. **434 tests.**
- **v3.11.1-beta.1** — **Fix: invisible checkboxes.** 98.css hides the native checkbox and redraws it
  via an `input + label` sibling element; Ghost Intel 98 nests the input inside its label, so the box never drew
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
  is now a familiar dial-up-*client* layout — **Ghost Intel 98 logo header**, a three-panel **DIAL → LINK → AUTH**
  stage stepper (walking "marcher" + ✓ on completed stages) and an AOL-style status caption — wrapped
  around the kept uplink **packet animation** + live negotiation log (Ghost Intel 98-branded; no third-party
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
- **v3.6.3** — **Desktop polish**: the **Ghost Intel 98 flame** image is the default wallpaper (desktop + lock
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
- **v3.6.0** — **Renamed from Ghost Access 98** with automatic data migration from the old
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
git clone https://github.com/Obsidian-Circuit-LLC/ghost-intel-98.git
cd dcs98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:Obsidian-Circuit-LLC/ghost-intel-98.git` also works. The HTTPS form above requires no key setup.

## Run (development)

```bash
pnpm dev
```

This starts the Vite dev server (HMR) and the Electron main process.

## Build

```bash
pnpm build        # type-check + bundle main / preload / renderer
pnpm test         # vitest suite (1064 tests as of v3.14.0-beta.18)
pnpm package      # platform installer for the current host
pnpm package:win  # cross-build Windows NSIS installer
```

Output lands in `release/`.

## Data location

Ghost Intel 98 stores all user data under your OS userData directory in a `GhostAccess98/` folder
(the inner folder name is kept stable across the rename so existing data resolves unchanged). Locations:

- Windows: `%APPDATA%\Ghost Intel 98\GhostAccess98\`
- macOS: `~/Library/Application Support/Ghost Intel 98/GhostAccess98/`
- Linux: `~/.config/Ghost Intel 98/GhostAccess98/`

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
