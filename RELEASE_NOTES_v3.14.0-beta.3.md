# Dead Cyber Society 98 — v3.14.0-beta.3 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.2 carries forward (it launches, the
> chat invite-accept and Piper fixes are in). This build adds the **EyeSpy camera grid**. The stable
> channel remains the last non-beta line; the Tor P2P chat is still **pending external audit + FIPS
> build** — don't rely on it for real adversarial security.

## What's new

**EyeSpy — location grid.** EyeSpy goes from a flat stream list + single viewer to a location-organised
camera wall:

- **Country → State/Region → City tree** in the left sidebar, with a rolled-up camera count on every node.
  Depth is variable — UK feeds sit Country→City, US feeds sit Country→State→City (Dallas under Texas under
  United States). Cameras with no location land in an **"Ungeocoded"** bucket so nothing disappears.
- **Search box** that live-filters both the tree and the grid by label / city / region / country / URL.
- **Live tile grid** for the selected node. Tiles stream live but are **capped at 9 concurrent players**
  and lazy-mounted as they scroll into view; tiles beyond the cap show a click-to-play poster. The cap is
  also a resource guard — it bounds concurrent connections, which matters when feeds are Tor-routed. Click
  any tile to enlarge it.
- **"Import here"** — select a location node and import a feed list, and feeds that lack geo inherit that
  node's country/state/city (any geo the file itself provides still wins). Drop an archive of cameras
  straight into "London" or "Dallas".
- **Per-tile delete** — a "×" on each tile culls a dud without opening it.

No discovery, scanning, probing, or enumeration is involved — the grid only renders feeds you imported or
typed. No new network egress, no telemetry.

## How to test (in-house)

1. Install on Windows (**More info → Run anyway** — unsigned; verify the SHA-256 below first).
2. **EyeSpy tree + grid:** import a geo-tagged feed list (CSV with city/region/country columns, or JSON).
   Confirm the sidebar tree fills in with counts; click a country, then a city; confirm the grid shows
   tiles and that only a handful go live at once (the rest are posters until scrolled to).
3. **Import here:** select "London" (or any node), click **Import here**, import a list of London cameras
   with no geo columns — confirm they appear **immediately** under London with the location stamped on.
4. **Search:** type a city/country — confirm the tree prunes and the grid narrows.
5. **Per-tile delete:** click a tile's "×" — confirm it's removed after the prompt.
6. Re-confirm the beta.2 items still hold (it launches; chat invite-accept; Piper clean).

## Known limitations

- **Windows x64 only**, **unsigned** — SmartScreen will warn.
- Tor P2P chat crypto is formally modeled but **external audit + FIPS build are still pending** — treat as
  unproven for real adversarial use.
- EyeSpy live-tile *feel* (smoothness as many tiles flip live/poster on a large node) is exactly what this
  beta is for — it's been verified in code (704 tests) but interactive tuning is your run, not CI.
- Long video files attached to **encrypted** cases still buffer the whole decrypted file before playing;
  unencrypted attachments stream fine.

## Verification

`typecheck` clean · **704 automated tests** green (incl. the new `eyespy-tree` and `eyespy-budget` suites
and the extended `feed-import` stamp tests). The EyeSpy grid was built TDD with an adversarial review pass
that caught and fixed a decoder leak, a stale-selection-after-import bug, and a geo-name delimiter
corruption before merge. The two-peer-over-Tor chat flow, Piper audio, and the EyeSpy grid feel on a real
Windows install are exercised by **your** run, not CI.

---

**Artifact:** `DCS98-Setup-3.14.0-beta.3.exe` (520,575,144 bytes ≈ 496.5 MB, NSIS, x64, unsigned; Tor + Piper + offline AI models bundled)
**SHA-256:** `f8f8fab237b13bbc315bd05aa205c0d722e3f994ee95079b1bc43abde21da74c`
