# Ghost Access 98 — v3.5.0

A feature release driven by the field reports: a new **Markets** module, a much stronger **GeoINT**,
resizable **Bookmarks**, a **Jukebox** restyled to the Win98 CD Player, and encrypted media that now
actually plays in-app. Hardened by a full adversarial red-team pass before release.

## What's new

- **Markets module (new).** An offline-first market overview — **off by default**, like GeoINT, and
  fetched only when you enable it. Free, keyless sources: **CoinGecko** (crypto), **Frankfurter / ECB**
  (FX), **Yahoo Finance** (indices / equities / commodities). Fully **editable watchlist** (add your own
  symbols per class) and **bring-your-own custom feeds** (any HTTPS endpoint returning a simple quote
  shape). Quotes auto-refresh every 60s; a failing source is a quiet error line, never a crash.
- **GeoINT, refined.**
  - The left panel no longer clips — its controls get a properly sized column.
  - The network control is now an obvious **Enable / Disable** button instead of a click-the-text checkbox.
  - **Street / Satellite** basemap toggle (Esri World Imagery for satellite).
  - **Map search** — type a place, hit Go, the map flies there (OpenStreetMap geocoding).
  - **Auto-refresh** every 5 minutes while the network is on.
- **Bookmarks — resizable categories.** Drag a category's bottom edge to shorten it; sparse categories
  no longer hog a full column, and the height persists.
- **Jukebox — CD-Player chrome.** A green LCD (track # + clock), a beveled transport deck, Artist /
  Title / Track fields with a live track dropdown, and a status strip.
- **Encrypted media plays in-app.** When login is on, encrypted video/audio attachments now decrypt and
  play inside the viewer (plaintext stays in memory, never on disk) instead of dead-ending.

## Security

Every change went through an adversarial red-team pass before release; all findings fixed:
- **SSRF guard is now DNS-aware** — outbound fetches (market feeds, geocoding, GeoINT sources) reject a
  host that *resolves* to loopback/private/link-local/metadata, not just one that looks internal. This
  also hardened the pre-existing GeoINT feed fetch.
- **Fetch timeout + response-size cap** on all outbound calls, so a hostile or slow feed can't hang or
  exhaust the main process.
- Server-side validation/bounding of the market watchlist and custom-feed URLs; settings deep-merge fix.
- All network egress remains **off by default** behind explicit per-module opt-in gates, and is refused
  while the vault is locked.

## Verification

- `typecheck` clean · **218 tests** (40+ files) · production build OK · headless xvfb boot smoke clean.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `GhostAccess98-Setup-3.5.0.exe` (NSIS, x64, unsigned)
**SHA-256:** `<filled in from sha256sum after the build — not transcribed from memory>`
