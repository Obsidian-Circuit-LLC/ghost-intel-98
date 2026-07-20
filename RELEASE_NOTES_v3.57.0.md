# Ghost Intel 98 — v3.57.0

**Bookmarks masonry layout, Calendar event colours + notes, and a de-flaked test.**

## Bookmarks — masonry board layout

GhostExodus reported that category cards left "a ton of empty space." They were right, and I want to be straight about it: the earlier v3.55 Bookmarks change was **data-only and produced no visible change** — the layout waste was never addressed. This fixes it for real.

The board used a CSS multi-column layout that reserved a **full-height column per card** (or, on a wide window, crammed everything into two columns on the left and left the right two-thirds empty). It's now a **masonry**: each category is packed into whichever column is currently the shortest, so cards sit right under each other with no reserved dead space. Cards stay sized to their links, and the column count tracks the live window width. Verified headless at multiple widths (5 columns full-width at 1280px; 3 columns with cards stacking/packing at 820px).

## Calendar — per-event colours and notes

Both from GhostExodus's request, on the reminders you create in the calendar:

- **Colour:** right-click an event → pick from an 8-colour Win98 palette (or **×** to clear). The chip is tinted, with a black-or-white label auto-chosen for contrast.
- **Note:** right-click → **Add note… / Edit note… / Delete note**. A **📝** badge marks events that carry a note, and the note shows **automatically on hover** (native tooltip).

New `Reminder.color` / `Reminder.note` fields persist through storage (they ride the existing whole-object upsert — nothing drops them).

## Also

- The Bookmarks **Add-link dialog** is defensively pinned compact (`height: fit-content`, capped at 85vh) so no stray cascade can stretch it.
- **De-flaked** the `PrekeyStore` per-contact-churn test: it minted 1000 real ML-KEM-1024 prekeys (each rewriting the whole growing file — O(n²)), pushing it past its 60s budget under CI load. It now churns 256 and asserts **all** churned contacts survive (a stronger no-global-eviction guard), running in a few seconds.

## Verification

- **3,697 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.57.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `1f606199ce816595cfb96fd00f96dc105000daa1d12bcbd6f2a7198558f6441d`
- **Size:** 963,132,902 bytes (~963 MB).

*Everything from v3.56.0 and earlier carries forward.*
