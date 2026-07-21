# Ghost Intel 98 — v3.62.0

**Bookmarks: every column is droppable now, and the dragged card un-dims when you drop it.**

Two follow-ups now that dragging categories between columns works (v3.61.0).

## 1. Only ~3 columns accepted drops

The drag grid showed the full width's worth of columns, but only about three of them actually accepted a drop. The column count was measured from the **board** element, which — in the real Electron window — kept coming back under-sized (it read about three columns even on a wide window), so only three columns were rendered and droppable while the grid (a full-width background) showed the real width.

Fixed by measuring the module's own draggable **window** instead of the board. The window carries an explicit width from the window manager, so it's a reliable measurement — the column count now matches the actual width, the grid, and the usable area. You can drop into any column across the board.

## 2. The dragged card stayed dimmed until you reopened the window

While dragging, the picked-up category dims. After dropping, it stayed dimmed until the Bookmarks window was closed and reopened. The dim was driven off an internal ref, and changing a ref doesn't trigger a re-render — so it never cleared on its own. It's now tracked as React state, so releasing the drag re-renders and the card returns to full opacity immediately.

## Verification

- **3,712 automated tests** passing (1 skipped); `pnpm typecheck` clean.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.62.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `bd353329d17e80c61c43b4e35425a2fec4a4a8b672303e3e6af3adc37ca6f380`
- **Size:** 963,139,901 bytes (~963 MB).

*Everything from v3.61.0 and earlier carries forward.*
