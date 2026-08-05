# QUIET AMETHYST — Theme Map + Registry Design

**Date:** 2026-08-05
**Status:** Approved for planning
**Origin:** GhostExodus field request (an "NSA-style" midnight-purple skin), relayed by operator. Reframed during brainstorming from "a theme" into "a reusable theme map + registry, with QUIET AMETHYST as the first palette built against it."

## Goal

Ship a complete, tokenised **theme map** for Ghost Intel 98 plus a small **theme registry**, and deliver **QUIET AMETHYST** — a near-black midnight-purple ("Noir + glow") skin — as the first selectable non-default theme. The classic look is preserved byte-for-byte. Future skins become a palette file + one registry entry, not a code change.

## Non-goals (YAGNI)

- User-authored custom-pack **UI**, or pack **import/export**. The registry is *extensible in code*; a user-facing pack builder is out of scope.
- **Non-colour** skinning (fonts, textures, chrome geometry). CRT texture is already handled by the separate `data-ga98-intensity` axis and is untouched here.
- The "NSA-class architecture" aspiration from the source conversation (leaked-capability emulation, Qubes/Whonix lineage). That is a separate workstream, if ever; this is a skin.
- No new network egress, no telemetry, no new dependency. A theme is pure CSS + one settings field.

## Background / current state (verified 2026-08-04)

- Theming lives in a single file, `src/renderer/styles/theme.css`. A `:root` block (lines ~3–11) defines exactly **7 tokens**: `--ga98-desktop-bg #008080`, `--ga98-grey #c0c0c0`, `--ga98-shadow-dark #808080`, `--ga98-shadow-light #ffffff`, `--ga98-shadow-deep #000000`, `--ga98-taskbar-height 32px`, `--ga98-blue #000080`.
- A **working attribute-driven switch already exists**: `data-ga98-intensity` (`'lite'|'classic'|'maximum'`) is stamped on `<html>` in `App.tsx` (~lines 73–74) from `settings.themeIntensity`, and consumed by `:root[data-ga98-intensity='…']` selectors. It only toggles CRT texture, not colour — but it is the exact mechanism this design copies.
- There is **no colour-theme switcher and no second palette** today. The look is effectively one hardcoded theme.
- The palette is **only partially centralised**: many components consume `var(--ga98-*)`, but hardcoded colours exist outside the tokens — e.g. the clock titlebar gradient `#000080→#1084d0` (theme.css ~1306), the clock analog face/hand `#000`/`#c00000` (`ClockWidget.tsx` ~61–67), an inline `#c0c0c0` flyout (`AccessMenu.tsx` ~147), the Solitaire felt `#047a32` (theme.css ~1334). A token override alone will **not** recolour these.
- Settings type: `AppSettings` in `src/shared/types.ts` (~line 353); defaults `defaultSettings` (~line 673); deep-merge upgrader `mergeSettings` in `src/main/storage/json-fs.ts` (~line 945). Every nested field must be explicitly handled in `mergeSettings` or upgrading users lose it (documented regression history there). (`themeName` is a top-level scalar, carried by the base spread like `themeIntensity` — but an upgrade test still guards it.)

### Amendment 2026-08-05 — 98.css is hardcoded; scope = **full dark, everything**

Grounding revealed a load-bearing fact the original draft under-weighted: the Win98 control layer comes from the bundled **98.css library, which hardcodes every colour and uses no CSS variables** — `.window{background:silver}`, `.window-body{margin:8px}` (inherits window silver), `.title-bar{background:linear-gradient(90deg,navy,#1084d0)}`, `body{color:#222}`, `input/select/textarea/table/ul.tree-view/pre{background:#fff}`, `select:focus{background:navy;color:#fff}`, `a{color:#00f}`, `table>tbody>tr.highlighted{background:navy}`, scrollbars `#dfdfdf`, `.sunken-panel/table{background:#fff}`, `menu[role=tablist]` silver, `.status-bar-field`, `.field-border`, `.progress-indicator-bar{background:navy}`. Our `--ga98-*` tokens sit *on top* of 98.css; its controls do **not** read them. The app additionally hardcodes **~61 light backgrounds** and **~118 near-black text colours** across modules, plus 6 module-specific CSS files.

Operator decision (2026-08-05): **full dark, everything — no seams anywhere.** Concretely this means the theme is delivered as:

1. **Token layer** (§ below) — base `:root` expansion + `[data-ga98-theme='amethyst']` palette override + fixed tier. Includes routing the global `body/#root` text `#000 → var(--ga98-text)`.
2. **A dark 98.css override sheet** — under `[data-ga98-theme='amethyst']`, restyle every common 98.css control: `.window`, `.window-body`, `.title-bar`(+`.inactive`,`-text`), `button`, `input[type=*]`/`textarea`/`select`(+`:focus`/`option`), `table`(+`thead`,`.highlighted`), `ul.tree-view`(+`a`,`details>summary`), `.sunken-panel`, `pre`, `a`, `.status-bar-field`, `menu[role=tablist]`, `fieldset`/`legend`, `.field-border`(+`-disabled`), `.progress-indicator`(+`-bar`), `::-webkit-scrollbar*`. Bounded, enumerable (~20 selectors); lives in `98.overrides.css`. This is what makes every *standard* window go properly dark and match the locked mock.
3. **App-chrome stragglers** — shell components + theme.css chrome selectors (clock gradient/analog, AccessMenu flyout, taskbar, Start menu, LockScreen, Toaster, Icon chrome) rewired to tokens.
4. **Per-module conflict resolution** — every module's hardcoded light-bg / dark-text conflict resolved so no module is a light island or shows invisible text, **including games and the 6 module CSS files**. Content-intrinsic colours (map severity scales, chart series, flag colours, game-piece colours) are allow-listed as theme-invariant, not recoloured.

**Audit-first.** Because the conflict set is large and partly discovered, the build's **first task produces a classification artifact** (`docs/superpowers/plans/quiet-amethyst-audit.md`): every hardcoded colour in themed scope → `{file:line, current, category ∈ palette|semantic|honesty|content-intrinsic, target token | allow-list}`. Foundation and module tasks consume it; the no-straggler test enforces it.

**Staged passes are acceptable** (operator accepts "several ultracode passes"): the first workflow delivers audit + foundation (token layer + dark 98.css sheet + app chrome) so the shell and all standard windows are dark; subsequent workflows resolve the module long tail and finalise the guards. "Done" = every reachable surface renders dark with legible text and no light island.

**Testing widens accordingly:** the no-straggler guard and contrast gate cover **all themed modules** (with the allow-list), and a **98.css-control smoke** asserts representative controls (`.window`, `input`, `select`, `table`, `ul.tree-view`, scrollbar thumb) render dark under `data-ga98-theme='amethyst'`.

## Architecture

### Mechanism

Mirror `data-ga98-intensity` exactly:

1. New field `AppSettings.themeName: string` (default `'classic'`), sibling to `themeIntensity`.
2. `App.tsx` stamps `document.documentElement.dataset.ga98Theme = <resolved theme>` alongside the existing intensity line.
3. `theme.css` base `:root { … }` defines **every** token (both tiers) with **classic** values. A `:root[data-ga98-theme='amethyst'] { … }` block redefines **only the skinnable palette tokens**.
4. The attribute flip is renderer-side and instant; persistence rides the normal settings write. No IPC round-trip is needed to apply a theme.

### Theme registry (the "map" future skins slot into)

New file `src/renderer/styles/themes.ts`:

```ts
export interface ThemeDef { id: string; label: string; description: string; }

export const THEMES: ThemeDef[] = [
  { id: 'classic',  label: 'Classic',        description: 'The original teal-and-grey Ghost Intel 98 look.' },
  { id: 'amethyst', label: 'QUIET AMETHYST', description: 'Near-black midnight-purple compartment skin with a single glowing accent.' },
];

export const DEFAULT_THEME = 'classic';
export function isKnownTheme(id: string): boolean { return THEMES.some((t) => t.id === id); }
```

The Settings dropdown renders `THEMES`; a future skin is one array entry + one CSS override block. `label` is the display string (`QUIET AMETHYST`); `id` is the slug (`amethyst`) used in the `data-ga98-theme` attribute.

### Naming

The compartment codename **QUIET AMETHYST** is the single name for the theme, the map, and the shipped label. It is a **fabricated** intelligence-compartment codeword (deliberately not a real programme, and not `OBSIDIAN`, which the desktop seal already uses as a threat-actor label). Slug: `amethyst`. Attribute: `data-ga98-theme='amethyst'`. Classic stays `classic`.

## The complete map (this is the bulk of the work)

The operator chose the **complete, no-seams** option: every palette colour routes through a token, so no chrome stays teal/navy/grey when the skin is applied.

### Colour classification

Audit every `#hex` / `rgb()` in `theme.css` and inline renderer JSX. Classify each occurrence:

- **Palette** — chrome, surfaces, bevels, titlebars, accents, primary/secondary text. → promote to a `var(--ga98-*)` token; skinnable.
- **Semantic** — error/critical, success/found, warning, info. → a **fixed** token (see two-tier contract); theme-invariant.
- **Honesty** — the unverified / AI-unverified / extracted-unverified stamp colouring. → a **fixed** token; theme-invariant. This is charter-critical: a skin must never be able to blend these into the background.
- **Content-intrinsic** — flag colours, chart data-series, GeoINT map data-layer colours, Solitaire felt, national/brand colours. → **left hardcoded on purpose**; recorded in an allow-list. These carry meaning that is not the app's chrome and must not follow the skin.

### New tokens the dark theme forces into existence

Today, primary text is implicit `#000`, there is no unified accent, and titlebar gradients are hardcoded. A dark theme cannot exist without routing these. We **add** tokens (keeping all existing token names to minimise churn and protect classic parity):

- `--ga98-text` — primary text (was implicit black).
- `--ga98-text-dim` — secondary/dimmed text.
- `--ga98-accent` — focus/highlight/glow accent.
- `--ga98-titlebar-to` — active-titlebar gradient end (classic value = the existing `#1084d0`).
- `--ga98-titlebar-text` — text on the titlebar.

Existing tokens are **kept by name** and simply gain an amethyst override. `--ga98-blue` serves as the titlebar gradient *start*.

### Locked token map

**Skinnable palette tier** — classic values equal today's exact colours (parity), amethyst values are the operator-approved locked palette:

| Token | Role | Classic | QUIET AMETHYST |
|---|---|---|---|
| `--ga98-desktop-bg` | desktop background | `#008080` | `#0c0a12` |
| `--ga98-grey` | window / control face | `#c0c0c0` | `#1a1822` |
| `--ga98-shadow-light` | raised bevel highlight | `#ffffff` | `#2c2938` |
| `--ga98-shadow-dark` | lowered bevel shadow | `#808080` | `#0e0c14` |
| `--ga98-shadow-deep` | deepest outline | `#000000` | `#000000` |
| `--ga98-blue` | active titlebar (gradient start) | `#000080` | `#241a33` |
| `--ga98-titlebar-to` *(new)* | active titlebar gradient end | `#1084d0` | `#3a2a52` |
| `--ga98-titlebar-text` *(new)* | titlebar text | `#ffffff` | `#efeaff` |
| `--ga98-accent` *(new)* | focus / highlight / glow | `#1084d0` | `#9d6bff` |
| `--ga98-text` *(new)* | primary text | `#000000` | `#cfc9dd` |
| `--ga98-text-dim` *(new)* | secondary text | `#3a3a3a` | `#8a86a0` |

The amethyst accent `#9d6bff` is used with a soft glow (`box-shadow`) on the single focus affordance, as approved; the glow is amethyst-only styling, not a token.

**Fixed tier** — semantic + honesty. **One value each, identical in every theme.** Chosen to be legible on both the light classic surface (`#c0c0c0`) and the near-black amethyst surface (`#1a1822`); final values pass the contrast gate (see Testing). Proposed starting values:

| Token | Role | Value (all themes) |
|---|---|---|
| `--ga98-status-error` | error / critical | `#e5484d` |
| `--ga98-status-success` | success / found | `#30a46c` |
| `--ga98-status-warning` | warning | `#d98a00` |
| `--ga98-status-info` | info / note | `#4c8dff` |
| `--ga98-unverified` | honesty stamp (unverified / AI-unverified / extracted-unverified) | `#d98a00` |

These tokens are defined **only** in base `:root` and appear in **no** theme override block, so no skin can reach them.

**Accepted consequence, stated plainly:** because the fixed tier is genuinely single-value, wherever classic today uses an *ad-hoc* status colour that differs from the unified value, classic's status colour shifts slightly to the unified one. This is deliberate (status colours becoming consistent is an improvement) and is the **only** place classic changes. The parity guarantee (below) therefore covers **chrome/palette surfaces**, not semantic colours.

## Data flow

1. User picks a theme in the Settings module dropdown (co-located with the existing theme-intensity control).
2. The choice writes `AppSettings.themeName` through the normal settings patch path (encrypted store, same as `themeIntensity`).
3. `App.tsx` reads it, resolves through the registry, and stamps `data-ga98-theme` on `<html>`.
4. CSS applies the override block instantly.

## Error handling / edge cases

- **Unknown / removed theme:** `App.tsx` resolves `isKnownTheme(settings?.themeName) ? settings.themeName : DEFAULT_THEME`. A stale or removed slug falls back to `classic` — never a broken half-theme.
- **Upgrade safety:** `themeName: 'classic'` is added to `defaultSettings` **and** to `mergeSettings` (mandatory — omission drops the field for upgrading users and is the documented regression class in `json-fs.ts`).
- **Classic parity:** every new token's classic value equals the exact colour it replaces, so existing users see zero chrome change.

## Testing

Headless computed-style harness (playwright-core, Chrome, `--no-sandbox`), and it **must** mount within the `.ga98-window-shell > .window > .window-body` ancestor chain — the known cascade trap where `.window{height:100%}` only manifests with the shell present.

1. **Classic parity** — with `data-ga98-theme` unset/`classic`: assert each base `:root` token resolves to its documented classic value, and spot-check a mounted window's computed `background`/`color`/border colours equal pre-change values.
2. **Two-tier enforcement** — parse `theme.css`: assert the `[data-ga98-theme='amethyst']` block contains **none** of the fixed-tier token names, and assert base `:root` **does** define all of them. This is the guard that keeps skins from semantic collapse.
3. **QUIET AMETHYST smoke** — under `data-ga98-theme='amethyst'`: assert desktop-bg / surface / titlebar / accent / text resolve to the locked amethyst values, and assert a fixed token (e.g. `--ga98-status-error`) resolves **identically** under both themes.
4. **Contrast gate** — WCAG contrast ratios computed under **both** themes, pairing each token with the surface it is actually rendered on: `--ga98-text`↔`--ga98-grey` (body text on the control face) ≥ 4.5:1; `--ga98-titlebar-text`↔ the titlebar gradient ≥ 4.5:1; `--ga98-accent`↔`--ga98-grey` ≥ 3:1; each status/honesty token ↔ `--ga98-grey` (classic `#c0c0c0` and amethyst `#1a1822`) ≥ 3:1. Fails the build if a value regresses legibility. (Desktop-icon label colour sits on `--ga98-desktop-bg` and is treated as its own case in the audit, not folded into this gate.)
5. **No-straggler guard** — after the audit, a test scans themed source (`theme.css` themed selectors + the specific inline-JSX files rewired) for raw palette hex; fails on any hex that is neither a token *definition* nor in the explicit `THEME_COLOR_ALLOWLIST` (the content-intrinsic colours). Prevents future code from silently reintroducing a hardcoded palette colour.

## Files touched (exact paths pinned in the plan)

- `src/shared/types.ts` — `AppSettings.themeName` + `defaultSettings`.
- `src/main/storage/json-fs.ts` — `mergeSettings` line for `themeName`.
- `src/renderer/styles/themes.ts` — **new** registry.
- `src/renderer/App.tsx` — resolve + stamp `data-ga98-theme`, registry fallback.
- `src/renderer/styles/theme.css` — expand base `:root` tokens (add new ones), rewire palette stragglers to tokens, add the `[data-ga98-theme='amethyst']` override block, define the fixed tier once.
- Inline-JSX stragglers found in the audit — at minimum `src/renderer/shell/ClockWidget.tsx` (analog face/hand → `--ga98-shadow-deep`/`--ga98-accent`) and `src/renderer/shell/AccessMenu.tsx` (inline flyout bg → `--ga98-grey`); the full list comes from the audit.
- The Settings module component that hosts the theme-intensity control — add the theme dropdown (path pinned in the plan).
- Tests per the Testing section.

## Success criteria

- User can select **QUIET AMETHYST** in Settings; the entire visible shell — desktop, taskbar, windows, titlebars, the Date/Time clock — recolours with no teal/navy/grey seams, and one glowing amethyst accent.
- Classic is visually unchanged (parity test green).
- No skin can recolour or hide a status/honesty colour (two-tier enforcement test green).
- Adding a *second* future skin requires only: one `THEMES` entry + one `[data-ga98-theme='…']` block. No other code change.
- No new dependency, egress, or telemetry.
