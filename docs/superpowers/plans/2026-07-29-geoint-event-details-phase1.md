# GeoINT Event Details — Phase 1 Implementation Plan (dossier spine, real data only)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Design: `docs/superpowers/specs/2026-07-29-geoint-event-details-design.md`.

**Goal:** A 4th-column **Event Details** panel that opens when you select a GeoINT incident, showing a real-data Overview dossier (severity badge, event type, confidence, description, location/coords/date/source, tags, actions) built from data the app already fetches and currently discards. No AI, no new egress. Phases 2 (Sources/Related) and 3 (labeled AI) follow as separate plans.

**Architecture:** Extend `GeoItem` with optional fields; stop dropping them in the war-tracker mapping; a presentational `EventDetailsPanel` (state owned by `GeoIntModuleInner`, per the CommandRail convention); a 4th CSS grid track that reflows to the current 3-col when closed; blip-click + Situation-Feed right-click "View details" open it.

## Global Constraints (from the design + charter)

- **No fabrication.** Overview shows only real feed data + deterministic derivations. No casualties/verification in Phase 1 (those are Phase 3, quoted-only). Provenance (source + its confidence) shown as-is.
- **No new egress, no new dependency.** War-tracker is already `safeFetch` + `networkEnabled`-gated; this plan touches only the mapping + renderer.
- **Additive/back-compatible.** New `GeoItem` fields are all optional; a board/snapshot without them renders fine (panel falls back to `summary`/`category`).
- **XSS-safe rendering** (textContent / React text; no `dangerouslySetInnerHTML`), mirroring `popup.ts`.
- **Commit author** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify` + `-c`; explicit-path `git add`; NO AI trailers. Commit ONLY on the feature branch.
- **Commands:** test `pnpm exec vitest run <pattern>`; typecheck `pnpm typecheck`; build `pnpm build` (or the controller runs `pnpm package:win`).

## Grounded seam facts

- `GeoItem` — `src/shared/post-mvp-types.ts` lines 211-231: has `id, sourceId, title, link?, summary?, published?, lat?, lon?, place?, located, category?, severity?, image?`. NO country/detail/eventType/confidence.
- War-tracker — `src/main/geoint/threat-layers/war-tracker.ts`: `interface WtEvent` (lines 40-52) currently omits `country`, `country_name`, `has_media`, `is_video` (present in raw JSON per header comment, verified 2026-06-15). `parseWarTracker(json)` (lines 63-100) maps to GeoItem keeping only title/link/published/lat/lon/`located:'geo'`/`category:'chatter'`/severity(from confidence). `severityForConfidence` (lines 55-61). Existing parse tests are the TDD pattern (find `test/*war-tracker*`).
- `classify.ts` — `classify(title, summary) → {category?, severity?}`; category vocab includes `conflict` (airstrike/shelling/missile/casualties). War-tracker keeps `category:'chatter'` (Open Question — Phase 1 keeps it; severity drives red).
- `CATEGORY_COLOR` + `severityDiameter` — `src/renderer/modules/geoint/MapGL.tsx` lines 35-48 (blip color by category, size by severity). Reuse the color map for the badge.
- `deriveThreatLevel` — `src/renderer/modules/geoint/threat.ts` lines 22-33 (NONE/GUARDED/ELEVATED/HIGH/SEVERE bucketing) — reuse its labels for the severity display.
- GeoINT module — `GeoIntModule.tsx` (`GeoIntModuleInner` line 86 owns all state; 3-col grid `.ga98-geo-3col` line 647; `<CommandRail/>` line 1130-1144 is the last child). CommandRail — `CommandRail.tsx`: ctxMenu state (line 86), Situation Feed rows `onContextMenu` (line 249), fixed-div menu (lines 126-147). Map — `MapGL.tsx` builds markers (lines 193-224); popup `popup.ts`.
- CSS grid — `theme.css`: `.ga98-geo-3col` line 977 (`380px minmax(0,1fr) minmax(0,300px)`), `.ga98-geo-railclosed` line 989.

## Tasks

### Task 1 — Extend the GeoItem model + WtEvent interface

**Files:** `src/shared/post-mvp-types.ts`; `src/main/geoint/threat-layers/war-tracker.ts` (WtEvent only). Test: `test/geoint-event-details-model.test.ts` (a compile/shape test).
- [ ] **Step 1 — failing test:** assert a `GeoItem` fixture can carry `{ detail, eventType, confidence, country, hasMedia, isVideo }` (typed) and that they're optional (a fixture without them compiles). Run → FAIL (fields don't exist).
- [ ] **Step 2 — implement:** add to `GeoItem` (post-mvp-types.ts) — `detail?: string; eventType?: string; confidence?: string; country?: string; hasMedia?: boolean; isVideo?: boolean;` (comments per the design). Add to `WtEvent` — `country?: unknown; country_name?: unknown; has_media?: unknown; is_video?: unknown;`.
- [ ] **Step 3 — typecheck + test → PASS. Commit** `feat(geoint): GeoItem detail/eventType/confidence/country/media fields + WtEvent`.

### Task 2 — War-tracker mapping keeps the fields

**Files:** `src/main/geoint/threat-layers/war-tracker.ts` (`parseWarTracker`). Test: extend the existing war-tracker parse test.
- [ ] **Step 1 — failing test:** feed `parseWarTracker` a fixture event with `{ event_type:'Military Strike', description:'…coordinated strike…', country:'IQ', country_name:'Iraq', confidence:'HIGH', has_media:true, is_video:true, lat, lng, id, date }`; assert the resulting GeoItem has `detail`=description, `eventType`='Military Strike', `confidence`='HIGH', `country`='IQ' (or 'Iraq' — pick ISO2 `country`, fall back to `country_name`), `hasMedia`=true, `isVideo`=true (existing title/link/severity assertions still pass). Run → FAIL.
- [ ] **Step 2 — implement:** in the `out.push({…})` add the fields: `detail: desc || undefined, eventType: etype || undefined, confidence: (typeof e.confidence==='string'? e.confidence : undefined), country: (ISO2 e.country) || (e.country_name as string) || undefined, hasMedia: e.has_media===true || undefined, isVideo: e.is_video===true || undefined`. Keep `category:'chatter'` and existing behavior. Validate/trim strings + clip lengths as the file already does.
- [ ] **Step 3 — test + typecheck → PASS. Commit** `feat(geoint): war-tracker mapping preserves detail/eventType/confidence/country/media`.

### Task 3 — Pure display + tag helpers

**Files:** `src/renderer/modules/geoint/event-details.ts` (NEW, pure). Test: `test/geoint-event-details-helpers.test.ts`.
- [ ] **Step 1 — failing test:**
  - `resolveEventFields(item)` → `{ eventType, detail, severityLabel, confidenceLabel, badgeColor, badgeLabel }`: `eventType = item.eventType ?? categoryLabel(item.category)`; `detail = item.detail ?? item.summary ?? ''`; `severityLabel` maps low/med/high → LOW/MEDIUM/HIGH/SEVERE (SEVERE when high + conflict-ish, else HIGH — mirror `deriveThreatLevel` bucketing for a single item); `badgeColor` = red when `severity==='high'`, else the category color; `badgeLabel` = uppercased `eventType || category || 'EVENT'`.
  - `deriveTags(item)` → string[] of lowercase keyword tags from `title + detail` using the `classify` vocab + place/country (dedup, cap ~8).
  Assert: a war-tracker high-confidence strike → badgeColor red, severityLabel 'SEVERE', tags include 'military'/'strike'/country; a politics RSS item → yellow-ish/category color, 'LOW'. Run → FAIL.
- [ ] **Step 2 — implement** the two pure functions (reuse `CATEGORY_COLOR` from MapGL — export it if not already, or re-declare a small map in event-details.ts to avoid a renderer↔map import cycle; prefer a shared const).
- [ ] **Step 3 — test + typecheck → PASS. Commit** `feat(geoint): pure event-details field/tag helpers`.

### Task 4 — EventDetailsPanel component (Overview tab)

**Files:** `src/renderer/modules/geoint/EventDetailsPanel.tsx` (NEW). Test: `test/geoint-event-details-panel.test.tsx` (jsdom).
- [ ] **Step 1 — failing test:** render `<EventDetailsPanel item={fixture} onClose={fn} onOpenLink={fn} onPin={fn} pinned={false} />`; assert it shows the badge (colored, uppercased), the title, the location/coords/date/source, the fact grid (Event Type / Confidence / Severity), the description text, the tag chips, and Open/Share/Add-to-Monitor/close buttons; clicking close calls `onClose`; clicking the source link calls `onOpenLink(item.link)`. `item=null` → renders nothing (or an empty placeholder). Run → FAIL.
- [ ] **Step 2 — implement** the presentational panel (tabs bar with OVERVIEW active + MEDIA/SOURCES/INTEL SUMMARY shown disabled/"coming soon" so the frame matches the mockup without faking data), using `resolveEventFields`/`deriveTags`. XSS-safe (React text only). Dark rail styling consistent with CommandRail's inline `railPanelStyle`. A vertical scroll for long content.
- [ ] **Step 3 — test + typecheck → PASS. Commit** `feat(geoint): EventDetailsPanel Overview tab (presentational)`.

### Task 5 — Wire selected-event state + triggers into GeoIntModule

**Files:** `src/renderer/modules/geoint/GeoIntModule.tsx`, `MapGL.tsx`, `CommandRail.tsx`. Test: `test/geoint-event-details-wiring.test.tsx` (jsdom — CommandRail right-click "View details" fires the callback; GeoIntModule renders the panel when an event is selected).
- [ ] **Step 1 — failing test:** (a) `CommandRail` with a new `onViewDetails(id)` prop renders a "View details" item in the row context menu and calls it on click; (b) `GeoIntModuleInner` renders `<EventDetailsPanel>` only when `selectedEvent` is set. Run → FAIL.
- [ ] **Step 2 — implement:** add `selectedEventId`/`selectedEvent` state to `GeoIntModuleInner`; a `selectEvent(id)`/`clearSelectedEvent()` handler; pass `onSelectItem` to `MapGL` and call it on marker click (add a click handler in `rebuildItemMarkers` alongside the popup); add `onViewDetails` to `CommandRail` + a "View details" entry in the ctxMenu (keep Add/Remove Monitor); render `<EventDetailsPanel item={selectedEvent} …>` as the child after `<CommandRail/>` (only when set), wiring `onClose`, `onOpenLink` (existing external-open), `onPin` (existing addMonitor/removeMonitor). Blip click opens BOTH the popup (existing) and the panel.
- [ ] **Step 3 — test + typecheck → PASS. Commit** `feat(geoint): select-event wiring — blip click + right-click View details open the panel`.

### Task 6 — 4-column layout + reflow

**Files:** `src/renderer/styles/theme.css`; a class toggle in `GeoIntModule.tsx`. Test: headless-harness (controller verifies) + a jsdom class-presence assertion.
- [ ] **Step 1 — failing test:** assert the module root gets a `ga98-geo-4col` class (or `data-details='open'`) when an event is selected. Run → FAIL.
- [ ] **Step 2 — implement:** add `.ga98-geo-4col { grid-template-columns: 380px minmax(0,1fr) minmax(0,360px) minmax(0,300px); }` (and a rail-closed variant) in theme.css; toggle it on the grid root when `selectedEvent` is set (else the current 3-col). Ensure the panel `.window`/`.window-body` classes (if used) don't hit the `.ga98-window-shell .window{height:100%}` stretch trap — if the panel uses `class="window"`, add a content-height override like the bookmarks fix; PREFER not using the `window` class for this panel (use rail-style divs).
- [ ] **Step 3 — typecheck + test → PASS. Commit** `feat(geoint): 4-column grid opens/reflows for the Event Details panel`.

## Post-tasks (controller, after all 6 green + whole-branch review)

- [ ] Full `pnpm test` + `pnpm typecheck` + build; **headless-Chrome harness** of the 4-col layout WITH the `.ga98-window-shell` wrapper (verify the panel is content/scroll-sized, not full-height-stretched — the window-shell `.window` trap; [[dialog-window-shell-cascade]]).
- [ ] Grep the packaged/asar for `EventDetailsPanel`/`resolveEventFields`/`ga98-geo-4col`.
- [ ] Confirm NO new egress (war-tracker path unchanged; no new fetch) and NO new dependency.
- [ ] Merge `feat/geoint-event-details` → main; ship as a release (operator's full-pipeline pattern) OR hold for Phase 2 per operator.

## Self-review

- **Coverage:** design Phase 1 = the Overview dossier from real data → Tasks 1-6; honesty guardrails (no casualties/verification, no fabrication, provenance shown) baked in (Phase 3 defers AI/quoted-phrases; Media/Sources/Intel tabs shown disabled, not faked).
- **Type consistency:** `GeoItem` fields (T1) → war-tracker mapping (T2) → helpers `resolveEventFields`/`deriveTags` (T3) → `EventDetailsPanel` props (T4) → wiring (T5). `onViewDetails`/`onSelectItem`/`selectEvent` names consistent across T5.
- **Charter:** no new egress/dep; additive optional fields; XSS-safe; war-tracker provenance/confidence surfaced as-is; nothing fabricated.
