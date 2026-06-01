# Ghost Access 98 — v3.4.2

A fast follow-up to v3.4.1 from the next field report: the Jukebox icons that vanished are
back, the internal PDF reader renders again, the desktop honours your wallpaper, and one
alarm-inducing word is gone from the Firefox message.

## TL;DR

- **Jukebox transport icons are visible again.** v3.4.1 swapped the buttons to inline SVG to
  kill the "tofu box" glyphs — but the icons drew with `currentColor` and inherited the
  button-face grey, so they went invisible (you could still hover and click them). The icon
  colour is now pinned, so Previous · Play/Pause · Stop · Next · Shuffle · Repeat all show.
- **Internal PDF reader works again** (`a.toHex is not a function` fixed). pdf.js does its
  parsing inside a Web Worker — a separate JavaScript realm — so the compatibility shim that
  was loaded on the main thread never reached it. The shim now loads *inside* the worker, so
  PDFs render instead of falling back to "Could not render PDF".
- **The desktop now shows your wallpaper.** A theme wallpaper image previously only appeared on
  the lock screen: the desktop layer was painting a solid colour over it. The desktop is now
  transparent to the wallpaper, so both the image and the colour show through in every theme
  intensity (lite / classic / maximum).
- **Friendlier Firefox wording.** The "Firefox Portable is not bundled… place the payload…"
  message no longer uses the word *payload* (which reads as malware to a security audience). It
  now reads "Firefox Portable isn't installed yet. Add the Firefox Portable files to…".

## Verification

- `typecheck` clean · **205/205 tests** (40 files)
- production build OK (the PDF worker is now its own bundled chunk) · headless xvfb boot smoke
  clean (no `uncaughtException`)

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.
- Built on the full v3.4.x base (tape-deck Jukebox, GeoINT egress gate, offline voice,
  Bookmarks, Firefox launcher, offline TTS, encrypt-at-rest vault).
- Your data is already encrypted at rest when the vault is enabled (scrypt-derived key wrapping
  an AES-256-GCM data key); the login password itself is never stored.

---

**Artifact:** `GhostAccess98-Setup-3.4.2.exe` (~122 MB, NSIS, x64, unsigned)
**SHA-256:** `0e21bd7aa55e970b6d11497b09648e4633b0b522d8cc2fc24124a489c62054d4`
