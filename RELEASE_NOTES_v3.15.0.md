# Ghost Intel 98 — v3.15.0

**CCTV cameras on the GeoINT map.** A new toggleable camera layer brings your EyeSpy CCTV library onto
the GeoINT map, plus two field-requested GeoINT polish fixes. Renderer/main-process only — no crypto,
data-format, or protocol change; the Win98 look is intact.

## What's new

### CCTV camera layer (GeoINT)
- **Toggle "CCTV cameras (N)"** in the GeoINT panel. Every catalogued camera that has coordinates
  drops a pin on the map. Off by default.
- **Clustering** — dense areas (e.g. London's 900+ jamcams) collapse into a Win98 count badge; zoom in
  and clusters split toward individual camera pins. Clicking a cluster flies one step deeper.
- **Click a camera pin → a draggable camera window** opens and plays the live feed (the same player
  EyeSpy uses for every stream kind). Up to 8 camera windows at once; re-clicking a pin re-focuses its
  existing window rather than opening a duplicate.
- Reads straight from your EyeSpy library — the coordinates the v3.14.4 importer now lands. **No new
  data store, no migration.** The layer renders **without enabling the GeoINT network** (the pins are
  local data); playing a feed is the same direct view EyeSpy already performs.

### GeoINT polish (field feedback)
- **Popup ✕ sized to match the window title-bar button** — the map popup's close button was oversized;
  it's now the same 16×14 as the app's standard title-bar close.
- **Collapsible left command rail** — a `«` toggle collapses the GeoINT left panel to a thin strip
  (`»` to reopen), handing the freed width to the map.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.15.0.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: __SIZE__ bytes (__SIZE_MB__)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- The CCTV layer is a pure view over local data: **no telemetry, no new network path, no CSP change.**
- Built with TDD across isolated units (clustering, window policy, marker layer) with full spec +
  code-quality review; 1099 automated tests green, typecheck clean.
- Same `Ghost Intel 98` app id, so it upgrades in place.
- Everything from v3.14.0 (first stable line) carries forward.
