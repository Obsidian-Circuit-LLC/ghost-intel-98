# Ghost Intel 98 — v3.17.0

**Space Satellites on the GeoINT globe** — a new toggleable layer that propagates satellites from
their TLEs (SGP4) and draws them, moving, on the 3D globe, with a sortable table, type filters,
add/import-your-own, and a CelesTrak default behind the existing GeoINT network opt-in plus a bundled
offline snapshot. This release also *actually* fixes the GeoINT map popup that v3.16.3 patched
ineffectively.

## What's new

### Space Satellites layer (GeoINT)
- **Toggle "Show Space Satellites (N)"** in GeoINT — every active satellite drops a real-time
  **SGP4-propagated** pin on the globe, updated on a ~2 s tick, color-coded by type (Starlink, GPS,
  weather, comms, earth-obs, space stations, scientific, other).
- **Offline by default:** the layer boots from a bundled dated TLE snapshot — no network needed on
  first toggle.
- **Live refresh (opt-in):** enable the GeoINT network and hit **Refresh** to pull a live catalogue
  from **CelesTrak** for the group of your choice (Active, Starlink, GPS, Space Stations, Weather,
  Science). Refresh with the network off toasts guidance instead of fetching.
- **Bring your own:** the **Space Satellite Manager** adds a single satellite by name + TLE, or
  bulk paste-imports TLE text; user satellites persist (encrypted at rest) and merge with the
  snapshot on load.
- **Data table:** sortable by name/type/altitude/velocity/inclination, capped at 500 visible rows,
  with **Track / Center / Details** row actions and an **Export…** JSON download. Per-type
  checkboxes filter both the table and the globe.
- **Performance:** rendered as a single GPU **GeoJSON** layer (not thousands of DOM markers), so the
  full active catalogue stays smooth.

### GeoINT map popup — fixed for real
- The v3.16.3 "fix" re-scoped the popup CSS globally but **tied MapLibre's own
  `.maplibregl-popup-content` on specificity** — and since `maplibre-gl.css` loads after the app
  theme, MapLibre won the tie: a white box with **near-invisible coordinates** (our orphan light text
  color on MapLibre's white background) and the default oversized ✕.
- Now the popup rules are prefixed with the `.maplibregl-popup` wrapper to **outrank** MapLibre
  regardless of import order. The popup is an **opaque black card** with **light-grey, unobstructed
  coordinates** and a **minimal square ✕** in its own gutter.

## Architecture / safety
- **SGP4** via the MIT `satellite.js` library, wrapped behind our own pure `propagate()` and
  verified against an ISS reference vector; propagation is deterministic given `(records, date)` (the
  real-time `Date` is a documented, display-only exception).
- **Egress:** the only new host is `celestrak.org`, fetched **only in the main process** and **only
  when the GeoINT network opt-in is on** (the same gate as the threat-layer/RSS fetchers). No
  telemetry, no new CSP changes. Export is a renderer-only Blob download (no IPC).
- Untrusted TLE/CelesTrak text is parsed defensively (never throws; no HTML construction).

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.17.0.exe -Algorithm SHA256
```

SHA-256: `236d624fcb982ffdc0a0aadb0780d8c96024de295d2422f42153b498ce4745a6`
Size: 878285668 bytes (837.6 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior `Ghost Intel 98` build in place.

## Notes
- Built subagent-driven over 10 TDD tasks with per-task + whole-branch review; the data layer
  (TLE parse, SGP4, classify, GeoJSON builder) is unit-tested and the whole-branch review caught one
  integration defect (the layer surviving `setStyle`), now fixed. **1226 automated tests** green,
  typecheck + build clean.
- One new dependency: `satellite.js@5.0.0` (MIT, pure-JS, integrity-pinned).
- Everything from v3.16.3 carries forward.
