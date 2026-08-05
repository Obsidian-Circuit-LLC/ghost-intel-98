# Ghost Intel 98 — v3.67.0

**QUIET AMETHYST — a full-dark selectable theme, and the theme system behind it.**

Ghost Intel 98 gets its first alternate skin. **QUIET AMETHYST** is a near-black, midnight-purple "quiet compartment" look you select in Settings — but under it ships the reusable theme system that makes future skins a palette file, not a rebuild. Classic stays the default and is byte-for-byte unchanged; nothing about your current look changes unless you choose the new theme.

## What's new

- **QUIET AMETHYST theme.** A near-black midnight-purple skin with a single glowing accent. **Settings → Theme → QUIET AMETHYST.** The whole shell recolours — desktop, taskbar, windows, title bars, controls, the Date/Time clock — with no seams.
- **A real theme system.** Every colour now flows through a token map with a theme registry, so a future skin is one palette + one registry entry instead of a codebase-wide edit.
- **Honest by construction.** Status colours (error / success / warning) and the honesty stamps ("⚠ unverified", "AI · unverified", "extracted · unverified") are a **LOCKED tier**: theme-aware so they stay legible on any skin, but no skin can recolour or hide them. A warning stays a warning; an unverified source stays visibly unverified.

## Honesty & privacy (this is an offline OSINT tool)

- The theme is pure presentation — **no new network access, no telemetry, no new dependency.** Your theme choice is a local UI preference.
- The locked status/honesty tier means a cosmetic change can never quietly suppress a safety signal — the same guarantee the intel-honesty work has held throughout.

## Under the hood

- A `data-ga98-theme` attribute switch (mirroring the existing intensity control), a token map + registry (`themes.ts`), a **dark 98.css control override sheet** (the bundled 98.css hardcodes its colours with no variables, so the theme reskins it explicitly), and per-module conflict resolution across the entire app.
- A **rendered-contrast oracle** — a test that renders every module under amethyst in real headless Chromium and fails CI on any low-contrast text or light-island. It is an honest regression guard: it prints its own caveat and discloses exactly what it can't machine-audit (data-populated states), which a separate **populated-state QA pass** covered — clean across all audited modules.
- Classic theme output is parity-gated (byte-for-byte identical to before).

## Verification

- **3,968 automated tests** passing (1 skipped); `pnpm typecheck` clean. Rendered-contrast oracle green; populated-state QA clean.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.67.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `590f7e4db765452dfc3a40f8c8efe029749dd027ce12c3d180799031a080c02f`
- **Size:** 963,144,862 bytes (~963 MB).

*Everything from v3.66.0 and earlier carries forward.*
