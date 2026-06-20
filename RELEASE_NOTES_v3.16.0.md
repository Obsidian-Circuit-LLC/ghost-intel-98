# Ghost Intel 98 — v3.16.0

**Live News pop-out, manual CCTV coordinates + export, and a readable AI assistant.** Four
field-driven additions plus a GeoINT polish fix. Renderer/main-process only — no crypto,
data-format, or protocol change; the Win98 look is intact.

## What's new

### Live News pop-out (GeoINT)
- A **`⧉` pop-out button** beside the Live News feed selector pops the currently-selected feed into
  its **own draggable Win98 window**, so you can watch it alongside the map and other windows.
- **No window cap** — open as many feeds as you like. Re-popping the same feed **re-focuses** its
  existing window instead of stacking a duplicate.
- The pop-out plays the same HLS/`<video>` or sandboxed YouTube embed as the inline panel, and
  honors the same **GeoINT network gate** — with the network off it loads nothing, on every surface.

### Manual CCTV coordinates (EyeSpy)
- The camera right-click **"Set location…"** dialog now takes a **Latitude** and **Longitude** for a
  **single** selected camera. Validated (lat ∈ −90…90, lon ∈ −180…180, both-or-neither); clear both
  to remove the location.
- A camera with coordinates **drops a pin on the GeoINT map** (the layer added in v3.15.0).
- Coordinate range-checking is enforced **main-side** (the trust boundary) — the renderer's own
  validation is defense-in-depth, and a half or out-of-range pair is dropped rather than stored.
- Bulk "Set location" on multiple cameras still only stamps country/region/city; it never disturbs
  each camera's existing coordinates.

### Export CCTV (EyeSpy)
- A new **"Export CCTV…"** button in the EyeSpy finder writes your whole camera library to a
  `master_CCTV.json` file (save dialog), in the same nested
  `Country → Region → City → [{ stream_url, coordinates }]` shape the importer consumes — so your
  coordinate edits are **portable and re-importable**. Verified to round-trip through the importer.

### Readable AI assistant (formatted output)
- The bundled assistant's replies now render as real **bold, italics, bullet lists, and headings**
  (emojis pass through) instead of showing raw `**`, `#`, and `*` symbols.
- Rendered by a **safe in-house markdown renderer** — no new dependency, and **no HTML injection**:
  text is rendered as React elements, so any literal `<…>` in a reply shows as text (no XSS).
- A **"Formatted assistant output"** checkbox in Settings (default **on**) switches back to plain
  raw text if you prefer.

### GeoINT polish (field feedback)
- The map popup's **✕ is shrunk again** to a clean upper-right square button — the v3.15.0 resize
  wasn't tight enough.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.16.0.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: `__SIZE__`

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- All four additions are local-only: **no telemetry, no new network path, no new egress host, no CSP
  change.** Coordinate gating lives main-side; the CCTV export refuses symlink targets.
- Built with TDD across isolated, reviewed units (news-view window policy, the master-tree builder,
  `pickGeo` gating, the markdown parser) with per-task spec + code-quality review and a whole-branch
  review per feature; **1167 automated tests** green, typecheck clean.
- Same `Ghost Intel 98` app id, so it upgrades in place.
- Everything from v3.14.0 (first stable line) carries forward.
