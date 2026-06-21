# GeoINT Live Feeds — AIS (ships) + ADS-B (aircraft) — Design

**Date:** 2026-06-21
**Status:** Approved design → implementation plan
**Module:** GeoINT (core app `/dcs98`, repo `Obsidian-Circuit-LLC/ghost-intel-98`)

## Goal

Two new toggleable GeoINT layers showing live moving vehicles on the globe: **ADS-B aircraft** and
**AIS ships**, each viewport-bounded, color-coded, click-to-detail, and gated behind the existing
GeoINT network opt-in. They use **two different transports** — ADS-B is a REST poll (fits the existing
threat-layer pattern); AIS is a WebSocket stream (new to this codebase) — and that split drives the
architecture.

## Decisions (locked)

- **Both layers in one spec.**
- **ADS-B source: adsb.lol** — free, no key, REST radius query (`/v2/lat/{lat}/lon/{lon}/dist/{nm}`),
  single host `api.adsb.lol`, **ODbL** license (redistribution OK with attribution).
- **AIS source: AISStream.io** — free real-time global **WebSocket**, host
  `wss://stream.aisstream.io/v0/stream`, requires a **user-supplied** free API key (bounding-box
  subscription required). AISStream publishes no data-license/ToS — mitigated by user-key-only (the
  app ships no credential and displays only the user's own stream; no redistribution).
- **Coverage + cadence: viewport bbox.** ADS-B polled every **~15 s**; AIS streams continuously with a
  bbox re-subscribe on viewport change (debounced ~500 ms) and a **~2 s render throttle**; vessels
  unseen for **~10 min** are pruned.
- **New dependency: `ws`** (standard pure-JS WebSocket client; Node 20 / Electron-main has no stable
  global WebSocket).
- **Out of scope:** track-trails/history, paid sources (MarineTraffic, adsbexchange), the self-host
  SDR path, OpenSky.

## Global constraints

- No telemetry/analytics/phone-home.
- New egress hosts: **`api.adsb.lol`** (REST) and **`stream.aisstream.io`** (WSS) — both hard-pinned
  (no user-configurable URL), connected **only in the main process**, **only when
  `settings.geoint.networkEnabled` is true** AND the relevant layer is on (and, for AIS, a key is
  present). Nothing connects when the gate is off — the `gate:confinement` no-egress test must still
  pass.
- Renderer stays untrusted and egress-free: the AIS WebSocket lives in main and pushes parsed
  positions to the renderer over IPC (no renderer socket, no CSP `connect-src` change).
- Remote feed content (adsb.lol JSON, AISStream messages) is attacker-influenced — parse defensively,
  never build HTML strings; coordinate-gate every position before it reaches the map.
- Determinism: position freshness uses wall-clock (`Date.now()`) for prune/age — a documented
  real-time-display exception; the pure parsers/bbox math are deterministic and unit-tested.
- License compliance: render an **adsb.lol ODbL attribution** line on the panel.
- TypeScript strict; `pnpm typecheck` + `pnpm test` green. Renderer verified via typecheck + build +
  manual smoke. MapLibre layer creation MUST be guarded by `isStyleLoaded()` and driven off
  `load`/guarded `styledata` (the v3.17.1 crash lesson — baked in from the start).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 …` / `Claude-Session: …`.

## Architecture & file layout

Main — new dir `src/main/services/livefeeds/`:

| File | Responsibility |
|---|---|
| `adsb.ts` | `fetchAdsb(bbox): Promise<AircraftPos[]>` — adsb.lol radius query (bbox→center+radius), through `safe-fetch`; parse + coord-gate; gated by `networkEnabled`. Pure parser `parseAdsb(json)` split out for tests. |
| `ais-stream.ts` | The AISStream WebSocket client (main-only): connect with the user key, subscribe with a bbox, parse `PositionReport`s into a vessel map, prune unseen >10 min, emit batched snapshots on a ~2 s throttle. Pure `parseAisMessage(raw)` split out for tests. Lifecycle: `startAis(key, bbox, onPositions)`, `setAisBbox(bbox)`, `stopAis()`. |
| `bbox.ts` | Pure geo helpers: `boundsToRadiusQuery(bounds)` (center + capped radius NM for adsb.lol), `boundsToAisSubscription(bounds)` (AISStream bbox array), shared by both. |

IPC (in `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`):
- `livefeeds.fetchAdsb(bbox)` — REST, gated.
- `livefeeds.aisStart(bbox)` / `aisStop()` / `aisSetBbox(bbox)` — control the main-side socket (gated; aisStart no-ops without key/network).
- `livefeeds.setAisKey(key)` / `hasAisKey()` — key stored in `secretStore` at `geoint.ais.key` (mirror the FIRMS/UCDP keyed pattern; add `'ais'`-style id where the keyed-layer machinery expects it, or a dedicated secret key).
- Push event `livefeeds:aisPositions` — main → renderer batched vessel snapshots.

Renderer — new dir `src/renderer/modules/geoint/livefeeds/`:
- `types.ts` — `AircraftPos`, `ShipPos`, bbox type.
- `aircraftLayer.ts` / `shipLayer.ts` — GeoJSON source+circle layer each (satellites pattern; `isStyleLoaded()`-guarded ensure; color by altitude band / vessel type; click→`onSelect`). A shared `buildVehicleFeatures(items)` pure builder (unit-tested) parameterized per layer.
- `LiveFeedsPanel.tsx` — toggles "Live Aircraft (ADS-B)" + "Live Ships (AIS)", the AIS key field (gated like FIRMS/UCDP; Save → `setAisKey`, never kept in renderer state), live counts, optional type/altitude filters, and the **adsb.lol attribution** line.

Wiring: `GeoIntModule.tsx` (toggles, key state, the 15 s ADS-B poll, the `livefeeds:aisPositions` subscription, viewport→bbox plumbing) + `MapGL.tsx` (debounced `moveend`→bbox callback feeding both feeds; ensure both layers `isStyleLoaded`-guarded on `load`/`styledata`).

## Data model

```ts
interface Bounds { west: number; south: number; east: number; north: number; }

interface AircraftPos {
  id: string;            // ICAO hex
  callsign: string | null;
  lat: number; lon: number;
  altFt: number | null;  // barometric altitude
  gsKt: number | null;   // ground speed
  trackDeg: number | null;
  category: 'ground' | 'low' | 'mid' | 'high'; // altitude band for color
}

interface ShipPos {
  id: string;            // MMSI
  name: string | null;
  lat: number; lon: number;
  sogKt: number | null;  // speed over ground
  cogDeg: number | null; // course over ground
  type: 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'tug' | 'pleasure' | 'other';
  lastSeen: number;      // epoch ms (for prune)
}
```

## Data flow

**Viewport bbox (shared):** `MapGL` debounces `moveend` (~500 ms) and calls `onBboxChange(bounds)`.
`GeoIntModule` fans it to: (a) the ADS-B poll's next query; (b) `livefeeds.aisSetBbox(bounds)` to
re-subscribe the AIS stream.

**ADS-B:** while the aircraft layer is on, a `setInterval(~15 s)` (and an immediate first tick, and on
bbox change) calls `livefeeds.fetchAdsb(bbox)` → `AircraftPos[]` → update the aircraft GeoJSON source.

**AIS:** toggling the ship layer on calls `livefeeds.aisStart(bbox)`. Main (only if `networkEnabled`
+ key present) opens the WSS, sends the subscription `{ APIKey, BoundingBoxes: [...] }`, and on each
`PositionReport` updates an in-memory vessel map (keyed by MMSI, stamped `lastSeen`). A ~2 s throttle
prunes vessels older than ~10 min and emits the current snapshot via `livefeeds:aisPositions`; the
renderer updates the ship GeoJSON source. Toggle-off / network-off / unmount → `aisStop()` closes the
socket.

## Rendering & performance

Two GPU GeoJSON circle layers (the satellites pattern), each created via an `isStyleLoaded()`-guarded
ensure on `load` + guarded `styledata` (so they survive `setStyle` and never throw the v3.17.x crash).
Aircraft color by altitude band; ships by vessel type. Viewport-bounded payloads keep counts modest;
no DOM markers. Click a feature → detail popup (callsign/alt/speed/track, or MMSI/name/type/SOG/COG).

## Error handling

- Network off, or AIS key absent → the relevant connection never opens; `fetchAdsb` returns `[]`;
  toggling AIS on without a key toasts guidance (no silent failure).
- adsb.lol fetch failure (timeout/non-200/garbage) → toast, keep last positions.
- AIS socket error/close → main retries with bounded backoff while the layer stays on; surfaces a
  status to the panel; never busy-loops.
- Malformed adsb/AIS messages → skipped by the defensive parser (never throws); positions failing the
  coord gate are dropped.
- Vault locked on `setAisKey` → surfaces `EVAULTLOCKED` like the other keyed layers.

## Testing

Pure units (vitest, node): `parseAdsb(json)` (valid/partial/garbage → typed, coord-gated);
`parseAisMessage(raw)` (PositionReport extraction, non-position types ignored, never throws);
`boundsToRadiusQuery` / `boundsToAisSubscription` (math, radius cap); vessel-prune (drops >10 min,
keeps fresh); `buildVehicleFeatures` (FeatureCollection, `[lng,lat]` order, color/category props).
Main `adsb.ts`/`ais-stream.ts`: `networkEnabled`-off and no-key gates return empty / don't connect
(mocked socket + fetch). Renderer layers/panel: typecheck + build + manual smoke.

## Decomposition (for the plan)

1. Pure geo + parsers — `types.ts`, `bbox.ts`, `parseAdsb`, `parseAisMessage`, prune + `buildVehicleFeatures` + tests.
2. Main ADS-B — `adsb.ts` (gated REST fetch) + IPC + preload + tests.
3. Main AIS — `ais-stream.ts` (ws lifecycle, key, bbox, throttle/prune, push) + `ws` dep + IPC + secret-key wiring + tests.
4. Map layers — `aircraftLayer.ts` / `shipLayer.ts` (guarded ensure) + builder tests + MapGL bbox/`moveend` debounce + both-layer ensure.
5. Panel + wiring — `LiveFeedsPanel.tsx` (toggles, AIS key field, filters, counts, ODbL attribution) + `GeoIntModule.tsx` (poll, AIS push subscription, bbox fan-out) + docs.
