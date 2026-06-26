# Ghost Intel 98 — v3.21.0

**Batch 2 refinements — plus CCTV-over-Tor streaming.** Network operator improvements and Tor-routed video surveillance.

## Searchlight / GeoINT / EyeSpy

- **Maigret bundling + revisions.** Everything from v3.20.0 carries forward; the full 3,166-site database, bundled favicons, custom sites, and the Settings toggle remain.
- **AIS / ADS-B backoff.** Live maritime traffic (AIS) behaves as in v3.20.0; air traffic (ADS-B) was disabled in this batch after proving unreliable under Tor load. Will revisit in a future release.

## EyeSpy

- **CCTV-over-Tor streaming.** When **CCTV-over-Tor** is enabled in Settings:
  - Streams are routed through a **privileged `ga98cctv://` custom scheme** (main-process Tor SOCKS proxy) instead of direct network access.
  - HLS manifests are **rewritten in-proxy** — every segment URI (both relative and absolute) is re-routed through the proxy, eliminating direct CDN egress.
  - **Tor-routable kinds:** HLS, HTTP, MJPEG, MP4. (YouTube, webpages, and RTSP cannot be Tor-routed and will show a notice instead of loading clearnet.)
  - **When Tor is unavailable:** The Viewer displays "TOR NOT READY" and does not fall back to clearnet.
  - **Performance note:** Live video over Tor may be slow depending on exit-node bandwidth; the main Tor circuit carries all CCTV bytes, so heavy streaming can impact other main-process Tor queries (Searchlight, GeoINT feeds).
- **PDF support dependency-free.** PDF viewing no longer requires a runtime dependency; all PDF ops are native.

## Security / architecture

- New proxy handler is **main-process only**, receiving only `http(s)` origin URLs, with body and timeout limits enforced.
- No reverse-proxy fallback to clearnet: when Tor is down, the handler returns 503 and the renderer respects the refuse.
- **No new npm dependencies** — leveraged existing `socksDial()`, `https.request()`, and `hls.js` infrastructure.
- One CCTV-proxy codepath replaces the old webview player mechanism entirely.

## Quality

- **1,301 automated tests** green (down slightly from 3.20.0 due to test consolidation); typecheck + build clean.
- Implemented as subagent-driven batch (Tasks R1–R4) with whole-branch review on R1–R3.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.21.0.exe -Algorithm SHA256
```

SHA-256: `[operator fills at release]`
Size: `[operator fills at release]` bytes

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior **Ghost Intel 98** build in place.

## Notes

- Everything from v3.20.0 carries forward.
