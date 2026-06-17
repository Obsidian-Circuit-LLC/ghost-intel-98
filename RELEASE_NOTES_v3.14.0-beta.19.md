# Ghost Intel 98 — v3.14.0-beta.19 (BETA)

> ⚠️ BETA — for functional testing.

GhostExodus field-test batch: GeoINT layout + map popups, EyeSpy add-feed, and Mail copy/paste.

## Fixes & changes

### GeoINT — command-center stack no longer runs off the right edge
On a narrower window the right-hand command stack was pinned to a fixed 300 px and overflowed the
window, clipping the Live-News **Add stream / HLS** controls. The rail now shrinks with its column
and its control rows wrap, so the whole stack stays on-screen.

### GeoINT — map blips no longer show overlapping ✕ close buttons
Clicking through events stacked on (or near) the same spot left several map popups open at once,
their close buttons overlapping. Only **one popup is open at a time** now — opening a blip's (or the
search pin's) popup closes the previous one.

### EyeSpy — "Add new feed" tile is reliably clickable
The trailing **➕ Add new feed** tile is now a real button, and **every** empty tile opens the Add
form for its slot (previously only the first empty tile did — the rest were silent). No empty square
is a dead click.

### Mail — copy & paste
You can now **select and copy** message text (the Win98 "no-select" feel previously blocked it on the
read pane), and there's an app-wide **right-click menu — Cut / Copy / Paste / Select All**. Copy
appears when there's a selection; Cut/Paste in any editable field (Compose, account setup, etc.).
Local OS-clipboard only — no network, no telemetry.

### EyeSpy — viewing YouTube streams (reminder)
The camera wall plays YouTube live/video inline: in **Add stream**, set **Kind → YouTube** and paste
the URL (`watch?v=…`, `youtu.be/…`, or `/live/…`). It frames via the sandboxed `youtube-nocookie.com`
embed. (The *Detect* button probes camera endpoints, not YouTube — pick the kind manually.)

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.0-beta.19.exe -Algorithm SHA256
```

SHA-256: `7856b3658700c5d8a1b448cf218786ca402d626b9b384349b6475e3b4078e955`
Size: 532742273 bytes (508.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**.

## Notes
- 1065 tests green; typecheck clean.
- Side-by-side note: this is the same `Ghost Intel 98` app id as beta.12+, so it upgrades in place.
  If you still have the old **Dead Cyber Society 98** install, it sits alongside — uninstall it to
  avoid testing a stale build.
