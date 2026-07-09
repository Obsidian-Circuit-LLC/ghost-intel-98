# Ghost Ledger 98 — Midnight-Purple Theme + Animated Header Fill — Design

**Date:** 2026-07-10
**Origin:** GhostExodus + operator feedback on shipped v3.38.0 Ghost Ledger 98 — fill the empty header space, re-theme the module midnight purple, and reorder the Access menu.
**Repo:** `/dcs98` (core). Target release **v3.39.0**.

## Operator decisions (2026-07-10)

- **Keep the name Ghost Ledger 98** (re-themed purple; no rename).
- **Full-module midnight-purple theme** (module content only — the window title bar stays standard Win98 grey for v1).
- **Hybrid header fill:** pixel-cube dissolve (extending the banner's own motif) + a subtle matrix code-rain layer.
- **Recolor the existing banner** to purple (done — hue-shifted, see Part B).
- **Menu:** OSINT Toolkit moves above Games (below Organization).
- **Readability is required:** every text/background pair in the purple theme meets **WCAG AA (≥4.5:1 contrast)**, verified.

## Charter

- **No new dependency, no egress.** The fill is a pure `<canvas>` animation. The recolor is a build-time image asset. Theme is scoped CSS.
- **Exports untouched.** The PDF (`renderInvoiceHtml` + offscreen print) and `.docx` (`renderInvoiceDocx`) render paths carry **no banner and no theme color** — they ship exactly as-is (clean white/black professional invoices). The theme must not reach them; a test asserts the export HTML/OOXML contains no theme color.
- **Scoped to Ghost Ledger only.** Every other app module stays Win98 grey — the purple CSS is scoped under one module-root class, not global.

## Part A — Menu reorder

In `AccessMenu.tsx`, render the **OSINT Toolkit** flyout *before* the **Games** flyout (order: …Organization → OSINT Toolkit → Games → Desktop Clock/Settings/RTFM/Shut Down). Both remain their existing bespoke/`CategoryFlyout` renders — only the order changes.

## Part B — Purple banner + animated header fill

- **Banner asset:** overwrite `src/renderer/assets/ghost-ledger-banner.png` with the midnight-purple recolor (the shipped blue banner hue-shifted +38° in HSV: the steel "GHOST" stays neutral, "LEDGER 98" + the glow/eyes/frame go violet, background deepens to purple-black). Same dimensions (1983×793). The build script that produced it is recorded in the plan for reproducibility.
- **Header layout** (`InvoicesModule` top): a flex header row — the banner `<img>` **left-pinned** at a fixed height (~150px, `height` fixed, width auto, no distortion), and a **`<LedgerFill>` canvas** filling the remaining width (`flex:1`).
- **`LedgerFill` (`src/renderer/modules/invoices/LedgerFill.tsx`):** an animated `<canvas>` sized to its container (ResizeObserver). Renders the **hybrid**:
  - **Cube-dissolve layer:** a field of isometric/pixel cubes in the banner's violet palette, denser near the banner seam and thinning/"dissolving" rightward — a continuation of the banner's own dissolving-cube motif.
  - **Matrix-rain layer:** sparse, low-opacity falling glyph columns in violet/lavender drifting *behind* the cubes.
  - **Seam blend:** a left-edge horizontal gradient from the banner's dark-purple edge color into the canvas, so there is no hard line — the fill flows out of the banner.
  - **"NO CHEATING!"** — a low-opacity (~0.12–0.18) terminal/monospace watermark drawn on the canvas, rotated 90° up the right edge (or a top-right corner), clearly visible but not overbearing.
  - **Perf/motion:** `requestAnimationFrame` throttled to ~24fps; **paused when the module window is off-screen** (IntersectionObserver) and when unmounted; on `prefers-reduced-motion: reduce`, render **one static frame** (cubes + watermark, no animation). No egress, no timers leaking.

## Part C — Full-module midnight-purple theme (scoped)

- The module root gets a theme class (e.g. `ga98-ledger-theme`); **all purple CSS is scoped under it** so nothing else in the app changes.
- **Palette:** surfaces midnight purple (`#1a0f2e` base, `#241539` panels, `#12081f` insets); text light lavender-white (`#ece6f7`); accents/borders violet (`#7c4dff` / `#5a3aa8`); a violet focus ring.
- **Themed surfaces:** the form background, the From/To fieldsets, the meta row (number/date/currency/rate/tax), the **line-item table** (header + rows — restate backgrounds on the class selector to beat the bundled 98.css white-`<table>` element rule, per the known cascade note), the totals block, notes, signer, the logo/signature preview boxes, and the buttons (Save / Export PDF / Export DOCX / New invoice / Add line / Remove).
- **Inputs are readable first:** `<input>`/`<select>`/`<textarea>` use a dark inset purple fill (`#12081f`) with **light text (`#ece6f7`)** and a violet focus outline — every pair verified **≥4.5:1**. (Rationale: data-entry legibility is the priority the operator named; light-on-deep-purple at high contrast is crisp, and the focus ring makes the active field obvious.)
- **Title bar / window frame:** unchanged (shell chrome, shared) — standard Win98 grey. (Out of scope for v1.)

## Architecture / components

- `LedgerFill.tsx` — the canvas fill (self-contained; props: none required, reads `prefers-reduced-motion`).
- `InvoicesModule.tsx` — header layout (banner + `<LedgerFill>`); add the `ga98-ledger-theme` class to the module root.
- `theme.css` — the scoped `.ga98-ledger-theme …` block (palette applied to the module's existing `ga98-invoice-*` / `ga98-ledger-*` selectors); `.ga98-ledger-banner` becomes left-pinned; `.ga98-ledger-fill` canvas sizing.
- `src/renderer/assets/ghost-ledger-banner.png` — replaced with the purple recolor.

## Testing

- **Contrast:** a unit test over the theme's defined color pairs (surface/text, input-fill/input-text, button/label) asserts each computes **≥4.5:1** (a small `contrastRatio(fg,bg)` helper on the palette constants — the palette lives in a `ledger-theme.ts` constants module so it's testable without the DOM).
- **`LedgerFill`:** renders a canvas; on `prefers-reduced-motion` it draws once and starts no RAF loop (mock `matchMedia` + spy `requestAnimationFrame`); cleans up RAF + observers on unmount.
- **Menu order:** `AccessMenu` renders OSINT Toolkit before Games.
- **Exports unchanged:** `renderInvoiceHtml`/`renderInvoiceDocx` output contains none of the theme color hex values (the theme cannot leak into an export).
- **Scope:** the purple CSS selectors are all prefixed with the module-root class (no bare/global restyle).

## Out of scope (YAGNI)

- Purple window title bar / frame (shell-level per-window accent — a later call).
- Theming any other module.
- A user-toggle between blue and purple (one shipped theme).
- Changing the exports' appearance (they stay clean by requirement).
- A new banner render from scratch (the recolor is the asset).
