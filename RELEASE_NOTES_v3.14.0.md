# Ghost Intel 98 — v3.14.0

**First stable release of the 3.14 line** — the first production build since the v3.6.x series.

This is `beta.21` promoted to a stable release with **no code changes**: the entire `beta.1 → beta.21`
series has been folded in, field-tested by an active OSINT operator, and is now the recommended build.
The app is **offline-first**, has **no telemetry and no phone-home**, and all network egress is explicit
and consent-gated.

## What's in 3.14.0 (since the last stable, v3.6.x)

### GeoINT — a 3D intelligence command center
A **3D MapLibre globe** (toggle back to a flat 2D / Satellite / Street View map in-app), a
**command-center rail** (Global Threat View, Monitored Situations, Visual Imagery, Situation Feed), and
**live threat layers** — USGS earthquakes, GDACS, GDELT, war-tracker, ReliefWeb, UCDP (free/no-key) plus
NASA FIRMS / gdeltcloud / keyed UCDP (key held in the OS keyring), with a **CISA KEV** advisory sidebar.
Pluggable **RSS / Atom / GeoJSON / KML / GPX / XML** sources + OPML import, offline gazetteer geocoding
and manual pins, and a **Live News** panel (HLS + sandboxed YouTube). Save any event into a case.

### EyeSpy — authorized camera-stream workspace
A **finder** (Countries / Cities tabs, global search, flag + count per node) over a configurable wall of
named, persisted boards. **Bulk import** of your own / public feeds as a flat JSON array, a **nested
Country → Region → City JSON tree** (a large scraped-by-country dump imports *fully categorized* in one
pass — verified on a 1,644-feed / 65-country list), a header CSV, or a plain URL list — all documented in
**`docs/EYESPY_IMPORT_FORMAT.md`**. HLS / MJPEG / HTTP-refresh and **YouTube** feeds; RTSP via a local
ffmpeg→HLS bridge. **No discovery / scanning / brute-force code paths exist.**

### Mail
IMAP/SMTP client with provider presets, encrypted credentials, message **Star / Forward / Delete /
Print**, an opt-in **background mail poller** (chime + Win98 toast with the window closed), full
**select-and-copy**, and an app-wide right-click **Cut / Copy / Paste / Select All** menu (local clipboard
only — no egress).

### AI Assistant
Local (Ollama) or OpenAI-compatible providers with an in-app **"Set up local AI"** wizard,
**saved-conversation memory**, per-message case-context opt-in, and **offline voice conversation**
(push-to-talk + hands-free, on-device Vosk STT + Piper/OS TTS). API keys encrypted.

### Tor P2P chat *(opt-in, off by default)*
Invite-link **1:1** with a PQ-hybrid X25519 + ML-KEM-1024 handshake (no hosting, loopback-only sockets),
hash-verified encrypted file attachments, small client-side groups, and case-aware sharing. The handshake
(first-contact **and** reconnect) is **formally verified internally**; an independent external audit and a
FIPS module remain the only unmet gates. Bundled SHA-256-verified Tor.

### Plus
Sticky Notes, Markets, Jukebox (CD-Player), Bookmarks, Briefcase, Solitaire, DialTerm (SSH/Telnet/FTP +
dial-up handshake), Net Explorer (Firefox launcher), encrypt-at-rest login (AES-256-GCM), and the full
case spine — attachments, entities, timelines, document viewer, and PDF/HTML/CSV + `.ghost` exports.

### GhostExodus field-test fixes (beta.19 → beta.21)
GeoINT command stack stays on-screen and map "blips" no longer stack overlapping ✕ buttons; EyeSpy feed
right-click menu clamps fully into the window and the ➕ Add-new-feed tile is reliably clickable; the
"You've got mail" chime decodes correctly; Mail copy/paste; and the nested geo-tree import above.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0.exe -Algorithm SHA256
```

SHA-256: `8e9e4ee901cf015b31337be88f7da5e8e82ca6a787e60ff0438a28d1cb6bfccb`
Size: 532748468 bytes (508.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any `Ghost Intel 98` beta in place.

## Notes
- 1071 tests green; typecheck clean. No code changes from `beta.21` — this is a stability promotion.
- Same `Ghost Intel 98` app id as the betas, so it upgrades in place. Uninstall any old
  **Dead Cyber Society 98** install alongside it.
- The last prior fully-stable build was **v3.6.8**.
