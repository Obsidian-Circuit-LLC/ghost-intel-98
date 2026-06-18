# Ghost Intel 98 — v3.14.3

**EyeSpy "All Cameras" finder polish.** A GhostExodus field batch on the EyeSpy finder. Renderer-only
— no backend, IPC, crypto, or data changes; the Win98 look is untouched.

## What changed

All in the EyeSpy "All Cameras" finder:

- **⊟ Collapse all** — a new button (Countries tab) closes every expanded country and region in one
  click, so a deep, fully-expanded location tree collapses back to a clean top-level list.
- **Even 50/50 split** — the location tree and the feed list below it now share the finder height
  equally (was 40/60), giving the tree as much room as the feed list.
- **Right-click menu clamps above the taskbar** — the camera-feed context menu's bottom items
  (**Set location…**, **Delete**) were rendering behind the app taskbar when you right-clicked a feed
  low in a long list. The menu now reserves the taskbar height, so the whole menu stays reachable.
- **Larger finder text** — the finder body font is slightly bigger for readability.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.3.exe -Algorithm SHA256
```

SHA-256: `aa0362bcaafb50d768e8e362ebe8ca95a956d7c32627f65270f107ffa1723fae`
Size: 532748545 bytes (508.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- 1071 tests green; typecheck clean. Renderer-only change (`src/renderer/modules/eyespy/Finder.tsx`).
- Same `Ghost Intel 98` app id, so it upgrades in place.
- Everything from v3.14.0 (first stable line) and v3.14.2 carries forward.
