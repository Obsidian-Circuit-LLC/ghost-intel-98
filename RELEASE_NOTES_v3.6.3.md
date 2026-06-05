# Dead Cyber Society 98 — v3.6.3

**Desktop polish.** Flame wallpaper by default, a tidy icon column, and a sticky-notes bar that
stays out of your way.

## What's new

- **Default flame wallpaper.** The DCS98 flame logo on teal is now the default desktop (and
  lock-screen) background. A wallpaper you pick yourself in Settings still overrides it.
- **Single-column desktop icons.** Desktop icons line up in one vertical column down the left
  edge, classic-Windows style, instead of spreading across the top. They spill into a second
  column only if the window is made unusually short (graceful, never clipped).
- **Authentic My Computer icon.** "My Cases" now uses a hand-drawn Windows-95 My Computer icon
  (beige CRT monitor on a desktop case) instead of a folder glyph. It's a crisp SVG, so it
  renders identically everywhere.
- **Draggable sticky-notes bar.** "New note / Hide notes" are bundled into one beveled widget
  with a grip handle. It defaults to the bottom-centre — clear of the window minimise/close
  buttons it used to overlap — and you can drag it anywhere; its position is remembered.
  ("Hide notes" appears once you have at least one note.)

## Verification

- `typecheck` clean (main + renderer) · **238 tests** pass · production build OK.
- Headless boot smoke: app launches, renders the flame desktop, the icon column, the My Computer
  icon, and the relocated notes bar — confirmed by screenshot.
- The drag-to-reposition of the notes bar is best confirmed by a quick drag on Windows.

## Known issues

- **In-app PDF viewer is not currently rendering** — a fix is in progress. Other Doc Viewer formats
  (DOCX, HTML, images, CSV, JSON, EML, text) are unaffected, and PDF **exports** still work.

## Notes

- These are renderer/UI changes only — no IPC, network-egress, or encryption-at-rest code was
  touched. The notes-bar position is stored locally (browser `localStorage`); it never leaves
  the machine.
- **Unsigned** build — SmartScreen will warn; **More info -> Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.3.exe` (124,481,343 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `a32e5ce036567f0b763515c3b42ca6ea31ae0eede052c8af3f717af14e7dd21d`
