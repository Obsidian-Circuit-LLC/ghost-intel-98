# Ghost Intel 98 — v3.72.1

**Field fixes for the three new tools.**

Follow-up to v3.72.0 from GhostExodus's testing. No new features — this fixes what the first cut of the new tools got wrong.

## Fixes

**WebSDR Viewer & Ghost Social Media Manager — embedded views now paint.** Both tools embed a live web page (a WebSDR receiver; your authenticated social account) in a native view positioned over a host region. That view was being parked at zero size before the window's layout settled, so it rendered blank — intermittently for WebSDR, consistently for Social. It now waits for the host region to actually have a size before showing, and re-asserts its position after the page loads. Each tool also writes a small, secret-free `diag.log` under its data folder — visibility, bounds, and load outcomes only — so a stubborn blank view can be diagnosed from a log rather than guesswork.

**X Listening Station — profile display pics.** After a Sweep, freshly-captured accounts showed no avatars. The avatar fetch (Tor-gated, host-anchored, encrypted-at-rest, idempotent) only ran when a campaign was opened, never after a sweep — so newly-discovered handles were never fetched. It now also runs after each capture. The capture itself was always working; this only affects the pictures.

**Weather — the clearnet toggle.** The "Tor not ready" message told you to enable clearnet "in Settings," but the toggle is the **`clearnet` checkbox in the Weather window's header** (there is no Settings entry). Both messages now point at the checkbox.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.72.1**.

> **Still owed:** these embedded-view and live-egress paths are best confirmed on your own device — the automated suite can't stand in for a real WebSDR stream, a live social session, or an X capture over Tor. If WebSDR or Ghost Social still shows a blank view after this, send the `diag.log` from the tool's data folder and it can be pinned exactly.
