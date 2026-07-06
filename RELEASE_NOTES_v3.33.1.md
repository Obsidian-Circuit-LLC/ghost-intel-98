# Ghost Intel 98 — v3.33.1

**Hotfix: the Jukebox window now fits the compact deck.**

## What's fixed

- **The Jukebox opens as a compact strip again, not a tall half-empty window.** v3.33.0 made the Jukebox *content* default to the compact deck, but the window frame stayed at its full expanded height — so the deck sat at the top of a large empty gray panel. The window now resizes to match the mode: a short deck-sized frame when compact, growing to full height when you expand the library/stations with the caret (and shrinking back when you collapse). A fresh Jukebox opens deck-sized.

## Under the hood

- The media module now receives its window id and drives its own frame height through the window store (compact 270px / expanded 840px, in `jukebox-window.ts`); the registration default is the compact height so a new window opens correctly sized.
- **3,095 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs. No new network egress; no behavior change beyond window sizing.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.33.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `5197c093739b4e4762e93632fdf160309d26f163f771c30b41c60182535881bf`
- **Size:** 958,366,081 bytes (~958 MB).

*Everything from v3.33.0 (My Documents Open/Export, the large-icons grid, the Q clearnet toggle) and earlier carries forward.*
