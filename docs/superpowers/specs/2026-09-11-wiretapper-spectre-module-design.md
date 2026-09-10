# WireTapper → GI98 "Spectre" module — design

**Upstream:** h9zdev/WireTapper (Python/Flask), CC BY-NC 4.0. Operator decision 2026-09-11:
GI98 distribution is non-commercial → bundle permitted, **attribution required** (credit h9zdev +
the licence in the module's About and in NOTICE). Egress: **all six APIs, Tor-gated + acked
clearnet**, operator-supplied keys, host-allowlisted. Architecture: **native TS port** (no Python
runtime, no sidecar, no CSP change).

Source of truth for every contract: `/root/ghostexodus-sources/wiretapper-source`. Port his
`app.py` request construction verbatim — do NOT re-derive an API's params/auth from memory (the
repeatedly-recorded failure mode).

## What is in scope (works on the Windows target)

WireTapper has two halves. Only the first functions on GI98's Windows target; the second is Linux +
root + physical radio and is **explicitly deferred** to the eventual Linux build.

IN — ported now:
- **6 API clients**, each a parameterised HTTPS GET/POST, faithfully ported:
  - WiGLE `/network/search`, `/cell/search`, `/bluetooth/search` — HTTP Basic `(name, token)`,
    bounding-box params (`latrange1/2`, `longrange1/2`).
  - Shodan `/shodan/host/search` — `key`, `query=geo:lat,lon,radius`, `limit`.
  - Censys `/api/v2/hosts/search` — ID+secret basic auth, geo bbox.
  - OpenCellID `getInArea` + public `ajax/getCells.php` — `key`, bbox. **`http://` upstream →
    force `https://`; if a host offers no TLS it is blocked, never downgraded.**
  - Nominatim `/search` — geocode a place name → lat/lon (public, no key).
  - unwiredlabs `process.php` — reverse geolocation.
- **`classify_device`** normaliser → the common `{lat, lon, ssid, bssid, vendor, signal, type}`
  device shape (ports 1:1 onto GeoINT point features).
- **Telemetry CSV import** (`telemetry_importer.py`) — preview → field-map → ingest. Port pandas →
  the app's existing CSV path; datasets encrypted at rest.
- **Flock ALPR/camera datasets** (`flock_manager.py`) — upload/preview/search/delete CSV catalogs
  of camera locations. Rendered as a map layer.
- **BLE RPA→IRK resolver** — AES-128-ECB over `@noble/ciphers` (NOT node:crypto — BoringSSL memory).
  Pure analysis of already-captured identity data; no hardware.

OUT — deferred to the Linux build (inert on Windows, so NOT shipped as dead buttons):
- Live BLE scan (`bleak`, `hci0`), SDR USB detection (`/sys/bus/usb`), Bluetooth adapter control
  (`sudo systemctl`/`hciconfig`/`rfkill`). The UI states these are Linux-only rather than offering
  a dead control (v3.84.0 reachability lesson).

## Architecture

- **Main process** `src/main/spectre/`:
  - `clients.ts` — the 6 API clients, each taking a resolved Tor gate + operator key; every request
    goes through the app's Tor-gated fetch (fail-closed, no clearnet unless `spectre.clearnet`
    acked). Host allowlist: exactly the 6 upstream hosts, https-only.
  - `normalize.ts` — `classify_device` + the device-feature shape.
  - `telemetry.ts`, `flock.ts` — CSV import + dataset CRUD via secure-fs.
  - `irk.ts` — the AES resolver.
  - `store.ts` — datasets, imported telemetry, saved results — all secure-fs, encrypted at rest.
  - `ipc.ts` — `spectre:*` namespace (collides with none of the 60+ existing); every handler
    `assertTrustedSender(e)` first, then argument validation.
- **Settings**: `AppSettings.spectre` = `{ clearnet: boolean; keys: { wigleName, wigleToken,
  opencellid, shodan, censysId, censysSecret, unwiredlabs } }`. Keys stored in the vault, never
  echoed to the renderer after save. **Add `spectre` to `mergeSettings`' deep-merge list** or an
  upgrade silently drops the keys (settings-merge-dataloss memory).
- **Renderer** `src/renderer/modules/spectre/` — native React, reusing **GeoINT's `MapGL`** for the
  map (no new map engine; respect the style-readiness gate). Views: Map Search (place/BSSID/SSID →
  query the enabled APIs → plot), Datasets (telemetry + Flock import/preview), Tools (IRK resolver),
  Settings (keys + the one-time clearnet acknowledgement, mirroring WebSDR/weather).
- **Reachability**: register the module AND add it to an Access-menu category (the guard now fails
  the build otherwise). Category: OSINT Toolkit (it is an OSINT tool).
- **CSP**: unchanged — all egress is main-process fetch, nothing embeds a remote frame.

## Security posture (every one enforced + tested)

1. Tor-default, fail-closed; clearnet only with the acked `spectre.clearnet` opt-in (the WebSDR/
   weather exception pattern) — **operator already approved the clearnet acknowledgement**.
2. Host allowlist = the 6 upstream hosts, https only; `http://` upstreams upgraded or blocked.
3. Keys in the vault (secure-fs), never plaintext `.env`/SQLite as upstream does; never returned to
   the renderer after write.
4. `assertTrustedSender` on every `spectre:*` handler.
5. No `debug=True`, no `0.0.0.0` bind — there is no server; it is in-process main.
6. Imported CSV is untrusted: parsed defensively, no formula execution, size-bounded, rendered as
   text/points only.
7. No telemetry/phone-home beyond the 6 acked OSINT APIs the operator enabled.

## Attribution

- Module About panel: "Signal engine ported from WireTapper by h9zdev, CC BY-NC 4.0" + a link.
- Repo `NOTICE` gains the WireTapper attribution + licence text.

## Overlap to resolve (not duplicate)

Flock ALPR cameras conceptually overlap EyeSpy (CCTV viewer) and GeoINT (CCTV-over-Tor, live feeds).
Decision: Spectre owns the **wireless/RF + ALPR-dataset** surface and plots onto the shared GeoINT
map; Spectre does not re-implement a CCTV viewer. A camera the analyst wants to open hands off to EyeSpy.

## Phased build

- **P1 — spine + one client end-to-end:** module skeleton, `spectre:*` IPC, settings+vault keys,
  Tor gate, the WiGLE network client, GeoINT map render, reachability entry, About/attribution.
  Ships a usable "place → nearby Wi-Fi on the map" slice.
- **P2 — the rest of the clients:** Shodan, Censys, OpenCellID (+https fix), Nominatim geocode,
  unwiredlabs, cell + bluetooth WiGLE modes; `classify_device` normaliser + legend.
- **P3 — datasets:** telemetry CSV import (preview→map→ingest) + Flock ALPR datasets, encrypted.
- **P4 — tools + polish:** IRK resolver, saved-result sets, Linux-only features shown as deferred.

Each phase: RED-first tests (client contract tests against recorded fixtures, egress-gate
fail-closed tests, sender-gate parity, CSV-injection defence), typecheck, reachability guard, and a
release. No phase ships a dead control.

## Verification floor

- Per-client contract test: the exact URL/params/auth his `app.py` builds, asserted against a
  recorded fixture (not a live call).
- Egress fail-closed: Tor down + clearnet not acked → the client opens nothing and reports the
  reason (never a clearnet fallback).
- Host allowlist: an off-allowlist or `http://` host is refused.
- Keys never cross back to the renderer after save.
- On-device (operator): live API auth with real keys over Tor can only be confirmed on the machine.
