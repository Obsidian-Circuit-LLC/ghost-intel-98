# Ghost Intel 98 — v3.61.0

**Bookmarks: dropping a category now actually moves it to another column.**

After v3.60.0 the categories still "didn't budge" — dragging one reordered it within the first column but never moved it to a different column.

## Root cause

Re-examining the screen recording, the faint drag grid spanned the **full board width**, which means the board was full width and the column count was fine (the earlier suspect). The real bug was in the **drop**: every "drag-over" updates a piece of React state that records where the category will land, but the drop handler could fire *before* that state had flushed — so it committed the category to the *previous* target (or none). The card appeared to snap back.

## The fix

The drop target is now mirrored into a ref, and the drop commits from the ref, so it always uses the **latest** position the pointer was over. Dropping a category into another column now sticks.

As insurance, the board's width measurement was also hardened: the board is forced to fill its module (so it can't accidentally size to a single column's width), and if it ever measures narrower than one card it falls back to the module *window's* own width (not the whole app viewport).

If your board is still stacked in one column from an earlier build: drag the categories out (it works now), or click **Auto-arrange** to spread them instantly.

## Verification

- **3,712 automated tests** passing (1 skipped); `pnpm typecheck` clean. Layout re-verified headless.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.61.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `aef864422bee1749a853e530e358bd65e029fc2305a42975eb7a729f075b0ae0`
- **Size:** 963,139,453 bytes (~963 MB).

*Everything from v3.60.0 and earlier carries forward.*
