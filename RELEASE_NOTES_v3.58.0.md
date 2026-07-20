# Ghost Intel 98 — v3.58.0

**Fix: modal dialogs no longer render full-height.**

GhostExodus reported the Jukebox **Add station** dialog opening as a full-height overlay — huge input boxes and tall stretched OK/Cancel bars — instead of a compact centered box. The Bookmarks **Add link** dialog had the same problem.

## Root cause (found by reproduction)

A modal dialog is rendered *inside* its module, and every module lives inside a draggable window (`.ga98-window-shell`). Two rules size a **module's own** window to fill that shell:

```
.ga98-window-shell .window      { height: 100%; }
.ga98-window-shell .window-body { flex: 1; }
```

But a dialog also uses `class="window"` and is a **DOM descendant** of the shell, so those rules matched the *dialog* too. A modal's veil is a full-viewport fixed layer, so `height: 100%` blew the dialog up to the whole viewport and `flex: 1` stretched its body — the giant inputs and tall buttons.

It only reproduced once the dialog was rendered **inside a window shell** (619px tall in a 613px viewport — an exact match to the screenshot). My earlier debugging harness rendered the dialog on a bare page without the shell, which is why it kept showing compact and I wrongly guessed "stale build." Apologies for that misdiagnosis — this is the real cause.

## The fix

Re-anchor dialogs to their content height:

```
.ga98-dialog-veil .window { height: fit-content; max-height: 90vh; }
```

placed **after** the window-shell rules so it wins on source order (equal specificity). It overrides only `height` — **not** the body's flex — so the intentionally-tall **scrollable** dialogs (mail compose, chat share picker, net-explorer) keep their `flex: 1; overflow: auto` and scroll as before. Both cases verified headless: a compact dialog collapses to ~127px; a 1400px-content dialog stays capped at 90vh and scrolls inside. This fixes **every** modal dialog in the app at once, and a cascade-regression test guards it.

## Verification

- **3,700 automated tests** passing (1 skipped), including a new dialog-cascade guard; `pnpm typecheck` clean across both project configs.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.58.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `281bea6edcafdd0d04582a5163deb5863487dd70b9e0a066335bfb3af5686d69`
- **Size:** 963,134,618 bytes (~963 MB).

*Everything from v3.57.0 and earlier carries forward.*
