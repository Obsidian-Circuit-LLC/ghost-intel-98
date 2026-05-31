# Ghost Access 98 — v3.2.2

Adds the **GeoINT** dashboard — a pluggable, offline-first geopolitical-monitoring module
with a map.

## New: GeoINT (🌍)

Curate your own sources and watch events as a reading list and as pins on a map. Offline-first:
all network is **off by default** and gated behind one explicit opt-in.

- **Pluggable sources** — add **RSS**, **Atom**, or **GeoJSON** feeds, or **import an OPML**
  list in bulk. Nothing is baked in; every source is yours, individually toggleable.
- **Map** — a Leaflet map using a **tile server you configure**. Events with coordinates
  (GeoJSON, GeoRSS, or matched against a bundled offline gazetteer) show as pins; you can also
  drop a pin on any event manually.
- **Offline geocoding** — country-level place matching from a bundled gazetteer (built from
  the open `world-countries` dataset). No geocoding service is contacted.
- **Network is opt-in** — until you tick **"Allow GeoINT network"**, no feed is fetched and the
  map loads no tiles. Local reading of previously-fetched items keeps working offline.

## How to test on Windows

1. Install `GhostAccess98-Setup-3.2.2.exe` (unsigned — SmartScreen → **More info → Run anyway**).
   Verify the SHA-256 below first.
2. Open **GeoINT**. Tick **Allow GeoINT network** and paste a raster tile URL
   (e.g. `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`) to see the map.
3. **Add** a feed (or **Import OPML…**), then **Refresh**. Located events appear as pins;
   click an event to fly to it, or use the 📍 button to pin one manually.

## Notes

- The gazetteer is **country-level** in this release; city-level geocoding is a later add.
- Internet-tile loading and live feed fetching are the parts that need a real network + tile
  server, so they're exercised on your machine.
- Built on the v3.2.x base (Jukebox, EyeSpy bulk feed import, encrypt-at-rest, local-AI wizard).
  **Unsigned** build.

---

**Artifact:** `GhostAccess98-Setup-3.2.2.exe` (~118 MB, NSIS, x64, unsigned)
**SHA-256:** `8d0c52c4ccf13828a0b78e1f64373f03e93995b13248df69a053871d32871814`
