# Ghost Intel 98 — v3.18.1

**GeoINT map-popup ✕ polish.** A small cosmetic fix to the coordinate/pin popup's close button.
Renderer CSS only; everything from v3.18.0 carries forward.

## The fix
The popup's ✕ close button is now a small **bordered square** with a centered, bold ✕ — vertically
centered on the coordinate pill, and sitting in a reserved right-hand gutter (the content text now
has 30 px of right padding) so the coordinates can never run under it. Previously it read as a wide
button overlapping the right end of the coordinates. The rule outranks MapLibre's default by
specificity, so it applies regardless of CSS import order.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.18.1.exe -Algorithm SHA256
```

SHA-256: `cef0e98d2ca9c006b2cc4d613ae491aeca554a120832a79f8ca9acf71b0fc6c4`
Size: 878313368 bytes (837.6 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior `Ghost Intel 98` build in place.

## Notes
- Renderer CSS only; no dependency, data, protocol, or egress change. typecheck + `electron-vite`
  build clean; the change is verified present in the built CSS bundle. It's purely visual — confirm
  on the running build.
- Everything from v3.18.0 carries forward.
