# DCS98 GeoINT Threat Map — design spec

**Source:** GhostExodus field request (2026-06-15) for a live "Threat Map" pulling public feeds into the app's own layers; operator directives via clarifying decisions same day.
**Prior-art (primary-source verified):** `~/.claude/research-wiki/prior-art/geoint-threatmap-feeds.md` — endpoint shapes, licence terms, and a "verification debt" list. This spec does not restate endpoint details it does not need; the prior-art file is the authority and MUST be re-read by the plan/implementer.
**Status:** Draft for operator review. Ships as part of the combined release alongside the beta.10 batch (DialTerm shell, background mail, UI fixes, EyeSpy refresh) already implemented on `feat/beta10-shell-bgmail-ui`.

---

## Operator decisions (2026-06-15)

1. **Map engine:** reuse the existing **Leaflet** GeoINT map + marker/feed engine (not a MapLibre migration — the choropleth rationale evaporated once Cloudflare Radar was excluded).
2. **Layer set (final):**
   - **USGS earthquakes** — open GeoJSON pin layer (no key).
   - **GDACS disasters** — open GeoRSS pin layer (no key).
   - **GDELT events** — open GeoJSON pin layer (no key), **labeled as news-mention "chatter," not verified incidents.**
   - **NASA FIRMS fires** — pin layer behind the user's own free `MAP_KEY`.
   - **ACLED conflict events** — pin layer behind the user's own myACLED credentials **plus an explicit EULA-acceptance / responsibility notice** (see §ACLED).
   - **CISA KEV** — **non-map advisory sidebar/ticker** (KEV has zero geographic fields; it is not a pin layer).
   - **Cloudflare Radar** — **excluded** (key-gated and aggregate-only; not genuine point data).

The 5-pin + 1-sidebar set honors "include everything that can honestly be a layer" while representing each source as what it actually is.

---

## Architecture

The Threat Map is **not a new module** — it is a set of toggleable live "threat layers" added to the existing GeoINT module, rendered on the current Leaflet map via the existing `GeoItem` → marker pipeline, fetched through the existing gated/SSRF-revalidated network path.

### Reused existing bones (do not rebuild)
- Leaflet `MapPane` + marker/popup rendering; the `GeoItem` shape (`lat`/`lon`/`title`/`summary`/`link`/`date` + optional `category`/`severity`); the offline gazetteer geocoder; the timeline scrubber + story-mode (threat-layer items are timestamped, so they participate).
- The egress gate: **all** layer fetches occur only when `settings.geoint.networkEnabled` is true and go through the existing SSRF-revalidating `safeFetch` (the same path RSS/Atom/GeoJSON sources already use). No new egress mechanism.
- Per-source caching + the `MAX_FEED_ITEMS` cap.

### New units (each one clear responsibility)
- `src/main/geoint/threat-layers/` — one small fetch+parse module per provider, each exporting `fetch(opts): Promise<GeoItem[]>` (or, for KEV, a `KevEntry[]`). Provider modules:
  - `usgs.ts` — GeoJSON; coordinates are `[lon, lat, depth]` (lon-first — explicit swap); `properties.place/time/mag`. Timeframe×threshold feed suffix is a layer option.
  - `gdacs.ts` — GeoRSS XML via the shared `XMLParser`; `geo:lat`/`geo:long`, `gdacs:alertlevel` → severity.
  - `gdelt.ts` — GEO 2.0 GeoJSON, `MODE=PointData`, a `QUERY` + `TIMESPAN`; items flagged `category:'chatter'` and labeled in the popup as geocoded news mentions.
  - `firms.ts` — CSV → points using the user's `MAP_KEY`; reuses the strict-numeric coordinate guard (no silent `(0,0)`); CSV columns per the FIRMS schema **(verification debt #1 — confirm columns before coding)**.
  - `acled.ts` — JSON via myACLED OAuth using the user's own credentials; `latitude`/`longitude`/`event_date`/`event_type`/`country`/`notes` **(verification debt — confirm OAuth flow + fields)**.
  - `kev.ts` — CISA KEV JSON → `KevEntry[]` (`cveID`, `vendorProject`, `product`, `vulnerabilityName`, `dateAdded`, `knownRansomwareCampaignUse`, `shortDescription`). **No coordinates — never produces map pins.**
- `src/shared/post-mvp-types.ts` — `ThreatLayerId` union; a `ThreatLayerState` (enabled per layer); `KevEntry`; settings additions (keys + ACLED gate flag).
- IPC: `geoint:fetchThreatLayer(layerId, opts)` (gated, like the existing geoint refresh handlers) and `geoint:fetchKev()`. Validated in `validate.ts` (layer-id allowlist; opts bounds).
- Renderer:
  - A **layer-control panel** in `GeoIntModule` (checkbox per layer; FIRMS/ACLED show a "needs key" / "needs setup" state when credentials/acceptance are absent; each layer shows its attribution).
  - A **KEV advisory sidebar/ticker** (non-map panel) listing recent KEV entries with the ransomware flag highlighted; refresh button; no map interaction.
  - Per-layer marker styling (color/icon by provider + severity) reusing the existing classifier where possible.

### Settings additions (`AppSettings.geoint`)
- `firmsMapKey: string` (default `''`).
- `acled: { email: string; /* password via secretStore, NOT settings.json */ ; eulaAccepted: boolean }` — credentials stored in the existing `secretStore` (OS keyring), never plaintext in settings; only `email` + `eulaAccepted` live in settings.
- Per-layer enabled state may live in settings (persisted) or component state — decide in the plan; persistence is nice-to-have, not required for v1.

---

## ACLED — licence handling (operator-accepted risk, recorded)

Prior-art finding (quoted in the research file): ACLED's EULA bars providing "direct access to any of the Licensed Content" and states data "made available through Licensee's own dashboard" is **not** a sufficient transformative use. Rendering raw ACLED points on the app's own map is, on its face, the use the EULA restricts — **even with the user's own key.**

Operator decision: **include ACLED behind the user's own myACLED credentials + an explicit in-app responsibility notice.** Design to make the user the licensee acting on their own account, and to make the risk unmissable:

- The ACLED layer is **disabled until both** (a) the user has entered their own myACLED credentials (stored in `secretStore`), **and** (b) the user has ticked an explicit acknowledgment in a notice that quotes the EULA's redistribution clause and states: *the user is solely responsible for their compliance with ACLED's End User Licence Agreement; DCS98 fetches ACLED data to the user's own machine using the user's own account and does not redistribute it.*
- Fetch is **client-/user-scoped** (the user's credentials, the user's machine, no app-side relay or caching beyond the local session). No ACLED data is bundled, shared via the chat/export features, or sent anywhere.
- The notice text + the EULA acknowledgment flag (`geoint.acled.eulaAccepted`) gate the layer in BOTH the renderer (cosmetic) and the `geoint:fetchThreatLayer('acled')` IPC handler (authoritative — refuses unless `eulaAccepted` and credentials present), mirroring the local-shell gate pattern.
- **Recorded risk:** this is an operator-accepted legal posture, not a lawyer-verified safe harbor. The honest position (still true) is that an in-app render of personal-account ACLED data *may* violate the EULA; the operator chose to ship it behind the user-responsibility gate. Confirming with ACLED that a personal-account in-app render is permitted remains advisable and is noted as a follow-up.

---

## Network / charter compliance

- **Egress gate:** every threat-layer and KEV fetch runs only when `settings.geoint.networkEnabled` is true and goes through the existing `safeFetch` (SSRF revalidation, public-HTTP-only). Provider hosts are public HTTPS endpoints (USGS, GDACS, GDELT, FIRMS, ACLED, CISA) — allowed by `isPublicHttpUrl`; no host allowlist broadening beyond what public HTTPS already permits. No `frame-src`/CSP changes (no iframes — own layers only, per the [[dcs98-csp-framesrc-plugin-invariant]] posture).
- **No telemetry / no phone-home.** Layers fetch only the provider endpoints, only when enabled.
- **Coordinate integrity:** every parser uses the existing `strictNum`/`inRange` guards so empty/hex/out-of-range coordinates never plant silent `(0,0)` pins (the charter invariant from the beta.9 GeoINT work).
- **Determinism:** parsers are pure over their input; stable ordering for markers (existing pattern). Feeds are live (expected for a threat map); no unseeded RNG / wall-clock in parse logic.
- **Attribution:** each layer surfaces its source attribution (USGS, GDACS/UN-OCHA-JRC, GDELT, NASA FIRMS, ACLED) in the layer control / popups, per the providers' cite-on-use posture.

## Verification debt (MUST resolve during planning/implementation — charter: no fabricated endpoints)

From the prior-art file's flagged list — confirm against primary docs before coding each parser:
1. FIRMS exact CSV column names (per-sensor attribute tables).
2. FIRMS + GDELT + GDACS formal licence/attribution text (assert attribution as confirmed, not guessed).
3. ACLED OAuth flow specifics + exact JSON field names.
4. Published rate limits (FIRMS 5000/10min is confirmed; USGS/GDACS/GDELT/ACLED numeric caps were not) → add courteous client-side caching/throttling per layer.
Any detail that cannot be confirmed from a primary source is reported as a finding, not invented.

## Testing

- Per-provider parser unit tests with **recorded fixture responses** (a small captured sample per format: USGS GeoJSON, GDACS GeoRSS XML, GDELT GeoJSON, FIRMS CSV, ACLED JSON, KEV JSON): correct lat/lon extraction (incl. USGS lon-first), severity mapping, strict-coordinate rejection (no `(0,0)`), `MAX_FEED_ITEMS` cap, and the chatter-labeling for GDELT.
- Gate tests: `geoint:fetchThreatLayer` refuses when `networkEnabled` is false; ACLED handler refuses without `eulaAccepted` + credentials; FIRMS handler refuses without a MAP_KEY.
- KEV: parse fixture → `KevEntry[]`; sidebar renders entries; ransomware flag surfaced; produces no map pins.
- Layer-id validator: allowlist rejects unknown ids.

## Risks / scope

- **Size.** This is a large subsystem (5 parsers + KEV sidebar + 2 credentialed integrations + layer UI), comparable to the entire beta.10 batch. It gets its own implementation plan and subagent-driven build, then folds into the single combined release.
- **ACLED legal posture** — operator-accepted, gated, recorded above.
- **Unconfirmed provider terms** (GDACS/GDELT/FIRMS licence text) — confirm before ship; these are attribution/terms confirmations, not blockers to building the parsers.
- **Rate limits / courtesy caching** — add per-layer cache + min refresh interval so the app is a polite API citizen and avoids tripping informal throttling.
- **Combined-release red-team (F2)** must now also cover the threat-layer egress surface (6 new external endpoints) in addition to the local-shell exec surface.
