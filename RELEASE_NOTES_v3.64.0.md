# Ghost Intel 98 — v3.64.0

**GeoINT Event Details dossier — Phase 1.**

From GhostExodus's concept. Clicking a map incident used to give you a bare title and an "open" link — even though the War-Tracker feed was already delivering, and the code was silently discarding, the event type, full description, country, and confidence for every event.

## What's new

A dedicated **Event Details** panel opens between the map and the command rail when you select an incident:

- **Trigger:** click a map blip (the map popup and the panel both open) or right-click a Situation Feed row → **View details**.
- **Overview tab** — a real dossier built entirely from feed data: a color-coded severity badge (a high-confidence conflict shows red, e.g. "US MILITARY STRIKE"), the headline, location + coordinates + date + source, an Event Type / Confidence / Severity grid, the full description, and derived tags. Open-in-source, Share, and Add-to-Monitor actions.
- The panel coexists with your existing **Monitored Situations** list (unchanged).

## Honesty (this is an OSINT tool)

- **Nothing is fabricated.** The Overview shows only real feed data and deterministic derivations. War-Tracker's unverified social-OSINT provenance and its own confidence value are shown *as-is* — never laundered into apparent authority.
- The **Media / Sources / Intel Summary** tabs are present but **disabled ("· soon")**, not filled with fake data. They arrive in later phases: **Phase 2** = Sources (surfacing the app's corroboration engine — other feeds reporting the same event), Related events, and regional grouping; **Phase 3** = a clearly-labeled **offline**-AI summary + key entities (via your own local model, same path the Q assistant uses), with any casualty/verification detail shown only as *quoted phrases* from the source, never an invented number.

## Under the hood

- Extended the incident model with optional fields (`detail`, `eventType`, `confidence`, `country`, media flags), all additive/back-compatible; stopped dropping them in the War-Tracker mapping.
- New presentational `EventDetailsPanel` + pure field/tag helpers; a 4th grid column that reflows to the current 3-column layout when the panel is closed; the panel scrolls internally (verified headless — not stretched full-height).
- **No new network egress** (War-Tracker was already a gated, SSRF-guarded feed), **no new dependency**.
- Built subagent-driven over 6 TDD tasks with a parallel adversarial whole-branch review (0 confirmed findings); controller-verified: full suite + typecheck + headless layout check + charter audit.

## Verification

- **3,734 automated tests** passing (1 skipped); `pnpm typecheck` clean.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.64.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `8a327885aae43fc10f6997baf121c01b5e7e4c4723136014057bf541784ffde0`
- **Size:** 963,146,644 bytes (~963 MB).

*Everything from v3.63.0 and earlier carries forward.*
