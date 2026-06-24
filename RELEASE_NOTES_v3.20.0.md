# Ghost Intel 98 — v3.20.0

**Searchlight, refined — plus GeoINT and EyeSpy quality-of-life.** A dogfooding feedback batch
from live OSINT casework: the full Maigret corpus, offline favicons, custom sites, a real settings
toggle, and a dozen smaller fixes — built subagent-driven over 14 TDD tasks with an adversarial
whole-branch review.

## Searchlight

- **Full 3,166-site Maigret database.** Replaces the curated subset. Engine-backed sites (≈1,000 of
  them) inherit their check logic from a shared `engines` map — these are now **resolved at parse
  time**, so they probe correctly instead of returning systematic false "not found." Engine URL
  placeholders (`{urlMain}`/`{urlSubpath}`) are substituted before probing; any entry that would
  still carry an unresolved placeholder is dropped rather than probing a bogus host. Anti-Tor sites
  that declare `ignore403` no longer mis-read a 403 as *blocked*.
- **Bundled favicons.** Each result can show the site's favicon from a **committed offline snapshot**
  (~1,270 icons, raster only). **Zero runtime egress** — no live fetch, no third-party favicon proxy.
  Regenerate anytime with `node scripts/fetch-favicons.mjs`. Sites without an icon fall back to the
  generated avatar.
- **Add custom sites.** A one-field **Add custom site** form (name + URL) persists to the encrypted
  store; **Export sites.json** dumps a plaintext copy on demand. URLs are validated at the boundary
  (https + `{username}`).
- **Settings → Searchlight pane.** The master network opt-in (the toggle you couldn't find before)
  now lives in Settings, alongside Tor/clearnet concurrency. Still **off by default** — Searchlight
  sends nothing until you enable it.
- **Start-menu entry + intro card.** Searchlight is now in the Start menu and shows a first-run
  "Understood — Proceed" intro.
- **Whiteboard removed.** The Whiteboard tab and its `react-rnd` dependency are gone. (Existing case
  files remain readable — the import path still sanitises any embedded board data.)
- **Readability.** Dropdowns (Graph "Add Entity", scope chips) and the Reports export buttons are
  restyled midnight-purple with light text for the dark canvas.

## GeoINT

- **Timeline opens on "all events."** The timeline scrubber now defaults to its latest position, so
  every located event is visible on open. The scrubber and play controls still work — scrub back
  whenever you want.
- **Right-click → Add to Monitor.** Pin any situation-feed item to **Monitored Situations**
  regardless of corroboration count. Pins persist across sessions through the vault.

## EyeSpy

- **Coordinate entry on Add-Stream.** Enter **latitude / longitude** when adding a camera (validated
  as a pair: lat ∈ [-90, 90], lon ∈ [-180, 180]). Coordinates flow into the master CCTV tree on
  **Export CCTV…**.

## Security / architecture

- No new runtime network egress: favicons are bundled, the renderer makes no network calls, and the
  sweep stays main-process only. No telemetry, no phone-home.
- New persisted state (custom sites, pinned monitors) is **encrypted at rest** through the vault.
- Untrusted input is coerced at the trust boundary: custom-site URLs, coordinate pairs, the persisted
  monitor list, and even the bundled favicon snapshot (raster-only; `data:image/svg` rejected
  defensively).
- One dependency **removed** (`react-rnd`); none added.

## Quality

- Built subagent-driven over **14 TDD tasks**, each spec+quality reviewed, then a parallel
  **adversarial whole-branch review** (four independent reviewers → refute-by-default verification).
  It caught a real engine-placeholder probe bug (≈1,000 sites) and a scope-creep file, both fixed
  before merge. **1,336 automated tests** green; typecheck + build clean.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.20.0.exe -Algorithm SHA256
```

SHA-256: `ba7e27e60dfc2dc3c048bc72b626919e55ba1b4a559011c49fcb7c0f9fe417fe`
Size: 880916572 bytes (840.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior **Ghost Intel 98** build in place.

## Notes

- Everything from v3.19.0 carries forward.
