# Dead Cyber Society 98 — v3.14.0-beta.4 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.3 carries forward. This build is the
> **EyeSpy redesign** — a finder + a curated 3×3 video wall, replacing the auto-filling grid that flooded
> when pointed at a large archive. The stable channel remains the last non-beta line; the Tor P2P chat is
> still **pending external audit + FIPS build** — don't rely on it for real adversarial security.

## What's new

**EyeSpy — finder + curated 3×3 wall.** EyeSpy is rebuilt around the way you actually run it: browse a big
library on the left, build a small live wall on the right.

- **Finder (left):** **Countries / Cities** tabs, a **search box** (global — returns hits across the whole
  library, not just the selected node), a **flag + camera count** on every location node (offline emoji,
  nothing fetched), and a **feed list** whose rows **right-click** to *Add to active square*, *Play
  full-screen*, *Edit*, *Set location…*, or *Delete*.
- **Curated 3×3 wall (right):** nine slots that **start empty**. Click a slot to make it **active**, then
  right-click a feed → it drops into that square (or the next empty one). The empty slot is the
  **"＋ Add new feed"** tile. Each filled tile carries an **"as of <time>"** header (local wall-clock — an
  honest "as of", not a spoofed camera timecode) and a label, with a **×** to clear it. Nine slots means a
  500-feed archive can never flood the view again.
- **Named walls:** **save / open / rename / delete** boards ("London ops", "Dallas"); they persist and the
  app reopens your last one.
- **One contextual Import button:** it reads **"Import…"** at the root and **"Import to London…"** when a
  location node is selected (stamping that location onto feeds that lack geo). The old redundant
  "Import here / Import feeds" pair is gone.
- **Set location** (one feed or a selection) files a bare, geo-less archive into the Country→State→City
  tree after the fact; **Fill wall from <node>** loads a location's first nine feeds in one click.

No discovery, scanning, probing, or enumeration — EyeSpy only renders feeds you imported or typed. No new
network egress, no telemetry.

**Also:** a source-hygiene fix — a control-stripping regex in `validate.ts` (and two test files) had been
authored with raw control bytes, which made those files read as binary and broke text tooling; they now
use escapes (behaviour identical), with a CI guard so it can't recur.

## How to test (in-house)

1. Install on Windows (**More info → Run anyway** — unsigned; verify the SHA-256 below first).
2. **No flood:** import your full feed archive — confirm it populates the **finder list**, not the wall.
3. **Build a wall:** click an empty square (it goes active), right-click feeds in the finder → **Add to
   active square**; confirm they land where you expect and the 3×3 fills deliberately.
4. **Named walls:** save the wall, name it, make a second one, switch between them, restart — confirm they
   persist.
5. **Organise a bare archive:** right-click a feed → **Set location…** → file it into UK › London or
   USA › Texas › Dallas; confirm the tree (with flags + counts) fills in.
6. **One Import button:** select London → confirm the button reads **"Import to London…"**; at the root it
   reads **"Import…"**.
7. Re-confirm beta.3 items (the app launches; chat invite-accept; Piper clean).

## Known limitations

- **Windows x64 only**, **unsigned** — SmartScreen will warn.
- Tor P2P chat crypto is formally modeled but **external audit + FIPS build are still pending**.
- EyeSpy live-tile *feel* (multiple feeds streaming on the wall) is what this beta is for — verified in
  code (712 tests) but interactive tuning is your run, not CI.
- Long video files attached to **encrypted** cases still buffer fully before playing; unencrypted stream fine.

## Verification

`typecheck` clean · **712 automated tests** green (new EyeSpy `wall` + `walls-service` suites, extended
finder-helper tests). The redesign was built TDD with an adversarial review pass that caught and fixed a
wall-save race, a Cities-tab filter that silently showed all cameras, and ghost slots from deleted feeds
before merge. The EyeSpy wall feel and the chat/Piper paths on a real Windows install are exercised by
**your** run, not CI.

---

**Artifact:** `DCS98-Setup-3.14.0-beta.4.exe` (520,577,846 bytes ≈ 496.5 MB, NSIS, x64, unsigned; Tor + Piper + offline AI models bundled)
**SHA-256:** `bd073f96b79be56499f040ba666175b26c47b2232390d356b734ca000da0824d`
