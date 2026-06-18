# GeoINT / EyeSpy field braindump — 2026-06-18 (GhostExodus, relayed)

Triage of a large dogfooding braindump. Three buckets: **done now**, **active priority**, and
**shelved (not deleted)**. Win98 aesthetic is a hard constraint on everything below — no flat-modern
redesign, no modern dashboards. The target feel is a 1998 intelligence workstation wired to modern
data.

---

## DONE NOW — EyeSpy "All Cameras" (Finder) quick fixes

Shipped on branch `feat/eyespy-finder-quickfixes` (all in `src/renderer/modules/eyespy/Finder.tsx`):

1. **Collapse-all button** — "⊟ Collapse all" under the search box (Countries tab). A monotonic
   counter signals every `TreeRow` to close; a mount-skip ref preserves the depth-0 default-open.
2. **Even split** — tree list and feed list now share the Finder height 50/50 (was 40/60).
3. **Right-click menu no longer clipped** — `FeedMenu`'s viewport clamp now reserves the 32px app
   taskbar height (read from `--ga98-taskbar-height`), so "Set location…" / "Delete" stay visible
   when right-clicking a low feed row (the bug in the screenshot).
4. **Bigger text** — Finder body font 12→13px (counts/sublabels stay 10px).

---

## ACTIVE PRIORITY — CCTV pins on the GeoINT map (the "better idea")

GhostExodus is re-scraping CCTVs **with geographic coordinates** (the London TfL jamcams pull shows
882 cameras carrying `coordinates.{latitude,longitude}`; an earlier set ~505 S3/TfL). The ask:

> A toggle/checkbox in **GeoINT** that drops a **clickable camera-icon pin** at every catalogued
> CCTV. Clicking a camera pin pops a window to **view that stream**. Lives in GeoINT, must **not
> undermine EyeSpy**.

This reuses existing bones rather than new infrastructure:
- The `CameraStream` model already carries optional `lat?/lon?` (schema-forethought landed 2026-06-10).
  CCTV pins read straight from `streams.list()` — no new store, no migration.
- GeoINT already renders markers (`MapGL` + `popup.ts`) and EyeSpy already plays every `StreamKind`
  via `Viewer`. The camera pin's popup/click reuses the EyeSpy `Viewer` (or opens EyeSpy focused on
  that stream) — no new playback path.
- The toggle gates a **camera layer** distinct from the RSS/event markers; off by default so the map
  isn't flooded.

**Relationship to EyeSpy (design fork to settle before building):** GeoINT shows *where* cameras are
+ quick-look; EyeSpy stays the *wall/workspace* for sustained viewing. Open question for GhostExodus:
does clicking a GeoINT camera pin (a) open a standalone quick-view popup, or (b) jump into EyeSpy with
that stream loaded onto the active wall square? Settle this in the brainstorm before spec.

**Gating:** this is a "build X" feature → run `superpowers:brainstorming` → spec → plan when the
scrape lands. Coordinates already flow through `extractGeo`/`pickGeo`; a clustering pass may be needed
at 800+ pins (tie into the existing corroboration spatial-bucketing, not a new lib).

---

## SHELVED — not deleted (ChatGPT-gleaned GeoINT redesign + SDR)

Held for the larger GeoINT reimagine workstream (already tracked; much already exists or is specced —
cross-refs below). Revisit as one design pass, not piecemeal.

- **Map-centric / collapsible right rail** — collapse the GeoINT command rail to give the map the full
  window, reopen on demand; keep the rail *modular* (the panel is already add/reorder/remove); don't
  leave a wide gap between the rail and the app edge. (New UX ask; not yet built.)
- **Event severity system** (Critical/High/Medium/Info, Win98 red-flash / yellow-warn / blue-info
  icons) — *partially exists*: the WOW bundle already has a literal-keyword category/severity
  classifier driving marker color/size. Open part = the discrete Win98 icon set + flashing.
- **Event clustering** (count badge, expand-on-click) — overlaps the CCTV-pins clustering need above;
  build once, use for both event and camera layers.
- **Situation Intelligence panel** (correlated "Israel-Iran Escalation · Confidence: High · Sources:
  14" summaries instead of raw events) — overlaps the existing **corroboration** resonance
  (≥2 sources, same place+time). This is the analyst-summary presentation layer on top of it.
- **Situation feed improvements** — UTC timestamps + severity icon + source + location per row
  ("11:53Z | Critical | Strait of Hormuz").
- **Additional layers** — ADS-B aircraft, AIS vessels (both NEW); conflict events + natural disasters
  already in the threat-map direction (USGS / GDACS / FIRMS / ACLED / GDELT / CISA KEV, spec
  `docs/superpowers/specs/2026-06-15-geoint-threat-map-design.md`). Prior-art each provider's
  API/licence first; route every fetch through `settings.geoint.networkEnabled` + SSRF-revalidating
  safeFetch (charter).
- **SDR feeds — paid module (NEW, SIGINT).** Catalogue + tune public SDR receivers (KiwiSDR public
  list, WebSDR.org, rx-tx.info) — pick a receiver, tune frequency, listen. "Let's both look into
  these" — needs a feasibility + legality + charter pass (these are third-party public receivers;
  audio egress + ToS + the no-network-by-default posture all need scoping) before it's a spec. Pair
  it with the EyeSpy paid-lockdown keygen work (ED25519/ML-DSA-65 + rate limiter) already queued.

Cross-refs: GeoINT reimagine workstream, threat-map spec (2026-06-15), EyeSpy roadmap ask #4
(paid lockdown), OSINT/Maltego paid-tier deliberation.
