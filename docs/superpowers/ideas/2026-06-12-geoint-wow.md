# GeoINT "wow" idea space (divergent-invention, 2026-06-12)

Dream (ambitious framing): turn GeoINT from a *map that shows dots* into a **local-first geospatial
intelligence workbench** — it reads the feeds, figures out *where* and *how serious*, corroborates across
sources, surfaces what's heating up, and lets the investigator brief it as a story. All offline-first,
network off by default, no telemetry, no mass-targeting.

Existing bones to reuse: gated Leaflet map (2D/Sat/StreetView), offline `world-countries` gazetteer +
manual pins, RSS/Atom/GeoJSON sources + OPML, `geoint.snapshot()` items→markers, search→geocode→pin,
save-event→case. Latent firepower: the OSINT-plugin intel engines (keyword/severity, entity extractor,
temporal, co-occurrence graph, threat classifier, INTELREPORT) and the case/timeline/entity model.

`[S]` = shippable now in the existing architecture · `[B]` = bolder · `[??]` = out-there/speculative

## Generation (no judgment — wide)

### Geo-intelligence (wiring the map into the intel engines)
- **[S] Auto-geocode articles** — parse place names from RSS item title/body against the offline gazetteer
  → drop a pin automatically. *Also fixes "feeds not showing" (unlocated items never got a marker).*
  Cross-domain: linguistics (named-entity → grammar of place).
- **[S] Severity/category coloring** — run each item through the keyword/severity + classifier → marker
  color + icon by category (protest / cyber / military / disaster / chatter) and size by severity.
  Cross-domain: symbol systems / cartographic legend.
- **[S] Corroboration "resonance"** — when ≥2 *independent sources* report events in the same place+time
  window, they ring brighter / get a confidence badge; single-source = dim. Physics: resonance / constructive
  interference. (Genuinely valuable OSINT primitive: corroboration.)
- **[B] Geo entity graph** — entities with locations become map nodes; co-occurrence edges drawn across
  geography (the Maltego loop over the map). Math: graph-over-manifold.
- **[S] SITREP panel** — an auto-generated at-a-glance brief: top heating regions, new clusters, corroborated
  events, since-last-look deltas. Reuses INTELREPORT. Aerospace: situational-awareness display.

### Time as a dimension
- **[S] Timeline scrubber** — a play/scrub bar that animates events appearing across the map over time;
  "weather system of activity." Choreography / fluid dynamics.
- **[S] Pheromone heat-trails** — repeated activity at a place deepens a persistent, time-decaying heat
  stain, so you see where *attention accumulates*. Biology: stigmergy / ant trails.
- **[B] Spike/anomaly flares** — learn a baseline rate per region; flare when a region spikes above
  baseline (an "outbreak"). Biology: immune anomaly detection.
- **[B] Pattern memory** — surface recurring spatiotemporal patterns ("same district every Friday").
  Group theory: symmetry detection.

### Spatial reasoning
- **[S] Geofence / AOI watch** — draw a polygon area-of-interest; events inside it get flagged, saved, or
  alerted. Geometry. (Counter-extremism: watch a city/border.)
- **[S] Incident clustering** — DBSCAN-style cluster of nearby located events into an auto-named "hotspot"
  you can save as a case area (convex-hull halo). Semiconductor: defect-map clustering.
- **[S] Measure & route** — distance/bearing between two clicks; draw a path. Logistics.
- **[B] Density topography** — contour/isoline the map by event density ("intelligence topography").
  Topology.
- **[B] Magnifier lens** — drag a loupe over the map for a denser detail inset without moving the main view.
  Optics.

### Signal quality & triage
- **[S] Source trust weighting** — per-source reliability score; weight/dim markers by source trust.
  Social: reputation systems.
- **[S] Surprise ranking** — rare-source × rare-location × off-baseline → a "surprise" score; surprising
  events rise to the top. Information theory.
- **[S] Geocode triage queue** — unlocated events surfaced in a quick "pin me" queue (batch manual geocode
  assist), the items auto-geocode missed. Surgery: triage.

### Sharing & briefing (GhostExodus shares videos with mates)
- **[S] Story mode / map-narrative playback** — select events → the map plays them chronologically as a
  briefing (pan/zoom to each, show the white box + article), exportable as a case report. Narrative
  structure. *High wow + shareable.*
- **[S] Alert cues** — define triggers (keyword + region/AOI) → on match, fire the new audio notification +
  a desktop note. Theatre: cue sheets. Reuses the Mail-notification plumbing we just built.
- **[B] Day/night terminator + local-time** — solar terminator overlay; know if an event is local-night.
  Cosmology.

### Out-there
- **[??] Offline LLM geo-reasoner** — the bundled Ollama reads a cluster and writes a one-paragraph
  "what's happening here" hypothesis with caveats. `[speculative: quality of local model]`.
- **[??] Query grammar** — a little query language: `events near "Kyiv" last 7d from trusted category:cyber`.
  Linguistics: grammar.
- **[??] "Brewing" watch windows** — set a region to "brew" over N days; it accrues events quietly and pings
  when it crosses a boil. Brewing/fermentation.
- **[??] Adversary-movement inference** — chain corroborated geolocated events of the same entity into a
  movement track over time. `[speculative: attribution confidence]`. Mycelium: threads across the map.

## Cross-pollination (combinatorial — where the real product is)
- **Auto-geocode × severity-color × corroboration = a live "intelligence weather map"**: feeds flow in,
  self-locate, self-color, and brighten when corroborated — the single highest-wow bundle, and each part is
  `[S]`.
- **Clustering × SITREP × story-mode = "brief this hotspot"**: cluster → one-click SITREP → play it as a
  shareable narrative.
- **Geofence × alert-cues × the new Mail audio = a real watch system**: draw an AOI, set a keyword trigger,
  get the calm-male chime when something lands inside it.
- **Pheromone trails × timeline scrubber = "replay the week"**: scrub time and watch attention accumulate
  and fade.
- **Source-trust × surprise = a noise filter**: dim the predictable/low-trust, surface the rare-and-credible.

## Latent developments (the dream you didn't ask for)
- GeoINT becomes the **visual front-end for the whole OSINT intel stack** — the place where keyword/entity/
  temporal/graph analysis *lands on a map*. The OSINT plugin computes; GeoINT shows.
- A **corroboration engine** (resonance) is a reusable OSINT primitive beyond the map.
- **Story-mode exports** become a shareable artifact class (briefings) — a distribution/marketing surface.
