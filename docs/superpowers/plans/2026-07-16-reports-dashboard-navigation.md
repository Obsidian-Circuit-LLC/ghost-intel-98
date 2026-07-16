# Reports Dashboard + Navigation + Status Implementation Plan (Sub-project A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Reports module's bare placeholder into a Win98 app shell — menu bar + toolbar + status bar, a left Navigation tree, and a landing Dashboard with a Recent Reports table — backed by `status` (draft/completed/archived) and `author` on each report. The v3.48.0 three-column editor is unchanged and becomes the "editor view" the shell swaps to.

**Architecture:** `ReportsModule` becomes the shell that owns nav-node + selected-report state and swaps a center area between a new `ReportsDashboard` and the existing `ReportEditor`. Status/author ride the existing encrypted-store `saveReport` path — no SQLite, no new IPC. Nav filters + table sort are pure functions.

**Tech Stack:** TypeScript, React, Electron, secure-fs JSON store, DOMPurify (unchanged), Vitest + jsdom, `react-dom/server` + headless Chrome for the visual gate. No new dependencies.

## Global Constraints

- **Commit identity:** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`. NEVER emit `Co-Authored-By` / `Signed-off-by` / `Claude-Session` trailers.
- **Explicit-path `git add` only.** Never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- **No new npm dependencies. No new bundled resources.** No new egress/telemetry. Encrypt-at-rest preserved.
- **`settings.reports.author` MUST be added to `mergeSettings` (json-fs.ts) + a test** — a fixed-shape nested field not deep-merged is silently dropped on upgrade (the v3.24.0 dataloss). Required step, not optional.
- **No dead buttons.** Templates menu/tile/"Use Template" quick-action + the right Template Preview panel are DEFERRED to sub-project B: render them **disabled/greyed**, never as no-op handlers.
- **Editor view is v3.48.0 unchanged** — do not restructure `ReportEditor` beyond adding the status `<select>` in Task 6.
- **Windows-only.** Tests: `pnpm exec vitest run <files>`; typecheck `pnpm exec tsc --noEmit`.

---

## File Structure

**Modified:**
- `src/shared/reports-types.ts` — `status`, `author` on `Report`.
- `src/shared/types.ts` — `AppSettings.reports?: { author?: string }` + `defaultSettings.reports`.
- `src/main/storage/json-fs.ts:944` — add `reports` to `mergeSettings` deep-merge.
- `src/main/security/validate.ts` — `ensureReport` status enum + author default.
- `src/renderer/modules/reports/ReportsModule.tsx` — becomes the shell (menu/toolbar/nav/status/view-swap); seed status+author.
- `src/renderer/modules/reports/ReportEditor.tsx` — add a status `<select>` in the header.
- `src/renderer/styles/theme.css` — the `ga98-report` shell/dashboard/nav/menubar CSS.

**Created:**
- `src/renderer/modules/reports/reports-filters.ts` — pure `filterReports` / `sortReports` / `duplicateReport`.
- `src/renderer/modules/reports/RecentReportsTable.tsx`
- `src/renderer/modules/reports/ReportsNavTree.tsx`
- `src/renderer/modules/reports/ReportsMenuBar.tsx`
- `src/renderer/modules/reports/ReportsToolbar.tsx`
- `src/renderer/modules/reports/ReportsDashboard.tsx`
- Test files per task.

---

## Task 1: Data model + settings + validator (status, author, reports.author)

**Files:**
- Modify: `src/shared/reports-types.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/storage/json-fs.ts:944-990`
- Modify: `src/main/security/validate.ts` (`ensureReport`)
- Test: `test/reports-status-settings.test.ts` (create)

**Interfaces — Produces:**
- `Report.status: 'draft' | 'completed' | 'archived'`, `Report.author: string`.
- `AppSettings.reports?: { author?: string }`.
- `ensureReport` clamps status + defaults author.

- [ ] **Step 1: Write the failing test** — `test/reports-status-settings.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ensureReport } from '../src/main/security/validate';
import { mergeSettings } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

describe('report status/author + settings.reports merge', () => {
  it('defaults status to draft and author to Investigator', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [] });
    expect(r.status).toBe('draft');
    expect(r.author).toBe('Investigator');
  });
  it('keeps a valid status + author and clamps a bad status', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [], status: 'archived', author: 'GhostExodus' });
    expect(r.status).toBe('archived');
    expect(r.author).toBe('GhostExodus');
    expect(ensureReport({ id: 'r2', to: '', blocks: [], status: 'bogus' }).status).toBe('draft');
  });
  it('mergeSettings preserves a nested reports.author across an upgrade', () => {
    // an older persisted settings block that predates reports.author
    const merged = mergeSettings(defaultSettings, { reports: { author: 'GhostExodus' } } as any);
    expect(merged.reports?.author).toBe('GhostExodus');
    // and a default merge does not drop the reports key
    expect(mergeSettings(defaultSettings, {}).reports).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run test/reports-status-settings.test.ts` → FAIL.

- [ ] **Step 3: Implement types** (`src/shared/reports-types.ts`) — add to `Report`:

```ts
export interface Report {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bannerRef?: string;
  fromContactId?: string;
  to: string;
  reportDate?: string;
  status: 'draft' | 'completed' | 'archived';
  author: string;
  blocks: ReportBlock[];
}
```

- [ ] **Step 4: Implement settings** (`src/shared/types.ts`) — add `reports?: { author?: string }` to the `AppSettings` interface, and `reports: { author: '' }` to `defaultSettings`.

- [ ] **Step 5: Implement merge** (`src/main/storage/json-fs.ts`, inside `mergeSettings`'s returned object, alongside the other deep-merged blocks):

```ts
    reports: { ...base.reports, ...(patch.reports ?? {}) },
```

- [ ] **Step 6: Implement validator** (`src/main/security/validate.ts`, in `ensureReport`, before `return out;`):

```ts
  out.status = (o['status'] === 'completed' || o['status'] === 'archived' || o['status'] === 'draft') ? o['status'] : 'draft';
  const a = reportStr(o['author'], MAX_CONTACT_FIELD);
  out.author = a.length > 0 ? a : 'Investigator';
```

(Declare `status`/`author` on the `out` object's type — they are now required on `Report`, so initialize them when `out` is built, or assign as above and widen the initial literal. Ensure `out` typechecks as a full `Report`.)

- [ ] **Step 7: Run tests + typecheck** — `pnpm exec vitest run test/reports-status-settings.test.ts` PASS; `pnpm exec tsc --noEmit` clean (fix any spot that constructs a `Report` without status/author — e.g. `seedReport` in Task 6, but the compiler will flag them now; set `status:'draft', author:'Investigator'` at each construction site as a minimal fix, refined in Task 6).

- [ ] **Step 8: Commit**

```bash
git add src/shared/reports-types.ts src/shared/types.ts src/main/storage/json-fs.ts src/main/security/validate.ts test/reports-status-settings.test.ts src/renderer/modules/reports/ReportsModule.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): report status + author + settings.reports.author (deep-merged)"
```

---

## Task 2: Pure nav filters + sort + transforms

**Files:**
- Create: `src/renderer/modules/reports/reports-filters.ts`
- Test: `test/reports-filters.test.ts` (create)

**Interfaces — Produces:**
- `type NavNode = 'dashboard' | 'all' | 'recent' | 'drafts' | 'archived'`
- `filterReports(list: Report[], node: NavNode): Report[]`
- `sortReports(list: Report[], col: 'title' | 'status' | 'updatedAt' | 'author', dir: 'asc' | 'desc'): Report[]`
- `duplicateReport(r: Report, newId: string, now: string): Report`

- [ ] **Step 1: Write the failing test** — `test/reports-filters.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { filterReports, sortReports, duplicateReport } from '../src/renderer/modules/reports/reports-filters';
import type { Report } from '../src/shared/reports-types';

const mk = (id: string, title: string, status: Report['status'], updatedAt: string): Report =>
  ({ id, title, createdAt: '2026-01-01', updatedAt, to: '', status, author: 'X', blocks: [] });
const list: Report[] = [
  mk('a', 'Alpha', 'draft', '2026-07-10'),
  mk('b', 'Bravo', 'completed', '2026-07-14'),
  mk('c', 'Charlie', 'archived', '2026-07-12')
];

describe('reports filters/sort/duplicate', () => {
  it('filters by nav node', () => {
    expect(filterReports(list, 'drafts').map((r) => r.id)).toEqual(['a']);
    expect(filterReports(list, 'archived').map((r) => r.id)).toEqual(['c']);
    expect(filterReports(list, 'all').length).toBe(3);
    // recent = newest-first by updatedAt
    expect(filterReports(list, 'recent').map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('sorts by a column both directions', () => {
    expect(sortReports(list, 'title', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReports(list, 'updatedAt', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('duplicates with a fresh id, copy title, and draft status', () => {
    const d = duplicateReport(list[1], 'newid', '2026-07-16');
    expect(d.id).toBe('newid');
    expect(d.title).toBe('Bravo (copy)');
    expect(d.status).toBe('draft');
    expect(d.updatedAt).toBe('2026-07-16');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `src/renderer/modules/reports/reports-filters.ts`:

```ts
import type { Report } from '@shared/reports-types';

export type NavNode = 'dashboard' | 'all' | 'recent' | 'drafts' | 'archived';

const byUpdatedDesc = (a: Report, b: Report): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

export function filterReports(list: Report[], node: NavNode): Report[] {
  switch (node) {
    case 'drafts': return list.filter((r) => r.status === 'draft');
    case 'archived': return list.filter((r) => r.status === 'archived');
    case 'recent': return [...list].sort(byUpdatedDesc);
    case 'all': case 'dashboard': default: return list;
  }
}

export function sortReports(list: Report[], col: 'title' | 'status' | 'updatedAt' | 'author', dir: 'asc' | 'desc'): Report[] {
  const s = [...list].sort((a, b) => {
    const av = String(a[col] ?? ''); const bv = String(b[col] ?? '');
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return dir === 'desc' ? s.reverse() : s;
}

export function duplicateReport(r: Report, newId: string, now: string): Report {
  return { ...r, id: newId, title: `${r.title} (copy)`, status: 'draft', createdAt: now, updatedAt: now };
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/reports-filters.ts test/reports-filters.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): pure nav filters, column sort, duplicate transform"
```

---

## Task 3: RecentReportsTable component

**Files:**
- Create: `src/renderer/modules/reports/RecentReportsTable.tsx`
- Test: `test/reports-recent-table.test.tsx` (create — use `react-dom/client` `createRoot`, the repo's component-test convention; there is NO `@testing-library/react`)

**Interfaces — Consumes:** `sortReports` (Task 2). **Produces:** `<RecentReportsTable reports selectedId onSelect onOpen onContext />` where `onContext(id, action)` receives `'open'|'rename'|'duplicate'|'export'|'archive'|'delete'`.

- [ ] **Step 1: Write the failing test** — `test/reports-recent-table.test.tsx` (mirror `test/reports-tableblock.test.tsx`'s createRoot harness):
  - renders a row per report with Name/Status/Last-Modified/Created-By;
  - clicking a column header re-sorts (assert row order changes);
  - single click calls `onSelect(id)`; double click calls `onOpen(id)`;
  - status cells carry a status class (`ga98-report-status-draft` etc.).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `RecentReportsTable.tsx` — a `<table className="ga98-report-recent">` with sortable headers (local sort state via `sortReports`), row selection highlight, `onDoubleClick` → open, and an `onContextMenu` that renders a `ga98-context-menu` popover (Open/Rename/Duplicate/Export/Archive/Delete) calling `onContext`. Status text uses `ga98-report-status-{draft|completed|archived}` classes. Below the table: "Open Selected Report" (disabled when no selection) + "View All Reports" buttons.

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/RecentReportsTable.tsx test/reports-recent-table.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): Recent Reports table (sort, select, open, context menu)"
```

---

## Task 4: ReportsNavTree + Quick Actions

**Files:**
- Create: `src/renderer/modules/reports/ReportsNavTree.tsx`
- Test: `test/reports-navtree.test.tsx` (create, createRoot harness)

**Interfaces — Produces:** `<ReportsNavTree active onSelect onNewReport onManageContacts />` where `onSelect(node: NavNode)`. Contains the Explorer tree (Dashboard · Reports[All/Recent/Drafts/Archived] · Contacts[My Contacts]) and a Quick Actions panel (Start New Report, Manage Contacts; a disabled "Use Template").

- [ ] **Step 1: Write the failing test** — clicking "Drafts" calls `onSelect('drafts')`; the active node has the selected class; "Use Template" quick-action is `disabled`; "Start New Report" calls `onNewReport`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — a collapsible tree (Reports/Contacts branches expand/collapse via local state), active node = `ga98-report-nav-active` (dark-blue-on-white), plus the Quick Actions buttons. "Use Template" renders `disabled` (deferred to B).

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/ReportsNavTree.tsx test/reports-navtree.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): Explorer-style navigation tree + Quick Actions (Templates disabled)"
```

---

## Task 5: ReportsMenuBar + ReportsToolbar

**Files:**
- Create: `src/renderer/modules/reports/ReportsMenuBar.tsx`
- Create: `src/renderer/modules/reports/ReportsToolbar.tsx`
- Test: `test/reports-menubar.test.tsx` (create, createRoot harness)

**Interfaces — Produces:** `<ReportsMenuBar hasOpenReport onAction />` and `<ReportsToolbar hasOpenReport onAction />`, where `onAction(id: string)` uses a shared action-id union (`'new'|'open'|'save'|'saveAs'|'exportPdf'|'exportDocx'|'print'|'close'|'contacts'|'dashboard'|'about'|...`). Editor-only actions are disabled unless `hasOpenReport`. All Templates actions are disabled.

- [ ] **Step 1: Write the failing test** — the menu bar renders File/Edit/View/Reports/Templates/Tools/Help; a File→"New Report" click calls `onAction('new')`; the Templates menu items are `disabled`; Edit→Copy is disabled when `hasOpenReport` is false; the toolbar's Export PDF button calls `onAction('exportPdf')`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — `ReportsMenuBar`: a `role="menubar"` row of top-level menus, each opening a `ga98-context-menu`-style dropdown on click (close on outside mousedown — reuse the window-mousedown pattern already in `TextBlock`). Items map to `onAction(id)`; Templates items and editor-only items get `disabled` per `hasOpenReport`. `ReportsToolbar`: a `ga98-toolbar` row of square labelled buttons (New/Open/Save/Save As/Export PDF/Export DOCX/Print/Options/Help) with separators, `onAction(id)` on click. Use the exact menu structure from the spec (File/Edit/View/Reports/Templates/Tools/Help).

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/ReportsMenuBar.tsx src/renderer/modules/reports/ReportsToolbar.tsx test/reports-menubar.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): Win98 menu bar + toolbar (Templates greyed, editor items gated)"
```

---

## Task 6: ReportsDashboard + ReportsModule shell wiring + editor status control

**Files:**
- Create: `src/renderer/modules/reports/ReportsDashboard.tsx`
- Modify: `src/renderer/modules/reports/ReportsModule.tsx` (shell composition + view swap + action dispatch + seed status/author from settings)
- Modify: `src/renderer/modules/reports/ReportEditor.tsx` (add a status `<select>` in the header)
- Test: `test/reports-shell.test.tsx` (create, createRoot harness)

**Interfaces — Consumes:** all prior tasks. **Produces:** the wired shell.

- [ ] **Step 1: Write the failing test** — `test/reports-shell.test.tsx`: mounting `ReportsModule` (with `window.api.reports.*` mocked, and `window.api.settings` mocked to return `{ reports: { author: 'GhostExodus' } }`) shows the Dashboard (welcome header + table) when no report is open; a File→New / "Create New Report" action creates a report seeded `status:'draft'` and `author:'GhostExodus'` and swaps to the editor view; the editor header has a status `<select>` whose change updates `report.status`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `ReportsDashboard.tsx`** — welcome header over the dark workspace, action tiles (Create New Report, Manage Contacts, Export/Print — a disabled "Use Template" tile), and `<RecentReportsTable>` fed the nav-filtered list.

- [ ] **Step 4: Implement the shell** (`ReportsModule.tsx`) — compose `<ReportsMenuBar>` + `<ReportsToolbar>` + a body row of `<ReportsNavTree>` (left) and the center view (Dashboard when `report === null`, else `<ReportEditor>`), + a `ga98-statusbar`. Add a central `dispatch(actionId)` that maps menu/toolbar/tile/quick-action ids to the existing handlers (`newReport`, `openReport`, export, `setShowContacts`, nav select, etc.). Load `settings.reports.author` on mount; `seedReport()` sets `status:'draft'` and `author` from it (fallback `'Investigator'`). Nav selection sets a `navNode` state that filters the dashboard list via `filterReports`.

- [ ] **Step 5: Implement the status control** (`ReportEditor.tsx`) — a small `<select aria-label="Report status">` (Draft/Completed/Archived) in the header bound to `report.status`, calling `patch({ status })`.

- [ ] **Step 6: Run tests + typecheck** — `pnpm exec vitest run test/reports-shell.test.tsx` PASS; `pnpm exec tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/reports/ReportsDashboard.tsx src/renderer/modules/reports/ReportsModule.tsx src/renderer/modules/reports/ReportEditor.tsx test/reports-shell.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): dashboard view + shell wiring (menu/toolbar/nav/status swap) + editor status control"
```

---

## Task 7: theme.css shell/dashboard/nav/menubar styling + visual gate

**Files:**
- Modify: `src/renderer/styles/theme.css` (extend the `ga98-report` block)
- Test: `test/reports-shell-css.test.ts` (create — jsdom computed-style guard, mirroring `test/reports-css.test.ts`)

- [ ] **Step 1: Write the failing test** — assert (via injecting `theme.css` into jsdom + `getComputedStyle`): `.ga98-report-appshell` lays out as a column (menu/toolbar/body/status rows); `.ga98-report-nav-active` has the dark-blue selection background; `.ga98-report-status-draft` / `-completed` / `-archived` resolve to distinct (non-default) colours; `.ga98-report-recent td` background is not the 98.css native-table white (class-restated).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — append shell CSS to the `ga98-report` block: `.ga98-report-appshell` (flex column), menu-bar + dropdown, nav-tree (`.ga98-report-nav`, `.ga98-report-nav-active`), Quick Actions, dashboard (`.ga98-report-dashboard` welcome header over the dark workspace, `.ga98-report-tile` tiles), the recent table (`.ga98-report-recent` with class-restated backgrounds + `.ga98-report-status-draft{color:#c8c000}`/`-completed{color:#3fbf5f}`/`-archived{color:#8a8a8a}`), and the status bar. Reuse `ga98-toolbar` / `ga98-statusbar` / `ga98-context-menu` where they fit. Honour the 98.css table cascade (restate `td`/`th` background on the class).

- [ ] **Step 4: Run tests** — computed-style guard PASS. Then the **visual gate** (controller, below).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/theme.css test/reports-shell-css.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): app-shell / dashboard / nav-tree / recent-table styling"
```

---

## Final Verification (controller, after all tasks)

1. `pnpm test` (full suite) → all green; `pnpm exec tsc --noEmit` → clean.
2. **Visual gate** — SSR-render the real `ReportsModule` shell in the Dashboard state (mock `window.api.reports.list` returning a few reports across draft/completed/archived, and `window.api.settings` with `reports.author`) via `react-dom/server` → headless-Chrome screenshot; confirm the menu bar / toolbar / nav tree / dashboard table render styled (status colours visible), not an unstyled fallback. (Same harness as v3.48.0; delete the one-off dump test after.)
3. `pnpm package:win` → build; asar grep for `ga98-report-appshell` / `ga98-report-recent` / `ga98-report-nav-active` (mind the un-minified `x: y` spacing — grep with the space or extract the asar).
4. Whole-branch adversarial review (correctness / UI-CSS completeness / dead-button audit / settings-merge landmine) → refute-by-default verify → one consolidated fix.

## Self-Review (author, done)

- **Spec coverage:** menu bar + toolbar (T5), nav tree + quick actions (T4), dashboard + recent table (T3/T6), status/author + settings merge (T1), filters/sort/duplicate (T2), status control (T6), CSS + visual gate (T7). Templates/right-preview deferred-and-greyed (T4/T5/T6). All covered.
- **Placeholder scan:** none — UI tasks reference concrete existing patterns (createRoot harness, `ga98-context-menu`/`ga98-toolbar`, the TextBlock outside-mousedown close) with real test assertions; no "TODO".
- **Type consistency:** `NavNode` (T2) reused in T4/T6; `Report.status`/`author` (T1) used by T2/T3/T6; the `onAction` id union (T5) dispatched in T6; `duplicateReport` signature (T2) matches its T3 context-menu caller. `mergeSettings` change (T1) matched by its test.
