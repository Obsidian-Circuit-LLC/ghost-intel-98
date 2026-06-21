# Ghost Intel 98 — v3.18.0

**Live ADS-B aircraft and AIS ships on the GeoINT globe.** Two new toggleable real-time layers,
viewport-bounded and gated behind the existing GeoINT network opt-in. Everything from v3.17.1 carries
forward.

## What's new

### Live Aircraft (ADS-B)
- Toggle **"Live Aircraft (ADS-B)"** in the new **Live Feeds** panel — viewport-bounded aircraft from
  **adsb.lol** (free, no key, ODbL) on a ~15 s poll, drawn as GPU circle pins color-coded by altitude
  band (ground / low / mid / high). Click a pin for its callsign/altitude/speed.
- On-demand REST through the SSRF-gated `safeFetch`; host hard-pinned to `api.adsb.lol`; fetched only
  in the main process and only when the GeoINT network gate is on. **ADS-B data © adsb.lol
  contributors (ODbL)** — attribution shown on the panel.

### Live Ships (AIS)
- Toggle **"Live Ships (AIS)"** — viewport-bounded vessels streamed from **AISStream.io** (free
  WebSocket) using **your own API key** (paste it once; stored OS-encrypted, never re-echoed to the
  renderer — same key UX as FIRMS/UCDP). Up to ~2 s render cadence; vessels unseen for ~10 min are
  pruned.
- The WebSocket runs **exclusively in the main process**; the renderer receives only parsed positions
  over IPC (no renderer socket, no CSP `connect-src` change). Host hard-pinned to
  `stream.aisstream.io`; opens only when the network gate is on, the layer is on, and a key is stored.

### Safety / architecture
- New egress hosts: `api.adsb.lol` (REST) and `stream.aisstream.io` (WSS) — both hard-pinned,
  main-only, behind the network opt-in. **Toggling either layer off, or leaving GeoINT, stops all
  traffic** — and the AIS stream is also torn down on renderer reload / crash / window close (main-side
  lifecycle hooks), so it can't outlive the UI that authorized it.
- Renderer-supplied map bounds are **validated at the IPC boundary** (`ensureBounds`) before reaching
  any URL or subscription. Feed payloads are parsed defensively (never throw) and coordinate-gated.
- MapLibre layer creation is `isStyleLoaded()`-guarded (the v3.17.1 crash class cannot recur).
- One new dependency: **`ws`** (the AIS WebSocket client, main process only). No telemetry.

## v1 scope notes
- Ships render in a single color; vessel-type classification (which requires AISStream
  `ShipStaticData`) is a planned follow-up. AIS has no auto-reconnect yet (a dropped socket stops
  updating until you re-toggle).

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.18.0.exe -Algorithm SHA256
```

SHA-256: `8602d7b7093ea8eebf093d7745a084954a01e3d2faec85c54e498f97a4584a0e`
Size: 878317349 bytes (837.6 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior `Ghost Intel 98` build in place.

## Notes
- Built subagent-driven over 9 TDD tasks with per-task + whole-branch review (which caught a main-side
  AIS-teardown lifecycle gap, now fixed). **1243 automated tests** green, typecheck + build clean.
- Everything from v3.17.1 carries forward.
