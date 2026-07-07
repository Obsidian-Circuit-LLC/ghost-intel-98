# Ghost Intel 98 — v3.35.0

**GeoINT field fixes: the Host Info panel tells the truth, settings stay in sync across windows, and host resolution gains an opt-in clearnet mode.**

From GhostExodus's live casework on Tor-blocked cameras.

## What's fixed

- **"Host resolution is turned off" no longer lies.** The Host Info panel used to key its "turned off" message off a settings copy that could go stale, so it could claim resolution was off *right after it resolved a host*. The message now reflects what the lookup actually did — if resolution ran, you see the result; you only see "turned off" when it genuinely didn't run. The standalone Host Info panel also now resolves as soon as it opens (previously the auto-run could silently miss on first open).

- **Settings stay in sync across the app.** Changing a setting in one place is now reflected everywhere without a restart — the main process pushes settings changes to the UI, and per-panel writes (GeoINT tiles, the news feed list) send only the field they changed instead of re-sending a whole block that could overwrite something else from a stale copy.

## What's new

- **Opt-in clearnet host resolution (off by default).** Host resolution — the DoH/PTR/RDAP recon that identifies a camera's IP and registration — has always been **Tor-only** by design. You can now enable a **clearnet** mode in **Settings → GeoINT** for cases where you accept the exposure. It is:
  - **off by default**, and stays Tor-only unless you turn it on;
  - **acknowledged once** — the first time you enable it you get an explicit warning that clearnet resolution exposes your real IP to Cloudflare/rdap.org and reveals which hosts you're investigating;
  - **visibly marked** — whenever a lookup used clearnet, the panel shows "Resolved over CLEARNET — real IP exposed."

  *(Note: to watch a camera whose **stream** is Tor-blocked, that's the separate "Route CCTV over Tor" toggle — turn it **off** and the video loads over clearnet. Stream routing and host resolution are independent.)*

- **Clearer labels** in Settings → GeoINT so the two Tor toggles — camera **streams** vs camera **hosts** — are no longer easy to confuse.

## Under the hood

- The clearnet resolve path is selected by a single extracted, unit-tested binding (`hostResolveViaFrom` → `fetchJsonForVia`); with the toggle off, no code path reaches a clearnet socket — a mutation test now fails the build if that guard is ever inverted. The clearnet fetch carries the same 30-second timeout as the Tor path.
- **3,191 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs. No new egress when the clearnet toggle is off; encrypt-at-rest unchanged.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.35.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `cf7c33889638c23a5c307fab447ff2902a8d4bd2b2a6bff36ba9a6698c08fce3`
- **Size:** 958,381,312 bytes (~958 MB).

*Everything from v3.34.0 and earlier carries forward.*
