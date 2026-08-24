# Ghost Intel 98 — v3.72.8

**The right-click copy you asked for, plus three fixes from your 2026-08-18 video.**

## New

**Case Manager — right-click to copy Web Links and Entities.** Right-click any web link for *Copy URL* or *Copy title + URL*, or right-click the **Web links** heading for *Copy all links* in one go. Entities work the same way: right-click one to copy it, or use *Copy all entities* to take the whole list. Everything copies as plain text laid out for pasting straight into a report — a link with no separate title just copies as the URL rather than repeating itself, and an entity only carries its aliases and notes when it actually has them.

## Fixes

**Quiet Amethyst — the drop-down menus are readable again.** This was not a font problem, which is why it resisted being read as one. The little arrow on the right of a drop-down was being **tiled across the entire control**, and the menu text was rendering underneath a row of arrows. The theme paints its own light arrow so the stock black one is not invisible on a dark field — but several panels style their own inputs in a way that quietly erases where that arrow is meant to sit, so the theme's arrow was drawn from the left edge and repeated all the way across. It is now pinned to the right edge and drawn once, in the Active Campaign picker, Ghost Social, SOCMINT, Searchlight and the case-detail pickers alike. Long entries no longer run underneath the arrow either. Classic theme is untouched.

**WebSDR Viewer — the receiver stays inside its own window when you resize.** You had it exactly right: perfect until it was resized. The receiver is not part of the page — it is a separate native view layered on top of the app — so nothing about the window boundary constrains it, and it was being told to occupy the *full* size of the region that holds it. While that region fits inside the window the two agree and it looks correct; shrink the window so the region no longer fits and the receiver keeps painting its whole rectangle straight across whatever else is on screen. It is now trimmed to the part that is genuinely inside its window, and hidden outright when none of it is.

**Nothing disappears quietly any more.** When you came back to the app and things had "all disappeared", the app was not telling you why — and it should have been. The station loads eleven things at once (live feed, entity index, follower network, notes, run log and the rest), and it was loading them as a single all-or-nothing batch: if any **one** of them could not be read, the other ten were thrown away too and every panel showed empty with no message. A locked vault was enough to do it. Each one now loads on its own — a problem with one costs you that one panel, not the whole station — and whatever failed is named on screen. If the vault is locked, it says so and tells you to unlock it. It will never imply your data is gone: a file it could not read at that moment is not a file that was deleted. The display pictures follow the same rule now, instead of silently falling back to initials.

## Still open — the Follower Network

I could not reproduce this one, and I would rather say so than guess. Your video does not actually capture a failed extraction: the buttons never enter their "Extracting…" state and the status line never changes, so what it records is the cursor passing over the buttons rather than a run that failed. What the video *does* show is that your other case has a fully populated network — 63 followers, 48 following, 7 common identities, pictures and all — on this same build. So the machinery works, and something specific to **Operation Midnight** is stopping it there.

The app already keeps the answer. Open X Listening Station ▸ **CHANGE INTEL** ▸ **COLLECTION RUN LOG** while Operation Midnight is the active campaign. Every extraction attempt is recorded there, including ones that never got off the ground, each with a status and a reason it stopped. Send me those lines — the follower/following entries specifically — and that should settle it in one pass instead of another round trip.

## Notes for testing

The theme fix is measured, not eyeballed: the arrow's repeat and position are asserted in a real browser for every affected control, and confirmed against a rendered screenshot. The WebSDR fix was written against a failing test first — the receiver really was being presented at 800×560 inside a 400×300 window, and presented as visible even with the region entirely outside the window. That fix stops it painting outside its window; if resizing *also* leaves the receiver page itself laid out wrongly inside its box, that is a separate thing and I need your device to see it.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.8.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.72.8**.
