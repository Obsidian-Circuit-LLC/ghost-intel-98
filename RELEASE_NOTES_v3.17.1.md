# Ghost Intel 98 — v3.17.1

**Hotfix: GeoINT no longer crashes on load.** A regression in v3.17.0's Space Satellites layer could
throw **"Style is not done loading"** and drop GeoINT into its error screen — and Reset couldn't
recover, because every reload re-hit the same throw. Renderer-only; everything from v3.17.0 carries
forward.

## The bug
The new satellite layer called MapLibre's `addSource`/`addLayer` **before the map style had finished
loading** — both synchronously at map init and from a `styledata` event (which fires repeatedly
*during* style loading, not only after). MapLibre throws "Style is not done loading" in that window,
which the GeoINT error boundary caught; on reload the same path threw again, so the **Reset GeoINT**
button couldn't break out. It only manifested in the running app (MapLibre runtime timing), so the
headless typecheck/build/1226-test gates didn't surface it.

## The fix
- `ensureSatelliteLayer` is now a **no-op until `map.isStyleLoaded()`** — root defense, so
  `addSource`/`addLayer` can never throw regardless of caller.
- The layer is ensured off the **`load`** event (initial — style guaranteed ready) plus a
  **self-guarded `styledata`** (re-ensure after `setStyle`, so it still survives basemap/network
  toggles). Both are idempotent via `getSource()`.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.17.1.exe -Algorithm SHA256
```

SHA-256: `2406260c233ae0f91c2bf2e2463a78cc1bacbf75350bd0c5603e24f5bf368106`
Size: 878285508 bytes (837.6 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior `Ghost Intel 98` build in place.

## Notes
- typecheck + `electron-vite` build clean; the satellite-layer unit tests stay green. The crash itself
  is MapLibre-runtime timing and is not reproducible in the node test env — confirmed by code-path
  reasoning + a live smoke.
- No dependency, data-model, protocol, CSP, or egress change.
- Everything from v3.17.0 carries forward.
