# Ghost Intel 98 — v3.21.0

**Batch 2 refinements — plus CCTV-over-Tor streaming.** A second live-OSINT dogfooding batch:
Searchlight readability and naming, a dependency-free PDF report export, GeoINT quality-of-life,
ADS-B resilience, and the headline item — routing CCTV stream viewing through Tor.

## Searchlight

- **Readability.** The Sweep toolbar and inputs are restyled midnight-purple with higher-contrast
  text so the username field and result filter are legible on the dark canvas.
- **Renamed to Searchlight.** The Dashboard hero title and the generated report headers now read
  **SEARCHLIGHT** instead of "Ghost Intel Username Sweeper."
- **PDF report export (dependency-free).** Reports can now be exported as **PDF** alongside
  HTML/CSV/JSON/TXT. It renders the existing styled HTML report through Electron's native
  `printToPDF` in a sandboxed hidden window — **no new dependency** (the earlier jsPDF approach was
  deliberately avoided). This is report *export*, not an in-app PDF viewer.
- **"Load Custom DB."** The Sweep import button is renamed from "Load Maigret DB" to **Load Custom
  DB** — the full Maigret corpus is already bundled (v3.20.0), so this control is for loading an
  additional custom `data.json`.
- The full **3,166-site Maigret database**, bundled favicons, custom sites, and the Settings network
  toggle all carry forward unchanged from v3.20.0.

## GeoINT

- **Monitored Situations — remove button.** Each pinned situation now has a per-row **×** to remove
  it, alongside the existing right-click action.
- **GeoINT Settings pane.** A new **Settings → GeoINT** pane surfaces the **AIS API key** field, so
  it's reachable even when the GeoINT network gate is off (previously the only key field was in the
  in-module Live Feeds panel, which is disabled while the gate is off). The key stays encrypted at
  rest (`secretStore`) and is never echoed back to the renderer.
- **ADS-B resilience.** The keyless ADS-B aircraft feed (adsb.lol) **remains active** and now
  **retries with exponential back-off** on rate-limits/5xx and on network failures, surfacing a
  readable "rate-limited / unavailable" status instead of a raw `HTTP 429` remote-method error.
  (AIS maritime traffic is unchanged — it already worked; the earlier error you may have seen was
  ADS-B rate-limiting, not AIS.)

## EyeSpy — CCTV-over-Tor streaming

- **View CCTV streams over Tor.** A new **CCTV-over-Tor** toggle (Settings → GeoINT, **off by
  default**) routes camera streams through a privileged **`ga98cctv://`** custom scheme backed by a
  **main-process Tor SOCKS proxy** — every stream byte egresses over the bgconn Tor circuit; the
  renderer opens no socket.
- **HLS manifests are rewritten in-proxy** so every segment / key / media URI — relative *and*
  absolute — is re-routed through the proxy, with content-sniffing of the body (not just the path or
  Content-Type) so a hostile host can't serve an un-rewritten playlist to force direct CDN egress.
- **Tor-routable kinds:** HLS, HTTP, MJPEG, MP4. YouTube and webpage viewers are **not** Tor-routable
  via this mechanism and show a notice rather than silently loading clearnet; RTSP shows its usual
  ffmpeg→HLS guidance.
- **No clearnet fallback.** If Tor isn't bootstrapped the Viewer shows **TOR NOT READY** and refuses
  to load. The webviewTag lockdown is untouched — this uses the scheme proxy, not a `<webview>`.
- **Performance note.** Live video over Tor can be slow depending on exit-node bandwidth, and CCTV
  bytes share the main Tor circuit with other GeoINT/Searchlight queries. Expect a tuning pass.

## Security / architecture

- The `ga98cctv://` handler is **main-process only**, accepts only `http(s)` origin URLs, never falls
  back to clearnet, and returns error Responses rather than throwing into the protocol layer.
- **No new npm dependencies** — reuses the existing `socksDial()`, Node `http(s)`, and `hls.js`.
- New persisted state (AIS key, `cctvOverTor`) is encrypted at rest / a boolean setting; no telemetry,
  no phone-home, no new egress beyond the Tor-routed CCTV path (which is *more* private, not less).
- The renderer CSP gains only `ga98cctv:` on `img-src`/`media-src`/`connect-src`; nothing widened.

## Quality

- **1,393 automated tests** green; typecheck + build clean.
- Built subagent-driven (batch-2 Tasks 1–5 + CCTV redesign Tasks R1–R4), then a parallel
  **adversarial whole-branch review** (correctness / security / tests-build / spec-coverage →
  refute-by-default verification) that caught and fixed a real HLS-deanonymization hole before merge.

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
