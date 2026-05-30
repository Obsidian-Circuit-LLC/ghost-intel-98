# Ghost Access 98 — v3.2.1

Adds **bulk feed ingestion to EyeSpy** — import your own camera feeds en masse instead of
adding them one at a time.

## New: EyeSpy → Import feeds…

A new **Import feeds…** button (next to *Add*) bulk-loads a list of your own / authorized
camera feeds from a file you choose. It **auto-detects** the format:

- **JSON** array — `[{ "label": "Front", "url": "...", "kind": "hls" }]` (or bare URL strings)
- **CSV** — `label,url,kind` (header optional, `kind` optional, quoted commas handled)
- **Plain text** — one stream URL per line

For each entry, the stream **kind** is inferred from the URL when you don't give one
(`rtsp://` → RTSP, `.m3u8` → HLS, `.mp4` → MP4, an image extension → still image, otherwise
MJPEG), and the label is derived from the host. URLs are validated to **http / https / rtsp**
only, the list is **deduplicated by URL**, and the import reports how many were added vs.
skipped.

It parses a file you select — there is **no network discovery or scanning**. RTSP cameras
import fine; since Chromium can't play RTSP directly, EyeSpy shows them with its existing
ffmpeg→HLS bridge note (in-app playback covers HLS, MJPEG, MP4, and refreshing stills).

## Also in 3.2.x

The **Jukebox** media player (from v3.2.0) and the v3.1.0 local-AI online wizard are
included. This build is **unsigned** — SmartScreen will warn; **More info → Run anyway**.

---

**Artifact:** `GhostAccess98-Setup-3.2.1.exe` (~118 MB, NSIS, x64, unsigned)
**SHA-256:** `d3e1cc78355dc01c402e1537cc7ee44a06f3ed753d90dbea8012e976f6254e5f`
