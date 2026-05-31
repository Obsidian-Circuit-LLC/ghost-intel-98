# Ghost Access 98 — v3.3.0

A feature release: a new **Bookmarks** dashboard, the internal browser swapped for a **Firefox
Portable launcher**, **offline text-to-speech** in the AI Assistant, a batch of UX fixes from
live testing, and **two full adversarial red-team rounds** over everything new.

## TL;DR

- **New: Bookmarks** — an offline, self-owned start.me. Category cards of links you organize by
  dragging; per-link icon is your choice (glyph / emoji / consent-gated favicon); **Share** your
  board as a portable `.ghostbookmarks` file. Encrypted at rest.
- **New: AI voice (text-to-speech)** — have replies read aloud using your **on-device** Windows
  voices. Cloud voices are blocked by design (no-cloud). A **STFU** button stops generation.
- **Changed: Net Explorer → Firefox** — the in-app browser now launches a bundled **Firefox
  Portable** (you supply the payload; see below).
- **Fixed:** Jukebox & GeoINT now appear on the desktop and Access menu; large videos play
  (354 MB+) by streaming; PDFs render again; retro mouse-click + boot sounds; DialTerm now has a
  touch-tone keypad + an Uplink-style connect animation; Help is now **RTFM**.
- **Security:** 0 Critical across two red-team rounds; every High/Medium closed + regression-tested.

## New

### Bookmarks (offline link dashboard)
A desktop + Access-menu app. Build a board of **category cards**, each a list of named links.
**+ Category** / **+ Add link**; drag cards and links to reorganize. Each link's icon is your
choice — a default glyph, an emoji you pick, or a real **favicon fetched only when you enable
network** (off by default). Clicking a link opens it in Firefox. **Share…** exports the whole
board to a portable `.ghostbookmarks` file; **Import…** merges or replaces. The board is stored
encrypted-at-rest with your case data — nothing depends on a third-party site staying up.

### AI Assistant — offline text-to-speech + stop
A **🔊 Voice** toggle reads the assistant's replies aloud using your OS's on-device voices
(including Windows 11 *Natural* voices, if you've installed them via **Settings → Accessibility**).
**Cloud/"online" voices are refused by design** so case text never leaves the machine. A red
**STFU** button aborts an in-progress generation.

## Changed

### Net Explorer → Firefox Portable launcher
The embedded `<webview>` browser was replaced with a launcher that opens URLs in a bundled
**Firefox Portable**. Save-URL-to-case and bookmarks remain. **You must supply the Firefox
payload:** drop a Firefox Portable into `resources/firefox/` (so one of `FirefoxPortable.exe`,
`firefox.exe`, or `App/Firefox64/firefox.exe` exists) and rebuild. Until then the launcher shows
setup guidance. Note Mozilla's redistribution/trademark policy before publishing an installer
that ships Firefox.

## Fixed (from live testing)

- **Jukebox + GeoINT were unreachable** — they were registered but never added to the launcher
  lists. Now on the desktop and Access menu, with a one-time migration that surfaces them on
  existing installs too (and respects it if you later delete them).
- **Large video/audio attachments** (e.g. a 354 MB MP4) now **stream** through the path-confined
  internal media protocol instead of hitting the in-app preview size cap.
- **PDF rendering** ("a.toHex is not a function") fixed via a spec-faithful polyfill.
- **Retro audio** — a mechanical mouse-click on every button and an original power-on "boot" swell
  (synthesized; no copyrighted Windows assets).
- **DialTerm** — real touch-tone (DTMF) dialing on a keypad that lights each digit, then an
  Uplink-style packet-route animation during the carrier handshake.
- **Help → RTFM.**

## Security (two adversarial red-team rounds, 2026-05-31)

**0 Critical.** Every High/Medium was fixed and regression-tested. Highlights:

- **TTS no-cloud is enforced, not just labeled** — speech refuses any cloud voice and fails closed
  if no on-device voice is available (including the cold-start window).
- **Media streaming** is path-confined, media-extension-restricted, refuses encrypted-at-rest files,
  and is revoked on vault lock.
- **Firefox launcher** spawns only the bundled binary with the URL as a single non-shell argument
  (the argument-injection surface was probed and held).
- **Bookmarks** import is size-capped, the board is re-validated on read, and favicons are limited
  to base64 raster images (no script-capable SVG / `data:text/html`) fetched with an SSRF guard +
  timeout.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.
- Built on the full v3.2.x base (Jukebox, EyeSpy bulk import, GeoINT dashboard, encrypt-at-rest,
  local-AI wizard).

---

**Artifact:** `GhostAccess98-Setup-3.3.0.exe` (~119 MB, NSIS, x64, unsigned)
**SHA-256:** `7f8ed773f995fbba6003a72aa8bf8d581be16f081ccd97cdb0b67280c727d214`
