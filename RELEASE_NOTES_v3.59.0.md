# Ghost Intel 98 — v3.59.0

**Bookmarks: drag categories anywhere you want, start.me-style.**

The v3.57 masonry auto-arranged category cards by height — so a new (short) category dropped into whatever column was currently shortest, which read as "everything goes downward," and dragging a category didn't give you real control (the height algorithm bounced it elsewhere). GhostExodus pointed at start.me as the model: just simple drag-and-drop.

## What's new

- **Drag a category's title bar and drop it wherever you want.** Drop it above another card — a **navy line shows exactly where it will land** — or into a column's empty space to append it to the bottom. It stays exactly where you put it. The card you're dragging dims, and the target column highlights.
- **Each category remembers its column.** New categories join the emptiest column until you move them.
- **Still responsive.** The number of columns tracks the window width. Narrow the window and a card in a now-hidden column folds into the last visible one; widen it again and it springs back to where you placed it (columns are stored as absolute indices and clamped on render).
- **Existing boards just work.** A board saved before this release is migrated once to explicit columns on first load, so nothing jumps around — it looks the same, and from then on placement is yours.

## Under the hood

- Placement is a set of pure functions in `layout.ts` (group-into-columns, migrate, new-category column, drop-placement), covered by 10 unit tests. The new `column` field round-trips through the board validator (clamped to a sane ceiling; garbage dropped).
- The cards use `class="…window"`, so — exactly like the v3.58 modal-dialog fix — the rule that sizes a *module's* window to fill its shell (`.ga98-window-shell .window { height:100% }`) would have stretched the cards to full height now that columns stretch to form drop zones. Re-anchored the cards to content height, and this time verified headless **with the window shell in place** (the ancestor my earlier harnesses had been missing).

## Verification

- **3,711 automated tests** passing (1 skipped); `pnpm typecheck` clean. Layout verified headless (content-height cards, full-height drop-zone columns, drop indicator).
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.59.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `1b19a1a2e0864034223f1d1d28f9c67d59d3f134bc4fb6926ca75bdaf8c7a167`
- **Size:** 963,133,822 bytes (~963 MB).

*Everything from v3.58.0 and earlier carries forward.*
