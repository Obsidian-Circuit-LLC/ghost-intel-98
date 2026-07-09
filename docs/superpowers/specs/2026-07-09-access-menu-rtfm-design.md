# Access Menu Categorization + RTFM Guides — Design

**Date:** 2026-07-09
**Origin:** GhostExodus feedback — restructure the flat Access (start) menu into categorized submenus with icons, move RTFM just below Settings, and add the Searchlight + SOCMINT guides to the RTFM module.
**Repo:** `/dcs98` (core). **Folds into the held v3.38.0** (Ghost Ledger batch, merged local + unpushed) — ships together.

## Operator decisions (2026-07-09)

- **Fixed categories only** — hardcode the category flyouts; drop the Settings-driven user-editable Access-menu shortcuts. Desktop icons are separate and unaffected.
- **Placement:** Q + Search under Programs; Mail + Chat (beta) + Bookmarks under Network; Games + OSINT Toolkit keep their existing flyouts; Desktop Clock stays a footer toggle.

## Part A — Access menu → categorized flyouts

Replace the `settings.shortcuts`-driven flat list in `AccessMenu.tsx` with **fixed category flyouts**, reusing the existing `Games ▸` / `OSINT Toolkit ▸` flyout pattern (hover-or-click to fan out; a DOM-descendant flyout so moving onto it doesn't close it; bottom-anchored, grows upward). Final structure (every current module has a home):

| Menu entry | Contents |
|---|---|
| **📁 Programs ▸** | My Cases · Notepad 98 · Briefcase · Markets · Search · Q |
| **🎨 Creativity ▸** | Notepad 98 · Journal Jots |
| **🎵 Music ▸** | Jukebox |
| **🖧 Network ▸** | DialTerm · Mail · Chat (beta) · Bookmarks |
| **📅 Organization ▸** | Invoices · Calendar · Reminders · Alarm |
| **🎮 Games ▸** | (unchanged flyout: Solitaire, Mine Detector, Chess, Ghost Space Ball) |
| **🧰 OSINT Toolkit ▸** | (unchanged flyout: grouped by subcategory) |
| ── separator ── | |
| ⏰ **Desktop Clock** | toggle (✓), unchanged |
| ⚙ **Settings…** | opens Settings |
| ❔ **RTFM** | opens the help module — **now directly below Settings** |
| ⏻ **Shut Down…** | confirm-quit, unchanged |

- **Categories are hardcoded** as `{ label, glyph, items: { module: ModuleKey; label: string }[] }`, mirroring the existing `GAMES` constant. Each renders as a flyout via the existing flyout markup/behavior (a small reusable `<CategoryFlyout>` extracted from the Games flyout so the five categories don't duplicate it).
- **The `settings.shortcuts`-driven `items` list is removed** from the menu (fixed-categories decision). The `shortcuts` setting itself stays in the schema (not deleted — avoids a migration/consumer break) but no longer drives the Access menu; if a Settings UI edits it, that surface is out of scope here (a follow-up can hide it). Desktop icons (Desktop.tsx) are untouched.
- **Icons** are the category glyphs above (emoji, consistent with the existing rail glyphs; the mockup's folder/palette/note/network/calendar/gear/?/power set).
- **RTFM** moves from the (removed) flat list to a fixed footer entry immediately below `Settings…`, opening `{ module: 'help', title: 'RTFM' }`.

## Part B — RTFM: Searchlight + SOCMINT guide sections

Extend `HelpModule.tsx`'s `SectionKey` + `SECTIONS` with two sections, keeping the existing four (Manual, OpChildSafety, Hacktivist Ethos, OSINT):

- **📡 Searchlight** — renders `docs/guides/searchlight-learning.md`.
- **💬 SOCMINT** — renders `docs/guides/socmint-tutorial.md`.

Rail becomes: Manual · OpChildSafety · Hacktivist Ethos · OSINT · **Searchlight · SOCMINT**.

- The guides are **structured markdown** (headings, steps, bold), so these two sections render via the app's existing **`MarkdownView`** (`src/renderer/modules/ai-assistant/MarkdownView.tsx`) rather than the flat-paragraph style the current sections use. The other four sections are unchanged.
- **Bundling:** the two guide markdowns are made available to the renderer as string constants in a new `src/renderer/modules/help/guides.ts` (the content copied from `docs/guides/*.md`), matching how the existing RTFM text lives inline in `HelpModule.tsx`. (No new bundler config / `?raw` needed.) The `docs/guides/*.md` files remain the canonical source.
- OSINT section stays exactly as-is ("in progress / forthcoming").

## Architecture / components

- `AccessMenu.tsx` — replace the flat-list render with a `CATEGORIES` constant + a `<CategoryFlyout label glyph items>` component (extracted from the current Games flyout, which is refactored to use it too, so all flyouts share one implementation). Games/OSINT flyouts keep their bespoke content (OSINT is grouped) but can share the flyout *shell*. Footer (Desktop Clock / Settings / RTFM / Shut Down) unchanged except RTFM added below Settings.
- `HelpModule.tsx` — add two `SECTIONS` entries; the render switch shows `<MarkdownView markdown={SEARCHLIGHT_GUIDE} />` / `<MarkdownView markdown={SOCMINT_GUIDE} />` for the new keys.
- `guides.ts` — `export const SEARCHLIGHT_GUIDE = '...'; export const SOCMINT_GUIDE = '...';`.

## Charter

- **No egress, no new dependency.** The guides are bundled local markdown; `MarkdownView` already exists (and already sanitizes/escapes untrusted markdown per prior security reviews — the guide content is trusted-local anyway). The menu change is pure renderer.
- **No telemetry.** Unchanged.

## Error handling

- A category with a module that isn't registered → that item is skipped (defensive `getModule` check), never a crash.
- Empty guide constant → the section renders an empty MarkdownView (no crash).
- Removing the flat-shortcut render must not break the `shortcuts` setting read elsewhere (leave the field intact).

## Testing

- `AccessMenu` — renders the five category flyouts + Games + OSINT + the footer (Desktop Clock, Settings, RTFM below Settings, Shut Down); opening a category and clicking an item calls `open({ module })`; RTFM opens `{ module: 'help' }`; the flat `settings.shortcuts` list no longer renders.
- `CategoryFlyout` — fans out on hover/click; lists its items; clicking one fires the open callback + closes the menu.
- `HelpModule` — the rail lists all six sections incl. Searchlight + SOCMINT; selecting each renders its markdown (assert a known heading from each guide appears); OSINT unchanged.
- `guides.ts` — the two constants are non-empty and contain their guide's title.

## Out of scope (YAGNI)

- A Settings UI to hide/remove the now-vestigial shortcuts editor (follow-up).
- Restyling desktop icons (separate surface, untouched).
- Nested sub-submenus (OSINT stays one-hop; categories are one-hop flyouts).
- Editing/refining the guide *content* (GhostExodus: "refine later") — this ships the guides as-authored.
- Reordering tools within categories beyond the specified order.
