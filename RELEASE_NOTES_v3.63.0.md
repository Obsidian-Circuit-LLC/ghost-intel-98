# Ghost Intel 98 — v3.63.0

**Bookmarks: the dragged category un-dims now, even when it changes column.**

v3.62.0 was meant to fix the stuck "shadow" on a dragged category — and it did, but only for a card dropped back into the *same* column. A card dropped into a **different** column stayed dimmed until you reopened the window.

## Why

While you drag a category it dims. The dim was cleared when the drag "ended." But when a card is dropped into a different column, the board re-renders and the card is **re-created in its new column's DOM** — which destroys the original dragged element *before* its "drag ended" event can fire. So for a moved card, the handler that clears the dim never ran, and it stayed shadowed.

## The fix

The dim is now cleared on the **drop** event, which fires *before* the card is re-created. So a category dropped into any column returns to full opacity immediately. (The "drag ended" path still clears it for the case where you drop into empty space and nothing moves.)

## Verification

- **3,712 automated tests** passing (1 skipped); `pnpm typecheck` clean.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.63.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `b720c9fef2c0590125a41cbbf250202b82e4a1a4009c0a5e31593d7abe8c029d`
- **Size:** 963,140,147 bytes (~963 MB).

*Everything from v3.62.0 and earlier carries forward.*
