# Ghost Intel 98 v3.86.0 — Spectre (WireTapper integration, phase 1)

New OSINT module: **Spectre** — wireless-signal mapping, ported from GhostExodus's find,
h9zdev's **WireTapper**. This is phase 1 of a planned four, and it ships a real end-to-end slice:
type a place, and nearby Wi-Fi from WiGLE plots on the map.

## What I did before writing any code

You asked me to analyze the whole suite first so we don't spend the next month on tweaks. Two
findings shaped everything:

- **WireTapper is CC BY-NC 4.0 (NonCommercial).** You made the call: GI98's distribution is
  non-commercial, so it's bundled with the required attribution (module About + repo NOTICE,
  crediting h9zdev). Nothing else legally changes.
- **Half of WireTapper is Linux + root + radio hardware** (live BLE scan, SDR detection,
  Bluetooth control). On the Windows build those are inert, so they are **not shipped as dead
  buttons** — they're marked as arriving with the Linux build. What ships is the half that works
  anywhere: API-query mapping.

The full analysis is in the repo at `docs/superpowers/specs/`.

## Why a native port, not the Python app

WireTapper is a Flask web app that phones out to six clearnet APIs and binds `0.0.0.0` with debug
on. Dropping that into GI98 would have punched a hole straight through the Tor-default posture.
Instead the API contracts are ported to TypeScript — **transcribed from his `app.py`, not guessed**
— and every request now runs through GI98's own Tor gate. No Python runtime, no sidecar, no CSP
change.

## Spectre, phase 1

- **Map Search:** enter a place name (or a `lat, lon`) and Scan. Spectre geocodes it (Nominatim),
  queries WiGLE for nearby networks, and plots them on the GeoINT map — same map engine, no second
  one. Each device is classified (camera / car / TV / router / …) exactly as his tool does.
- **Tor by default, fail-closed.** Every query goes over Tor. If Tor isn't ready and you haven't
  explicitly turned it off, the query is blocked with the reason — never a silent fallback to your
  real IP. Turning Tor off requires a one-time real-IP acknowledgement.
- **Your API keys are encrypted** on this device and never leave the main process — the screen only
  ever shows which keys are set, never their values. (WireTapper keeps them in a plaintext file;
  this doesn't.)
- Every API host is allowlisted and HTTPS-only.

## What you'll need

A WiGLE account's API name + token (Settings → Spectre). Enter them once. Whether the live query
returns results can only be confirmed on your machine with your keys over Tor — that's the on-device
gap every API tool has.

## Next phases

- **P2:** the other five sources — Shodan, Censys, OpenCellID, cell + Bluetooth WiGLE modes.
- **P3:** telemetry CSV + Flock ALPR dataset import, encrypted.
- **P4:** the BLE IRK resolver and saved result sets.

## Under the hood

- 716 test files, 5,414 tests, zero failures; typecheck clean.
- Tests pin each API contract to his source, prove the egress fails closed, prove the sender gate
  rejects untrusted callers, and prove keys never cross back to the renderer.
- Access ▸ OSINT Toolkit ▸ Geospatial ▸ Spectre.
