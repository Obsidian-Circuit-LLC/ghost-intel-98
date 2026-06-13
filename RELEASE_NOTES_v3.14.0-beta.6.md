# Dead Cyber Society 98 — v3.14.0-beta.6 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.5 carries forward. This build adds the
> **GeoINT intelligence map**, the **EyeSpy Wall Setup** flow, and **Mail auto-refresh + notification**. The
> stable channel remains the last non-beta line; the Tor P2P chat is still **pending external audit + FIPS
> build** — don't rely on it for real adversarial security.

## What's new

### GeoINT — from a dot map to an intelligence map
- **Auto-geocode that works.** The offline gazetteer grew from **250 country names to ~61.7k cities**
  (GeoNames cities5000, CC-BY). RSS/Atom articles that name a city now drop a pin automatically — *this is
  the fix for "feeds not showing up,"* which was simply that the old gazetteer only knew countries. The
  geocoder is precision-tuned: common-word prose ("officials were reading the report," "Best Practices For
  Defense") does **not** mislocate, while London / Dallas / Mariupol / Tokyo resolve cleanly.
- **Category + severity coloring.** Each item is classified (conflict / cyber / protest / disaster / crime /
  politics) with a severity; markers are colored by category and sized by severity, with a legend.
- **Corroboration glow.** When **two or more distinct sources** report the same place within a time window,
  the marker rings brighter with a confidence count — corroboration as a first-class signal.
- **Timeline scrubber.** Play events across the map over time.
- **Story mode.** Select events → the map walks them chronologically (recenter + open each article popup) —
  a briefing you can screen-record and share.
- **Search drops a pin.** Searching a place now drops a 📌 at the geocoded location, not just recenters.

### EyeSpy — Wall Setup
- **Rename now works** (it silently no-op'd before — Electron doesn't support `window.prompt`).
- **New** opens a **Wall Setup** dialog: name the board by **Country / State / City**, then start working.
- **Import a whole CCTV file into that category** straight from the dialog — feeds file under that
  Country→State→City in the finder, location-stamped, so they stay separated and searchable.

### Mail — auto-refresh + notification
- **Silent background auto-refresh** every 2 minutes (no spinner, no per-cycle notification).
- On a **new email**, plays an **audio notification** (bundled), gated by the existing sound setting.

### Internal
- A security-hardening pass on the (not-yet-shipped) offensive-engagement egress capability — durable
  tamper-evident audit, DoH-resolved targets, IDN/encoding-safe scope matching, near-linear corroboration.
  **No user-facing behavior change** (no shipped capability uses it).

## How to test (in-house)

1. Install on Windows (**More info → Run anyway** — unsigned; verify the SHA-256 below first).
2. **GeoINT:** enable the GeoINT network, add an RSS source, **Refresh** → confirm city articles now pin
   and are colored by category; corroborated events glow; scrub the timeline; play a story; search a place
   and see the 📌.
3. **EyeSpy:** **New** → set Country/City → optionally import a CCTV file into that category; **Rename** a
   board and confirm it actually renames.
4. **Mail:** leave it on an account → confirm it quietly refreshes and chimes only when new mail arrives.
5. Re-confirm beta.5 items (the app launches; chat; Piper; the EyeSpy wall).

## Known limitations

- **Windows x64 only**, **unsigned** — SmartScreen will warn.
- Tor P2P chat crypto is formally modeled but **external audit + FIPS build are still pending**.
- GeoINT auto-geocode is best-effort (text → place name); a wrong pin is correctable via manual pin mode.
- Long video files attached to **encrypted** cases still buffer fully before playing; unencrypted stream fine.

## Verification

`typecheck` clean · **801 automated tests** green (new GeoINT geocode/classify/corroborate/timeline suites +
the offensive egress-hardening suites). The GeoINT bundle was built TDD with an adversarial review pass that
caught and fixed two real defects on ordinary input — a geocoder that mislocated common-word prose and an
O(n²) corroboration freeze — before merge. The GeoINT map feel, the EyeSpy wall, and Mail on a real Windows
install are exercised by **your** run, not CI.

Adds `Places © GeoNames (CC-BY 4.0)` attribution.

---

**Artifact:** `DCS98-Setup-3.14.0-beta.6.exe` (ARTIFACT_BYTES bytes ≈ ARTIFACT_MB MB, NSIS, x64, unsigned; Tor + Piper + offline AI models bundled)
**SHA-256:** `ARTIFACT_SHA256`
