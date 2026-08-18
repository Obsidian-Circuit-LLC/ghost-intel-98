# Ghost Intel 98 — v3.72.2

**Two field fixes from GhostExodus's v3.72.1 testing.**

No new features. Both of these are the *second* half of problems v3.72.1 only half-fixed — in each case the first fix was correct as far as it went, and the remaining symptom had a different cause underneath it.

## Fixes

**WebSDR Viewer — the waterfall stays on screen.** The receiver would play audio with a blank display; hitting Reload brought the waterfall up, and about a second later it disappeared again. Your video pinned it exactly: the embedded receiver renders *perfectly* — full waterfall, band controls, S-meter — and is then retracted 1.07 seconds later. The cause was a layout collapse. The receiver column is a five-row grid, but the "Tor is enabled for this session" banner is only rendered when it applies; with it absent every later element shifted up one row, so the **receiver host region became zero pixels tall** and the one-line status footer inherited its space. A zero-height host made the overlay guard conclude the region had not laid out yet, and after a fixed retry budget it hid the native view — which is why Reload brought it back for exactly as long as that budget lasted. Each element is now pinned to its own row, so the layout no longer depends on which optional banners happen to be showing. This also restores the "choose a feed from the menu" placeholder, which was invisible for the same reason. Two smaller correctness fixes ride along: the overlay is positioned before the receiver page is navigated, and a page that was navigated before the view had a size is reloaded once when it first appears at a real size.

**Ghost Social Media Manager — the Compose page scrolls.** Selecting which profiles to publish through left you stuck: the account wall and anything below the fold were unreachable and the page would not scroll at all. The page's scroll rule was correct, but the window shell it sits in was sizing its row to the *content* rather than to the window, so the page silently grew instead of scrolling and the excess was clipped away with no scrollbar to show for it. The shell is now pinned to the window, so Compose scrolls normally at any number of accounts. Because the wall genuinely scrolls now, each live account tile is also clipped to the scrolling area — a tile scrolled half-way up used to be able to paint its live view over the toolbar, since those tiles are native windows layered over the app rather than part of the page.

## Notes for testing

Both fixes are verified against measured behaviour rather than code review: the Compose layout and the WebSDR receiver host are asserted on real geometry in a headless browser at each module's actual window size, with the Tor banner both present and absent. A first attempt at the WebSDR bug in this release targeted the wrong mechanism; your video refuted it, and the fix above is the one the measurements support. That said, neither substitutes for your device — a real receiver stream and a real authenticated social session are the only way to confirm the live paths.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.2.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.72.2**.

> **If the WebSDR waterfall still disappears after this:** send the `diag.log` from the WebSDR data folder. The decisive line is a `present recv visible=false … why=host-zero-bounds` — if that still appears, the host region is still collapsing somewhere this fix did not reach, and the `why=` value names the reason outright.
