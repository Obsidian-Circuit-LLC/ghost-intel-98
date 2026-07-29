# Ghost Intel 98 — v3.65.0

**GeoINT Event Details dossier — Phase 2 (Sources & Related).**

Phase 1 gave a map incident a real Overview dossier. Phase 2 brings the **SOURCES** tab live and adds regional grouping — the intelligence glue that connects an incident to everything else reporting it, without inventing a shred of authority it can't substantiate.

## What's new

- **SOURCES tab — factual corroboration.** Selecting an incident now shows *the other feeds reporting the same event*, surfaced from the app's existing corroboration engine (co-location in place, and time when both are dated). Each row is a real feed: its label, how long ago, and how far away. The header **SOURCES (N)** is the count of **distinct other feeds** — repeat reports from one feed are deduped to a single row, and the incident's own source is never counted as corroboration. A filter switches between **All / This source / Other feeds**.
- **Related in Region.** Below the sources, other incidents in the **same country and of the same type** within a time window — explicitly excluding the same-event duplicates above, so "related" always means *another* event, not the same one seen twice.
- **Group Regional Events.** Right-click a Situation Feed row → **Group regional events** filters the map and the feed to that incident's country, with a dismissable `Region: XX ✕` chip. It's a view, nothing is saved.

## Honesty (this is an OSINT tool)

- **No invented authority.** The mockup's "Official / Independent / Social" source tiers were dropped: the app only knows a feed's *format*, never whether a source is a government outlet or a Telegram scraper. Rendering those tiers would assert authority the data can't back — exactly the provenance-laundering the dossier is built to avoid. So sources are shown factually, by their real label, and nothing is ranked.
- **The unverified stamp travels.** War-Tracker / social-OSINT `chatter` items keep their **⚠ unverified social-OSINT** marker *everywhere* they appear — in the corroboration list **and** the Related list. (An adversarial whole-branch review caught the Related list initially missing it; it's now stamped and regression-tested.)
- **Nothing fabricated.** Every source and related row is real, already-fetched feed data. The Media / Intel Summary tabs remain disabled ("· soon") — Phase 3.

## Under the hood

- Two new pure, deterministic selectors — `corroboratingItems` (reuses the corroboration engine's grid + haversine + time-window) and `relatedEvents` (region + type, excluding the corroboration set). No change to the incident or source data model.
- **No new network egress** (the feeds were already gated + SSRF-guarded), **no new dependency**.
- Built subagent-driven over 5 TDD tasks with a parallel adversarial whole-branch review (correctness / charter / tests / security, refute-by-default verified); controller-verified: full suite + typecheck + a headless computed-style layout check (the dossier scrolls internally under the window-shell, not stretched).

## Verification

- **3,756 automated tests** passing (1 skipped); `pnpm typecheck` clean.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.65.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `3fda43456626a27c61bd162c0d5ac1c765b9164d91e0768c6624635ea6f42a54`
- **Size:** 963,147,275 bytes (~963 MB).

*Everything from v3.64.0 and earlier carries forward.*
