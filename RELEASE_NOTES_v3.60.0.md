# Ghost Intel 98 — v3.60.0

**Bookmarks: fix categories piling into one column, plus Auto-arrange and a drag grid.**

A regression from v3.59.0: after updating, every category stacked in the leftmost column, the rest of the board rejected drops (the "no-drop" cursor), and you couldn't drag a card out to spread them.

## Root cause

The board decides **how many columns** to show from its measured width. The one-time migration that gives each existing category an explicit column ran on the very first render — **before that width had been measured** — so it saw a column count of 1 and assigned *everything* to column 0. Only one column then rendered, which is why the rest of the board wasn't a drop target (no-drop cursor), and because your board already saved that state, every category was stuck at column 0. The measurement was also fragile: a board that hadn't been laid out yet read a width of 0.

## The fix

- The column count now starts at a distinct **"not yet measured"** state (not 1, which is a real narrow-window value), is measured in a layout effect **plus** an animation-frame retry **plus** a resize observer, and only accepts a real (non-zero) width. The migration is gated so it **cannot run until the width is known** — so it spreads categories across the actual number of columns.
- **Auto-arrange** button (in the toolbar) re-spreads the categories evenly across the columns — a one-click fix for a board a broken build already saved into one column, and a handy "tidy" in general.
- **Drop anywhere:** a board-level drop fallback means dropping a category in the empty space beyond the columns lands it in the last column instead of showing the no-drop cursor.
- **Drag grid (GhostExodus's idea):** while you drag a category, the board shows a faint column grid so the otherwise-invisible empty columns read as snap targets.

If you're already stuck with everything in one column after v3.59.0: update, then click **Auto-arrange** once (or just drag the categories where you want them — dropping now works everywhere).

## Verification

- **3,712 automated tests** passing (1 skipped); `pnpm typecheck` clean. Grid + droppable empty columns verified headless.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.60.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `305f92a8c6ce1e72a6935025ac70d5ac2030e2fd2144817b8427485459d3ac7f`
- **Size:** 963,133,855 bytes (~963 MB).

*Everything from v3.59.0 and earlier carries forward.*
