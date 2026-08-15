# Weather Tool — Ghost Intel 98 — Design

**Date:** 2026-08-15.
**Status:** Approved for build (design approved by operator 2026-08-15).
**Nature:** OURS (not a GhostExodus port) — a native Win98-retro GI98 utility.

## What it is

A standalone Weather tool in the Access menu. The user maintains a list of **saved locations** (added by typing a city name → geocoded, or by lat/lon). Selecting a location shows **current conditions + today's hourly strip + a 7-day daily forecast** from **Open-Meteo** (free, no API key). No device geolocation. Egress is **Tor-default with a clearnet toggle** behind a one-time warning. Offline / on fetch failure, the last cached conditions render with a "stale, cached <time>" stamp.

## Decisions (operator, 2026-08-15)

- **Saved locations** (multiple, switchable), not single-location.
- **Metric default + units toggle** (°C/km/h/mm ↔ °F/mph/in), persisted.
- **Current + today-hourly + 7-day daily** on the main view.
- **Look = ours:** a normal Win98-retro module on the `--ga98` tokens, rendering in BOTH classic + QUIET AMETHYST like every native tool. NOT a fixed bespoke theme (that pattern is only for the author-preserved ports).

## Global Constraints

1. **Egress:** Tor-default (over the bg-Tor SOCKS, reusing searchlight's `socksDial`/Tor-SOCKS path); clearnet only when `weather.clearnet` is enabled AND `weather.clearnetAck` is true (one-time real-IP warning), mirroring the GeoINT/searchlight egress-settings pattern. Tor-default + Tor-not-bootstrapped ⇒ FAIL CLOSED (clear message, offer the clearnet toggle) — never a silent clearnet fallback. A visible TOR/CLEARNET marker.
2. **Host allowlist (SSRF guard):** every request URL is built by the client and host-anchored to Open-Meteo hosts ONLY (`geocoding-api.open-meteo.com`, `api.open-meteo.com`). A saved location contributes only validated `latitude`/`longitude` numbers + a display name — never a raw URL/host. Reject anything else.
3. **No device geolocation** — locations come only from user-typed city search or explicit lat/lon (app stance).
4. **Encrypt-at-rest:** saved locations + last-conditions cache + units preference persist via secure-fs (AES-GCM), never plaintext.
5. **Determinism:** IDs/timestamps via injected seams in tested paths; the WMO-code→condition mapping is a static table.
6. **Theme:** `--ga98-*` tokens only, classic + amethyst; no-straggler green.
7. **assertTrustedSender + arg-shape validation** on every IPC handler; numeric lat/lon + string city are validated/clamped main-side (never trusted raw).
8. **No telemetry / no egress** beyond the Open-Meteo GETs the user's saved locations require.
9. **ADHD-friendly:** one-click location switch, always-visible egress + stale state, plain language.

## Architecture

- **`src/shared/weather/types.ts`** — `SavedLocation` (id, name, country, latitude, longitude, addedAt), `CurrentConditions`, `HourlyPoint`, `DailyPoint`, `Units` ('metric'|'imperial'), `WeatherCode` mapping type. Plus the WMO-code→{label, glyph} table.
- **`src/main/weather/client.ts`** — the Open-Meteo client: `geocodeCity(name)` → `geocoding-api.open-meteo.com/v1/search?name=<enc>&count=…`; `fetchForecast(lat, lon, units)` → `api.open-meteo.com/v1/forecast?latitude=&longitude=&current=…&hourly=…&daily=…&timezone=auto&<unit params>`. URL construction is host-anchored (constraint 2). Egress via an injectable Tor/clearnet dial seam (reuse `socksDial`); Tor-gate resolution mirrors `resolveXTorGate`/GeoINT. Pure URL-builders + response normalizers are separately testable (no network).
- **`src/main/weather/store.ts`** — secure-fs CRUD for saved locations + units pref + a per-location last-conditions cache.
- **`src/main/weather/ipc.ts`** — channels: locations list/add(geocode+save)/remove/reorder, forecast(fetch+cache), unitsGet/Set, egress state. assertTrustedSender + validation. Preload allow-list + `api.d.ts`.
- **`src/renderer/modules/weather/WeatherModule.tsx`** + `weather.css` — locations list + search-to-add, current-conditions card, today hourly strip, 7-day daily row, units toggle, TOR/CLEARNET marker + clearnet-ack flow, stale-cache banner. Registered in `register-builtins.tsx` in the Access menu (plain — no osint/creativity category).
- **Settings** — add `weather.torDefault`/`clearnet`/`clearnetAck` + `weather.units` to `AppSettings` (+ mergeSettings, per the settings-merge lesson).

## Data flow

1. **Add location:** type city → `geocodeCity` (Tor-gated) → present matches (name, admin, country, lat/lon) → user picks → save encrypted.
2. **View location:** `fetchForecast(lat, lon, units)` (Tor-gated, timezone=auto) → normalize → render current + today-hourly + 7-day → cache last conditions.
3. **Units toggle:** flip the Open-Meteo unit params (`temperature_unit`, `wind_speed_unit`, `precipitation_unit`) + persist + re-fetch/re-label.
4. **Failure/offline:** render cached conditions + "stale, cached <time>"; if no cache, a clear "couldn't reach Open-Meteo over <Tor|clearnet>" with the clearnet toggle offered. Tor-not-ready + Tor-default ⇒ fail-closed.

## Error handling

Geocode no-match → "No match for '<city>'." Forecast failure → cached+stale or the reach message. Tor not bootstrapped (Tor-default) → fail-closed, offer clearnet. Foreign host (defense) → rejected before any dial. Malformed lat/lon → validation error, no request.

## Testing

- **Main:** URL builders produce the EXACT host-anchored geocode/forecast URLs incl. unit params (a foreign host / injected host is impossible); Tor-gate selects Tor vs clearnet per settings + fails closed when Tor-default and Tor down; response normalizers map Open-Meteo JSON → current/hourly/daily; WMO-code→condition table; secure-fs cache round-trip (ENCX on disk); offline → cached+stale path.
- **Renderer (jsdom):** add/switch/remove/reorder saved locations via the real channels; units toggle re-labels + re-fetches; current+hourly+7-day render; egress marker + clearnet-ack; stale banner on a cache-only render.
- **Headless computed-style:** the module renders correctly under classic + amethyst; no-straggler + typecheck + full suite green.

## Out of scope (v1, YAGNI)

Maps/radar; severe-weather alerts; device geolocation; hourly beyond today; historical weather; multiple forecast providers.

## Decomposition (2-phase build)

- **Phase 1 (main):** types + WMO table + Open-Meteo client (Tor-gated, host-anchored, URL builders + normalizers) + secure-fs store + settings fields + IPC (assertTrustedSender).
- **Phase 2 (renderer):** the module UI (locations, current, hourly, 7-day, units toggle, egress marker + ack, stale banner) + `--ga98` theming (classic+amethyst) + Access-menu registration. Then whole-branch adversarial review (egress/host-allowlist · correctness/UX/fidelity).
