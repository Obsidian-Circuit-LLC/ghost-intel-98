# GeoINT Event Details Dossier — Design

**Date:** 2026-07-29
**Status:** Draft for review
**Module:** `src/renderer/modules/geoint/` (renderer) + `src/main/geoint/` (main)
**Origin:** GhostExodus concept (two mockups: a war-tracker "US MILITARY STRIKE" dossier and a BBC-News "Politics" dossier), relayed by the operator.

## Goal

Turn a GeoINT map incident from a bare "title + open link" popup into a rich, tabbed **Event Details dossier** — a dedicated panel that opens when you select an incident and shows the intelligence that is *already being fetched and then discarded*, plus locally-derived context (corroboration, related events, region) and a clearly-labeled offline-AI layer (summary, entities). Built in three shippable phases.

## Motivation (the core insight)

Most of the richness is **already arriving over the wire and thrown away**. The War-Tracker threat layer (`src/main/geoint/threat-layers/war-tracker.ts`) already fetches, per event: `event_type`, full `description`, `country`/`country_name`, `confidence`, `date`, media flags, and a canonical URL — but `parseWarTracker()` keeps only `title`, `link`, `published`, `lat/lon`, `severity` (from `confidence`), and hard-codes `category:'chatter'`. Everything else is dropped. The map popup (`src/renderer/modules/geoint/popup.ts`) then shows only a bold title + an "open" link. This design mostly *stops dropping data and surfaces it*, then adds honest local enrichment.

## Honesty guardrails (non-negotiable — charter)

This is an OSINT deliverable. Fabricated intelligence is worse than none.

1. **No invented numbers or statuses.** Casualties, "verified" status, and any figure MUST come from real data or be a **quoted phrase** extracted from the source description (e.g. show `"multiple killed"` as a quote, never a synthesized `Killed: 10+`).
2. **AI fields are labeled.** Every AI-derived field (Intel Summary, Key Entities, extracted phrases) carries an explicit **"AI · unverified"** stamp and never masquerades as source-confirmed fact.
3. **Provenance is surfaced, not hidden.** War-Tracker events are UNVERIFIED social-OSINT (Telegram / OSINT posts, LLM-classified) per `war-tracker.ts`. The dossier must show the source and its confidence as-is, not launder it into apparent authority.
4. **No new egress.** War-Tracker is already an integrated, gated (`settings.geoint.networkEnabled`, default `false`), SSRF-guarded (`safeFetch`) feed. The AI layer is loopback-only (the existing Q gateway). Corroboration/derivation is fully local. Nothing here opens a new network door.

## Interaction (approved)

- **Click a blip** → the existing small map popup opens **and** the Event Details panel opens on the right showing that incident's dossier.
- **Situation Feed rows** (CommandRail) get an extended right-click menu: **View details**, **Add to Monitor** (existing pin), **Group regional events** (Phase 2).
- Map markers gain a right-click → **View details / Add to Monitor** (currently markers have no context menu; only the Situation Feed list does).
- The panel has a close (✕). With no event selected the panel is hidden and the grid reflows to today's 3-column layout.

## Layout

The GeoINT grid is currently 3-column (`.ga98-geo-3col` in `theme.css`: `380px minmax(0,1fr) minmax(0,300px)` = left rail / map / CommandRail). Add a **4th track** for the Event Details panel between the map and the CommandRail when an event is selected (e.g. `380px minmax(0,1fr) minmax(0,360px) minmax(0,300px)`), and reflow back to 3-column when it's closed. The panel is a new presentational component `EventDetailsPanel.tsx` following the CommandRail convention: all state owned by `GeoIntModuleInner`, props passed down.

## Data model

Extend `GeoItem` (`src/shared/post-mvp-types.ts` lines 211-231) with **optional** fields (all additive, back-compatible):

```ts
interface GeoItem {
  // ...existing...
  detail?: string;      // full description / body (war-tracker `description`, RSS `summary` long form)
  eventType?: string;   // war-tracker `event_type` ("Military Strike"); derived category label otherwise
  confidence?: string;  // raw source confidence string ("HIGH") — distinct from the derived `severity`
  country?: string;     // ISO2 or name (war-tracker `country`/`country_name`; RSS via offline gazetteer)
  hasMedia?: boolean;   // war-tracker `has_media`
  isVideo?: boolean;    // war-tracker `is_video`
}
```

- **War-Tracker mapping** (`parseWarTracker`): stop dropping — populate `detail`, `eventType`, `confidence`, `country`, `hasMedia`, `isVideo`. (Optionally reconsider the hard-coded `category:'chatter'` — see Open Questions.)
- **RSS/feed items**: `detail` from `summary`; `country` derived from the offline gazetteer (`src/main/geoint/gazetteer.ts`) using the matched `place`/coords; `eventType` from the derived `category`.
- No new persistence for the panel itself (it's a transient view of the selected event). Monitored Situations (`src/main/services/geoint-monitor.ts`) is unchanged.

## Phase 1 — Dossier spine (real data only)

Deliver the Event Details panel with an **Overview** tab built entirely from real, already-fetched data:

- **Header:** color-coded severity badge (high/high-confidence conflict = red, e.g. "US MILITARY STRIKE"; politics = yellow; etc. — reuse `CATEGORY_COLOR` + `severity`), relative time, headline (title), location (`place`), coords, absolute date, source label, canonical link.
- **Actions:** Open-in-source (external, existing safe-open pattern), Share, Add to Monitor (existing pin), close.
- **Fact grid:** Event Type (`eventType`), Confidence (`confidence`), Severity (`severity`, displayed as LOW/MEDIUM/HIGH/SEVERE consistent with `deriveThreatLevel`).
- **Description:** `detail`, full text, XSS-safe (textContent, mirroring `popup.ts`).
- **Tags:** keyword-derived from title + description (local, deterministic — reuse/extend `classify.ts` vocabulary).
- **Last updated / ID.**

Under the hood: the data-model fields above + the war-tracker/RSS mapping changes + the panel component + the 4th grid column + the click/right-click triggers + selected-event state in `GeoIntModuleInner`. **No AI, no network beyond the already-gated feed.** This alone converts the bare popup into a real dossier.

## Phase 2 — Sources & Related (the intelligence glue)

- **SOURCES tab = corroboration surfaced.** Reuse the existing corroboration engine (`src/renderer/modules/geoint/corroborate.ts` — matches items by place + time) to list *every other feed reporting the same event*. Categorize each by its `GeoSource` into **Official / Independent / Social** (e.g. gov/major outlets = official/independent; X/Telegram/war-tracker social-OSINT = social) with a filter, matching the mockup's "SOURCES (7)" with Show: All/Official/Independent/Social.
- **RELATED tab/section:** other incidents in the same region + type within a time window (deterministic, local). War-tracker events may also carry native relation IDs (revisit if the feed provides them).
- **Group Regional Events:** now that `country`/`region` is retained, add a grouped view/filter that buckets incidents by region — surfaced from the CommandRail right-click and/or as a grouping toggle. (A view, not new persistence.)

## Phase 3 — Labeled AI layer + honest Media

- **INTEL SUMMARY tab:** a concise synthesis of the description + corroborated context, generated via the **existing local-Ollama gateway** (`src/main/services/ai.ts`, loopback `localhost:11434`, the same path the Q assistant uses). Stamped **"AI · unverified."** Gated on a local model being available; when absent, the tab shows "Local AI model not available" and every other tab still works.
- **KEY ENTITIES:** people / orgs / places extracted from the description (local model, or a deterministic extractor), labeled AI when model-derived.
- **Casualty / verification PHRASES:** extracted quotes from the description ("multiple killed", "casualties unconfirmed", "partially confirmed"), shown as quotes with the "extracted · unverified" label. **Never a synthesized number or a fabricated "Partially verified" badge.**
- **MEDIA tab (honest):** the RSS `image` (single) and any real war-tracker media reference / the `hasMedia`/`isVideo` indicator + a link to the source post. **Not** a fabricated multi-item gallery — if the source gives one image, we show one image; if it gives only a boolean, we show a "media reported → open source" affordance.

## Charter compliance summary

- **Egress:** none new — War-Tracker + feeds are already `safeFetch` + `networkEnabled`-gated (default off); AI is loopback; corroboration/derivation local.
- **Fabrication:** none — real data + labeled AI + quoted phrases only (see Honesty guardrails).
- **Offline-first:** the whole panel works from already-fetched data; only the (already-gated) feed fetch and the (loopback) AI touch anything external, and both degrade gracefully.
- **Provenance:** source + confidence shown as-is; war-tracker's social-OSINT nature not laundered.
- **No new dependency.**

## Testing approach

- **Pure/unit:** the extended `parseWarTracker` mapping (fields preserved); RSS `country` derivation from the gazetteer; tag extraction; source→category (official/independent/social) classification; related/corroboration selection. All pure, deterministic, unit-testable without network (the existing `war-tracker.ts` parse tests are the pattern).
- **Render (jsdom):** the panel renders each tab from a fixture `GeoItem`; AI tab shows the graceful-absence state when no model; severity badge color mapping.
- **Layout (headless Chrome harness):** the 4-column grid opens/reflows; the panel doesn't stretch under `.ga98-window-shell` (the `.window`-class stretch trap — verify WITH the window-shell wrapper).

## Open questions / future

1. **War-tracker `category`:** currently hard-coded `'chatter'`. Should a war-tracker "airstrike" map to `conflict` (red) instead, or stay `chatter` to preserve the low-authority signal? (Affects blip color + severity badge.) — leaning: keep it distinguishable (chatter) but let the *severity/confidence* drive the red, so unverified war chatter still reads as high-severity without being mislabeled as verified conflict.
2. **Media reality:** confirm whether the war-tracker `/events` payload includes media URLs or only the booleans (the current mapping keeps neither). If only booleans, Media tab is a "media reported" affordance, not a gallery.
3. **Related-event source:** derive locally (region+type+time) vs. any native war-tracker relation field.
4. **Phasing of "Group Regional Events":** Phase 2 as a grouped view; confirm whether it should also persist as a saved grouping.

## Approved decisions (from brainstorm)

- 4-column layout; panel opens on blip-click (popup + panel) and via right-click "View details".
- Data honesty = **real data + labeled offline AI**; no fabricated casualties/verification; AI stamped "unverified"; casualties only as quoted phrases.
- AI reuses the existing local-Ollama gateway; degrades gracefully; no new egress/dependency.
- Coexists with Monitored Situations (unchanged).
- Phasing: 1) real-data dossier spine → 2) Sources (corroboration) + Related + regional grouping → 3) labeled AI + honest Media.
