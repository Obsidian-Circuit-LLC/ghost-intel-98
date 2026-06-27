# Ghost Intel 98 — v3.22.1

## Searchlight readability fix (cosmetic)

The **Sweep results** table and the **Reports → Report Preview** table now render on the intended **midnight-purple** surface with readable text, instead of appearing white.

### Root cause

A CSS cascade bug, not a wrong color value. The bundled `98.css` styles every native `<table>` with `background: #fff`. The Searchlight table was designed for a dark surface (light/cyan/green text), and the earlier fix darkened the table's *container* — but the white `<table>` sat on top of that container and hid it, so both tables read as white regardless of the container color. Because the Reports preview reuses the same table classes, it was white for the same reason.

### The fix

- Restate the midnight-purple surface on the table's **class** selectors (`.sl-sweep-table` → `#1e0f33`, header cells `.sl-sweep-th` → `#15092a`). A class selector wins over `98.css`'s element/universal `table { … }` rules on specificity, independent of stylesheet load order, and neutralizes the silver header bevel.
- Lift the two text colors that were only legible against the accidental white background — the not-found URL (was dark navy) and the muted site name — so they read with good contrast on the dark surface.

Verified by loading the actual `98.css` + `searchlight.css` cascade in a headless browser: the computed `.sl-sweep-table` background is `rgb(30, 15, 51)` (midnight purple), not white.

## Scope

Cosmetic only. No behavior, dependency, IPC, or security-surface change. All SOCMINT collectors, gating, fail-closed transport, and supply-chain pins from v3.22.0 are unchanged.

## Quality

- **1,972 tests passing**, TypeScript strict, clean `pnpm build`.

## Install

Windows NSIS installer attached.
SHA-256: `5408a2a69722d92b550e980192ea2311ef3b919d6e2bf50761d4536aade4b5cc`
Size: 887,577,101 bytes (846.5 MB)
