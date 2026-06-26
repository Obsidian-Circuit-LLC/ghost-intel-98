# Searchlight / GeoINT / EyeSpy Refinements (Batch 2) — Design

**Date:** 2026-06-26
**Target release:** Ghost Intel 98 **v3.21.0**
**Origin:** Second live-OSINT dogfooding feedback batch from GhostExodus (8 items).

## Context

The first refinement batch shipped as v3.20.0. This batch is a follow-on from continued
casework. Several items turned out to be *discoverability* fixes — the capability is already
built, the UI entry point is buried — and are distinguished from genuine new work below. Two
operator decisions were taken before scoping (recorded in the relevant workstreams): CCTV-over-Tor
uses **full session-proxy routing**, and the live-feeds work adds **ADS-B backoff plus surfaces the
AIS key in Settings**.

All work honours the charter: no telemetry, no new runtime network egress beyond what a feature
intrinsically requires, Tor-by-default with **no silent clearnet fallback**, encrypt-at-rest for any
secret, untrusted input coerced at the trust boundary, and **no new npm dependencies** (the PDF path
is explicitly dep-free per the operator's prior jsPDF rejection).

## Global Constraints

- Version → `3.21.0` in `package.json`; README (Status entry, version strings, install line, test
  count) and a new `RELEASE_NOTES_v3.21.0.md`.
- No new npm dependencies. Reuse `hls.js`, `ws`, Electron built-ins.
- Commit trailers required on every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`.
- Tor SOCKS port is obtained from the bgconn Tor singleton (`getBgTor()?.isBootstrapped() ? .socksPort() : null`),
  identical to `searchlightSocksPort()` in `src/main/ipc/register.ts`. When it is `null`, Tor-gated
  features **refuse to load** rather than fall back to clearnet.
- Renderer makes no direct network calls for gated feeds; the main process owns egress.
- The work stops at a reviewed feature branch. **Merge, version-bump finalisation, release build, and
  publish are operator-gated** and out of scope for the build itself.

## Findings that reshape the batch

1. **"Bake in Maigret's .json" is already done.** The committed `resources/searchlight/maigret_sites.json`
   is the full 1.2 MB `{sites,engines,tags}` envelope (v3.20.0). The re-sent attachment is a 578 KB
   older export — applying it would shrink the catalog. **No change**; the bundled DB stays.
2. **AIS already works; ADS-B is what failed.** `ais-stream.ts` is correct and was live ("461 vessels").
   The red `HTTP 429` is `adsb.lol` rate-limiting the keyless ADS-B feed — a different subsystem.

## Workstreams

### W1 — Searchlight readability + naming (cosmetic)
- The Sweep toolbar/input region reads as low-contrast/"white"; restyle `.sl-sweep-toolbar` and the
  username/result inputs to the midnight-purple canvas with high-contrast text (`searchlight.css`).
- Dashboard hero title `GHOST INTEL USERNAME SWEEPER` → **`SEARCHLIGHT`** (`Dashboard.tsx`).
- Report headers/labels that still read `GHOST INTEL USERNAME SWEEPER` / `Ghost Intel Username Sweeper`
  → **SEARCHLIGHT** (`ReportsPanel.tsx` HTML `<h1>`, TXT banner, JSON `tool` field).
- Sweep toolbar button `LOAD MAIGRET DB` → **`LOAD CUSTOM DB`** (label + `title`), reflecting that the
  full Maigret DB is now baked in and this control loads a *custom* extension DB (`SweepPanel.tsx`).

### W2 — PDF report export (dep-free)
- Add a 5th export option **PDF REPORT** to `ReportsPanel`. It reuses the existing `generateHTML()`
  string and hands it to a new main-process IPC `searchlight:exportPdf`.
- Main renders the HTML in a **hidden, sandboxed, node-integration-off `BrowserWindow`** via a
  `data:text/html` URL, calls `webContents.printToPDF`, prompts a save dialog, and writes the buffer.
  No network, no new dependency, full visual fidelity with the HTML report.
- Filename is sanitised host-side; the HTML is already entity-escaped by `generateHTML`.

### W3 — GeoINT monitored-situations remove button (cosmetic)
- The "Monitored Situations" list (`CommandRail.tsx`) currently exposes removal only via right-click.
  Add a per-row **× remove** button wired to the existing `removeMonitor(id)` handler
  (`GeoIntModule.tsx`). No new state or IPC — the action already exists.

### W4 — GeoINT Settings pane + AIS key surfaced
- Add a **GeoINT** pane to the main Settings module (new `SectionKey 'geoint'`, `SECTIONS` entry, pane
  router branch), mirroring the existing `SearchlightPane` structure.
- Surface the **AIS API key** field there (password input + Save), wired to the existing
  `window.api.geoint.setLayerKey('ais', key)` / `hasLayerKey('ais')` IPC. Unlike the in-module Live
  Feeds field, the Settings field is reachable regardless of whether GeoINT network is currently on,
  fixing the discoverability gap. The key remains stored in the encrypted `secretStore` as
  `geoint.ais.key`; it is never logged or written to plaintext settings.
- This pane is also where the W6 CCTV-over-Tor toggle lives.

### W5 — ADS-B backoff + readable status
- `fetchAdsb` (`adsb.ts`) currently throws raw `adsb.lol HTTP <status>`. Add **retry-with-backoff** on
  429/5xx (a small fixed schedule, deterministic), and on exhaustion throw a **typed**
  `AdsbRateLimited` / `AdsbUnavailable` error the renderer maps to a readable
  "ADS-B rate-limited — retrying" status instead of a raw remote-method warning.
- Backoff schedule and status classification are **pure, unit-tested** functions; the timing wrapper
  is thin glue. Host pinning and `safeFetch`/`networkEnabled` gating are unchanged.

### W6 — View CCTVs over Tor (full session-proxy routing) — largest, needs operator smoke
- New setting `geoint.cctvOverTor: boolean` (**default false**), toggle in the W4 GeoINT pane.
- **Mechanism:** when on, CCTV streams render inside a `<webview>` bound to a dedicated partition
  (`persist:cctv-tor`). The main process sets that partition session's proxy to the bgconn Tor SOCKS
  (`socks5://127.0.0.1:<port>`). A small **bundled internal player document** (`resources/cctv-player/`)
  runs hls.js / `<img>` / `<video>` for the stream *inside* the proxied partition, so every media and
  connect request egresses through Tor. The partitioned webview is the sanctioned CSP escape hatch
  (see the project's frame-src invariant) — the main renderer CSP is **not** broadened.
- **No silent fallback:** if `cctvOverTor` is on and Tor is not bootstrapped, the viewer shows a
  `TOR NOT READY` state and refuses to load the stream. With the toggle off, behaviour is unchanged
  (direct clearnet in the existing Viewer path).
- **Pure, unit-tested helpers:** `torProxyRules(port)`, `resolveCctvSession({enabled, torPort})`
  (returns the partition + proxy rules, or `{ok:false, reason:'TOR_UNAVAILABLE'}`), and the internal
  player URL builder (with strict URL/host encoding). The session-proxy application, the webview
  wiring, and the player document are glue verified by manual smoke.
- **Honest flag:** live video over Tor can be slow or stall; this is the accepted cost of the chosen
  full-routing option. Expect an interactive tuning pass with the operator after first build.

### W7 — Versioning + docs
- Bump to `3.21.0`; draft `RELEASE_NOTES_v3.21.0.md`; update README. (Merge/build/publish operator-gated.)

## Security / architecture invariants (must not regress)
- No telemetry, no phone-home, no new egress except the CCTV-Tor path (which is *more* private, not less).
- AIS key stays in `secretStore` (encrypted); never logged, never in settings JSON.
- CCTV-Tor and Searchlight both honour **no silent clearnet fallback**.
- PDF generation is offline (`data:` URL, sandboxed hidden window, no node integration).
- The internal CCTV player runs in an isolated partition with no `nodeIntegration` and no IPC access.
- No new npm dependency; `react-rnd` stays removed.

## Testing
- `test/searchlight-*` extended for the rename/title strings where asserted.
- New `test/adsb-backoff.test.ts` — backoff schedule + error classification (pure).
- New `test/cctv-tor.test.ts` — `torProxyRules`, `resolveCctvSession` gate (incl. TOR_UNAVAILABLE),
  player URL builder encoding (pure).
- Renderer surfaces (Settings pane, Viewer webview, remove button, PDF button) are typecheck + build +
  manual smoke (renderer is not headlessly unit-tested), per house practice.
- Independent green re-verification (typecheck + full suite + build) before reporting done.
