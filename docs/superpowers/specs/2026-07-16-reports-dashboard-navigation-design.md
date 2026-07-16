# Reports Dashboard + Navigation + Status — Design Spec (Sub-project A)

**Date:** 2026-07-16
**Module:** Ghost Intel 98 → Reports (`report` builtin)
**Origin:** GhostExodus wants the Reports module to grow into a full "Chain of Custody Report and Template Generator" (two mockups + a long ChatGPT prompt). That vision is **decomposed into three sub-projects**; this spec is **Sub-project A** only. B (Templates) and C (editor word-processor feel) get their own spec → plan → build cycles later.

## Goal

Turn the bare "Select a report or create a new one" placeholder into a proper Win98 application shell: a menu bar + toolbar, a left Navigation tree, and a landing **Dashboard** with a Recent Reports table — plus a `status` (draft/completed/archived) and `author` on each report so the table and nav filters mean something. The v3.48.0 three-column editor is unchanged; it becomes the "editor view" the shell swaps to when a report is open.

## Decomposition (context, not scope)

- **A (this spec):** Dashboard + Navigation tree + menu bar/toolbar/status bar shell + report status/author.
- **B (later):** Templates system — save-as-template, template library, preview-before-select, create-from-template, the Templates nav branch + the right-hand Template Preview panel.
- **C (later):** editor "word-processor feel" — a live text area you type into directly below To/From; richer report metadata.

Items that belong to B are **present but disabled** in A (legitimate Win98 greyed state — never a dead button): the Templates menu, the "Use Template" tile/quick-action, and the right Template Preview panel are deferred to B.

## Load-bearing decisions (already made with the operator)

- **Full Win98 chrome** — the Reports window gets its own menu bar + toolbar (mockup-faithful), even though other modules don't. Reuse the existing shared classes (`ga98-toolbar`, `ga98-statusbar`, `ga98-context-menu`, `ga98-dialog-veil`); build a reports-specific menu bar following the existing module patterns (DialTerm/NetExplorer chrome).
- **Keep the encrypted secure-fs JSON store** — NOT SQLite (SQLite would be a plaintext store and weaken encrypt-at-rest). Status/author ride the existing `saveReport` path.
- **Keep the block model + DOMPurify sanitizer** — NOT ProseMirror/TipTap. The editor view is v3.48.0 unchanged.
- **No true multi-page pagination** — deferred (exported PDF/DOCX already paginate).

## Global Constraints (verbatim, bind every task)

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=… -c user.email=… commit --no-verify`. NEVER emit `Co-Authored-By` / `Signed-off-by` / `Claude-Session` trailers.
- **Explicit-path `git add` only.** Never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- **No new npm dependencies. No new bundled resources.**
- **No new network egress / no telemetry.** Encrypt-at-rest preserved.
- **`settings.reports.author` MUST be added to the `mergeSettings` deep-merge list + a test** — a new fixed-shape nested settings field that isn't deep-merged is silently dropped by upgraders (the v3.24.0 "username search dead" dataloss). This is a required, explicit step.
- **No dead buttons.** Deferred-to-B controls use the disabled/greyed state, not no-op handlers.
- **Windows-only target.**

## Data Model (`src/shared/reports-types.ts`)

- `Report` gains:
  - `status: 'draft' | 'completed' | 'archived'` — new reports start `'draft'`.
  - `author: string` — set at creation from `settings.reports.author` (falling back to `'Investigator'` if unset); editable via Document Properties.
- `updatedAt` (exists) → "Last Modified"; `title` (exists) → "Name".
- Migration: a legacy report without `status`/`author` is normalized by the validator to `status: 'draft'`, `author: 'Investigator'` (the validator already defaults missing fields; add these two).

## Settings (`src/shared/types.ts` + the settings merge)

- `AppSettings` gains `reports?: { author?: string }`.
- **Add `reports` to the `mergeSettings` deep-merge list** (the merge lives with `json-fs.ts` / `register.ts`) and write a test that an upgrade preserves a nested `reports.author`. This is the landmine guard, not optional.

## Validator (`src/main/security/validate.ts`)

- `ensureReport` bounds `status` to the three-value enum (default `'draft'` on anything else) and `author` to a bounded string (reuse `reportStr` with a sensible max, default `'Investigator'` when empty).

## Store / IPC

- No new store functions strictly required — status/author persist through `saveReport`. Renderer-side helpers do the rest:
  - **Duplicate** = clone the report with a fresh `id` + `createdAt`/`updatedAt` + `" (copy)"` title, then `saveReport`.
  - **Rename** = edit `title`, `saveReport`.
  - **Archive / Mark Completed** = set `status`, `saveReport`.
  - **Delete** = existing `removeReport`.
- Settings read/write uses the existing settings IPC.

## Components

- **`ReportsModule.tsx`** becomes the shell: menu bar + toolbar + status bar + a left panel (nav tree + Quick Actions) + a center that swaps between **Dashboard** and **Editor** views. Owns the selected-nav-node and selected-report state.
- **`ReportsMenuBar.tsx`** (new) — File / Edit / View / Reports / Templates(greyed) / Tools / Help. Each enabled item dispatches a real action; editor-only items (Edit ops, Insert) are enabled only when a report is open; Templates items are disabled.
- **`ReportsToolbar.tsx`** (new) — New Report, Open, Save, Save As, Export PDF, Export DOCX, Print, Options, Help (square icons, depress on click; grouped with separators). Use the `ga98-toolbar` class.
- **`ReportsNavTree.tsx`** (new) — Explorer-style collapsible tree: Dashboard · Reports [All / Recent / Drafts / Archived] · Contacts [My Contacts]. Active node = dark-blue-on-white. Below it, a **Quick Actions** panel (Start New Report, Manage Contacts; "Use Template" disabled → B). Selecting a node sets the dashboard filter.
- **`ReportsDashboard.tsx`** (new) — the welcome header ("Welcome to Ghost Intel 98 / Chain of Custody Report and Template Generator") over the dark intelligence-workstation background; action tiles (Create New Report, Manage Contacts, Export/Print; "Use Template" tile → B); and `<RecentReportsTable>`.
- **`RecentReportsTable.tsx`** (new) — columns Name / Status / Last Modified / Created By; single-click select, double-click open, column sort, a `ga98-context-menu` right-click menu (Open / Rename / Duplicate / Export / Archive / Delete), and "Open Selected Report" + "View All Reports" buttons. Status text colours: Draft = yellow, Completed = green, Archived = grey (Template = cyan reserved for B).
- **`reports-filters.ts`** (new, pure) — `filterReports(list, node)` (All/Recent/Drafts/Archived) and `sortReports(list, column, dir)`; unit-tested without a DOM.
- **Editor view** = existing `ReportEditor` (unchanged).

## Interaction / behaviour

- Opening Reports with no report selected → **Dashboard** view. Opening/creating a report → **Editor** view. "View All Reports" / a nav click → Dashboard filtered.
- New reports created from the Dashboard "Create New Report" tile / File→New / toolbar → seeded `status:'draft'`, `author` from settings, then opened in the editor.
- A **status control** in the editor header (a small `<select>`: Draft / Completed / Archived) sets `report.status`.
- The dashboard reflects live state (a report saved/edited updates its row's Last Modified/Status).

## CSS (`src/renderer/styles/theme.css`)

Extend the `ga98-report` block with the shell: `.ga98-report-appshell` (menu bar / toolbar / body / status bar rows), menu-bar + dropdown styling, nav-tree + quick-actions, the dashboard (welcome header, tiles, table), and the recent-reports table (status colours restated on classes; 98.css dark-table cascade honoured). Reuse `ga98-toolbar` / `ga98-statusbar` / `ga98-context-menu` where they fit.

## Testing & Verification

- **Pure:** `filterReports` (each nav node) + `sortReports` (each column, both directions); duplicate/rename/archive report transforms.
- **Validator/settings:** `ensureReport` status-enum clamp + author default; **the mergeSettings test** that a nested `reports.author` survives an upgrade.
- **Components:** menu/toolbar action dispatch; RecentReportsTable select/sort/double-click/context-menu; nav-tree selection changes the filter; status-colour classes present.
- **CSS:** computed-style guard for the new shell classes + table status colours (98.css cascade).
- **Visual gate:** SSR-render the real `ReportsModule` shell (Dashboard view, with a few sample reports across statuses) + real `theme.css` → headless-Chrome screenshot, confirming the menu bar / toolbar / nav tree / dashboard table render styled (not an unstyled fallback) — the same gate that verified v3.48.0.
- **Packaged:** asar grep for the new shell classes (mind the un-minified `x: y` spacing).

## Out of Scope (explicit — deferred to B/C)

- Templates: save-as-template, template library, preview-before-select, create-from-template, the Templates nav branch, the right Template Preview panel, the "Use Template" tile/action. (Menu/tile present but greyed.)
- Editor word-processor-feel changes and richer metadata (case number / reference / classification / signature block) — Sub-project C.
- True multi-page pagination, headers/footers/page-numbers in the editor.
- SQLite, ProseMirror/TipTap, any new dependency.
