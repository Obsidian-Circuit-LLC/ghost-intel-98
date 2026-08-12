# Ghost Intel 98 — v3.70.2

**X Listening Station re-skin — the intelligence-workstation look, in both light and dark.**

This carries forward everything from v3.70.0/v3.70.1 (the X Listening Station Enterprise rebuild — Tor-default capture with an acked clearnet opt-in, 11 campaign-managed tabs, localized evidence media; the module banners; the custom boot screen; and the installer force-replace fix) and re-skins the X Listening Station itself.

## What changed

The X Listening Station now reads as a proper SOCMINT console instead of a flat grey form, and it follows whichever theme you're running:

- **Accent stat tiles** — the dashboard figures (Captured Posts, Targets Observed, Network Identities, …) sit on accent-topped tiles with large tabular numbers and soft card depth.
- **Accent primary actions** — New Campaign / Open Session and other primary buttons are accent-filled.
- **Active-tab underline + section ticks** — the current tab carries an accent underline; panel titles get an accent tick and uppercase treatment.
- **Card depth + accent-left hover** — post/account/source rows lift on hover with an accent edge.

Because the re-skin is built entirely on the app's shared theme tokens, it renders two ways with no extra work:

- **A — Default (classic):** Win98 selection-blue accents.
- **B — Dark (QUIET AMETHYST):** violet accents on the dark console.

Nothing about the engine, capture path, Tor posture, or data handling changed — this is a visual-only pass over the existing module.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.70.2.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installing over an older build replaces it in place (v3.70.1 installer hardening).

- **SHA-256:** `8d2dd8f717dc6b66c5eca005d5de5dd06d9c7dbe427eb871575e6c767c089e36`
- **Size:** 944,298,974 bytes (~901 MB).

Confirm **Settings ▸ About** reads **3.70.2**.
