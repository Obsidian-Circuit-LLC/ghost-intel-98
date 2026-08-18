# Ghost Intel 98 — v3.72.0

**Three new tools, a fully-restored X Listening Station, and a batch of fixes — the "leave nothing out" release.**

This is a large one. Three of GhostExodus's tools join the suite as hardened, in-tree modules, the X Listening Station's behavioral fidelity is complete, and several smaller requests land alongside.

## New tools

**WebSDR Viewer** (Access ▸ OSINT ▸ Signals). A manager + embedded browser for public internet SDR *websites* (WebSDR / KiwiSDR / OpenWebRX), seeded with 851 public KiwiSDR receivers. It loads a receiver in an isolated, hardened view and drives its own frequency / mode / volume controls, with saved presets, encrypted-at-rest listening notes, and a recording archive. Egress is **clearnet by default with an opt-in Tor toggle** — a deliberate, narrow exception for public live-audio feeds (Tor usually breaks the stream), so it works out of the box. Reproduces GhostExodus's dark-green console look.

**Ghost Social Media Manager** (Access ▸ Creativity). An API-free (no OAuth) social workstation: it embeds your normal, authenticated login for each account in its own isolated session, composes once and fans a post out to many accounts, scrapes follower/following stats, and runs a scheduled queue. The password vault stays AES-256-GCM (scrypt-derived key). Egress is clearnet-default with an optional per-account Tor toggle. **Auto-posting is armed by a default-OFF master switch with a one-time confirmation and a persistent "ARMED" indicator** — the scheduler will never click Publish on a live account unless you have explicitly armed it, and that gate is enforced in the main process, not the UI. Manual publishing only *prepares* the post and stops for you to click Publish yourself.

**Weather** (Access menu). A native Win98-retro weather tool: keep a list of saved locations (search a city or enter coordinates), each showing current conditions, today's hourly, and a 7-day forecast from Open-Meteo (no API key). Metric by default with a °F/mph toggle. Egress is **Tor-default** with a clearnet toggle; every request is host-anchored to Open-Meteo. Last conditions are cached (encrypted) for an offline view. No device geolocation.

## X Listening Station — fidelity complete

The X Listening Station now functions as GhostExodus's Enterprise build intended, on the hardened core: full scroll-and-accumulate timeline capture, incremental archive depth-stepping, comment-thread and `/with_replies` capture, follower/following network operations, a live Collection Health readout, profile-change tracking, working preset match display + editor, a self-describing JSON export envelope, plus the deeper pass — global collection mutex, per-target sweep spacing, a verify-settle before re-reads, restored export evidence fields and metric columns, multi-note per post, the full live-feed / search / tab filters, per-handle network delta events (gated so a shallow scan can't false-flag accounts as gone), and more. Capture runs headless; entity display pics are restored.

## Also in this release

- **Q auto-scopes to the active case.** Q now binds to the case you're working — open a case in Cases or Searchlight and Q reasons about *that* case instead of falling back to a global, cross-case recall.
- **Right-click copy on the entity list.** Right-click any entity for Copy value (the raw email/phone/name) or Copy summary.
- **Jukebox controls no longer clip** when you drag the window shorter — the library scrolls instead.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `b06dcebed609996b3cf5eac6af03ff8d1794ee86f2df8d516f26d1ac7004ccb9`
- **Size:** `945,150,643 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.72.0**.

> **Note on the new egress tools.** WebSDR, Ghost Social, and the live paths of X Listening reach real services with your real session. Their live authentication and egress behavior (a WebSDR receiver actually streaming, a social login + a scheduled post, an X capture over Tor, a live Open-Meteo fetch) are best verified on your own device — that on-device smoke pass is the one thing the automated test suite cannot stand in for.
