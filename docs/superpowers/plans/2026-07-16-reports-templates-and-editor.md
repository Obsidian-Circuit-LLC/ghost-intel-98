# Reports Templates + Word-Processor Editor Implementation Plan (v3.50.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Templates system (save-as-template, library + preview, create-from-template, un-grey the Templates controls) and a word-processor-feel editor (always-focused text body + case/reference/classification/signature metadata) to the Reports module.

**Architecture:** A template is a saved report you clone — a new `ReportTemplate` in the encrypted store whose assets are deep-copied for independence. The editor keeps the block model + sanitizer; C only ensures a text body always exists and is focused, and adds four metadata strings. New `Report` metadata fields are shared by `ReportTemplate`.

**Tech Stack:** TypeScript, React, Electron main/preload/renderer, secure-fs JSON store, DOMPurify (unchanged), adm-zip (DOCX), Chromium printToPDF, Vitest. No new dependencies.

## Global Constraints

- **Commit identity:** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`. NEVER emit AI-identity trailers.
- **Explicit-path `git add` only.** Never stage `pnpm-lock.yaml`, `resources/**`, `native/**`, `docs/superpowers/ideation/**`.
- **No new dependencies. No new egress. Encrypt-at-rest preserved.**
- **Security spine:** `sanitizeReportHtml` (renderer) is the sole barrier before `report-html.ts`/`docx.ts`. Every new field that is not sanitized-block-HTML (title, to, metadata, template name/category) is `escapeHtml`/`esc`-escaped in the exporters. Template Preview renders `buildReportHtml` output inside a `sandbox=""` `srcdoc` iframe (no scripts).
- **No dead buttons.** Templates controls become fully functional in this release (no more greyed placeholders for them).
- **`window.prompt` is a no-op in Electron** — use the existing CaseDialogs `promptDialog`, never `window.prompt`.
- Windows-only. Tests `pnpm exec vitest run <files>`; typecheck `pnpm exec tsc --noEmit`.

---

## File Structure

**Modified:** `src/shared/reports-types.ts` (metadata + `ReportTemplate` + `templates`), `src/main/reports/store.ts` (templates CRUD + `copyAsset`), `src/main/security/validate.ts` (`ensureReport` metadata + `ensureReportTemplate`), `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts` (templates IPC), `src/main/reports/report-html.ts` + `src/main/reports/docx.ts` (metadata), `src/renderer/modules/reports/ReportEditor.tsx` (metadata fields + focused body), `src/renderer/modules/reports/ReportsModule.tsx` (templates wiring), `src/renderer/modules/reports/ReportsNavTree.tsx` / `ReportsMenuBar.tsx` / `ReportsToolbar.tsx` / `ReportsDashboard.tsx` (un-grey Templates), `src/renderer/styles/theme.css`.

**Created:** `src/renderer/modules/reports/TemplateLibrary.tsx` (or fold into the dashboard right rail), `src/renderer/modules/reports/TemplatePreview.tsx`, test files per task.

---

## Task 1: Data model + validators + template store

**Files:** Modify `src/shared/reports-types.ts`, `src/main/reports/store.ts`, `src/main/security/validate.ts`. Test: `test/reports-templates-store.test.ts` (create).

**Interfaces — Produces:**
- `Report` gains `caseNumber?: string; referenceNumber?: string; classification?: string; signature?: string;`.
- `ReportTemplate` (per the spec's interface) and `ReportStoreData.templates: ReportTemplate[]`.
- Store: `listTemplates()`, `saveTemplate(t: ReportTemplate): Promise<ReportTemplate>`, `removeTemplate(id: string): Promise<void>`, `copyAsset(ref: string): Promise<string | null>`.
- `validate.ts`: `ensureReportTemplate(raw): ReportTemplate`; `ensureReport` bounds the four metadata strings.

- [ ] **Step 1: Write the failing test** — `test/reports-templates-store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { _resetForTest, listTemplates, saveTemplate, removeTemplate, putAsset, copyAsset, getAsset } from '../src/main/reports/store';
import { ensureReport, ensureReportTemplate } from '../src/main/security/validate';

describe('templates store + validators', () => {
  beforeEach(async () => { await _resetForTest(); });

  it('round-trips a template', async () => {
    const t = await saveTemplate({ id: 't1', name: 'Chain of Custody', createdAt: 'a', updatedAt: 'b', to: 'PO', blocks: [] } as any);
    expect((await listTemplates()).map((x) => x.id)).toEqual(['t1']);
    await removeTemplate('t1');
    expect(await listTemplates()).toEqual([]);
    expect(t.name).toBe('Chain of Custody');
  });

  it('copyAsset makes an independent copy', async () => {
    const ref = await putAsset(Buffer.from([1, 2, 3]), 'image/png');
    const copy = await copyAsset(ref);
    expect(copy).toBeTruthy();
    expect(copy).not.toBe(ref);
    const a = await getAsset(copy!);
    expect(a?.bytes.length).toBe(3);
  });

  it('ensureReport bounds metadata; ensureReportTemplate requires id+name', () => {
    const r = ensureReport({ id: 'r', to: '', blocks: [], caseNumber: 'CASE-1', classification: 'Confidential' });
    expect(r.caseNumber).toBe('CASE-1');
    expect(r.classification).toBe('Confidential');
    expect(() => ensureReportTemplate({ name: 'x' })).toThrow(/id/);
    const t = ensureReportTemplate({ id: 't', name: 'T', to: '', blocks: [] });
    expect(t.name).toBe('T');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run test/reports-templates-store.test.ts` → FAIL.

- [ ] **Step 3: Types** (`src/shared/reports-types.ts`) — add the four optional metadata strings to `Report`; add `ReportTemplate` (copy the interface from the spec verbatim); add `templates: ReportTemplate[]` to `ReportStoreData`.

- [ ] **Step 4: Store** (`src/main/reports/store.ts`) — mirror the descriptor CRUD for templates (add `templates: p.templates ?? []` to `read()`'s parse + catch + `_resetForTest`; `MAX_TEMPLATES = 500`; `listTemplates/saveTemplate/removeTemplate` identical shape to the descriptor fns). Add:

```ts
export async function copyAsset(ref: string): Promise<string | null> {
  const a = await getAsset(ref);          // re-validates ref (ensureFileName) internally
  if (!a) return null;
  return putAsset(a.bytes, a.mime);        // fresh uuid ref owning its own bytes
}
```

- [ ] **Step 5: Validators** (`src/main/security/validate.ts`) — in `ensureReport`, after `to`, bound the four metadata strings (reuse `reportStr` with `MAX_REPORT_TO`-scale caps; keep only when non-empty). Add `ensureReportTemplate` mirroring `ensureReport` but requiring `id` + `name`, routing `bannerRef`/image `assetRef`s through `ensureFileName` (reuse `ensureReportBlock`), bounding `name`/`category`/metadata, defaulting timestamps.

- [ ] **Step 6: Run tests + typecheck** — PASS; `pnpm exec tsc --noEmit` clean (fix any `ReportStoreData` construction site now missing `templates`).

- [ ] **Step 7: Commit**

```bash
git add src/shared/reports-types.ts src/main/reports/store.ts src/main/security/validate.ts test/reports-templates-store.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): report metadata fields + ReportTemplate model, template store CRUD + copyAsset"
```

---

## Task 2: Templates IPC / preload / channels

**Files:** Modify `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`. Test: `test/reports-templates-ipc.test.ts` (store round-trip regression guard, mirroring `test/reports-introductions-ipc.test.ts`).

**Interfaces — Consumes:** store template fns (T1). **Produces:** `window.api.reports.templates.{ list, save, remove }`.

- [ ] **Step 1: Write the failing test** — mirror `test/reports-introductions-ipc.test.ts`: reset the store, `saveTemplate`, assert `listTemplates`, `removeTemplate`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Channels** — add `templatesList/templatesSave/templatesRemove` to the `reports` channel object in `ipc-contracts.ts` (mirror `descriptorsList/...`).
- [ ] **Step 4: Handlers** (`register.ts`, after the introductions handlers) — `safeHandle(channels.reports.templatesList, () => reportStore.listTemplates())`, `...Save, (...a) => reportStore.saveTemplate(ensureReportTemplate(a[0]))`, `...Remove, (...a) => reportStore.removeTemplate(a[0] as string)`. Import `ensureReportTemplate`.
- [ ] **Step 5: Preload + types** — add `templates: { list, save, remove }` to `src/preload/index.ts`'s `reports` object and the matching type to `src/preload/api.d.ts` (`ReportTemplate` reused).
- [ ] **Step 6: Run tests + typecheck** — PASS; clean.
- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/reports-templates-ipc.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): templates IPC (list/save/remove) + preload"
```

---

## Task 3: Exports render metadata

**Files:** Modify `src/main/reports/report-html.ts`, `src/main/reports/docx.ts`. Test: extend `test/reports-html.test.ts` + `test/reports-docx.test.ts`.

- [ ] **Step 1: Write the failing tests** — `buildReportHtml` for a report with `caseNumber:'CASE-1', referenceNumber:'REF-2', classification:'Confidential', signature:'J. McGraw'` contains each escaped value; `renderReportDocx` XML contains each value.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** — in `report-html.ts`, render a metadata block after the header (`Case #`, `Reference #`, `Classification` lines) via `escapeHtml`, and a `Signature: <name>` line at the end. In `docx.ts`, emit the same as escaped `richRun` paragraphs (Case/Reference/Classification near the top, Signature near the end). Guard each with `if (report.caseNumber) ...` so absent fields render nothing.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/reports/report-html.ts src/main/reports/docx.ts test/reports-html.test.ts test/reports-docx.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): render case/reference/classification/signature metadata in PDF + DOCX"
```

---

## Task 4: Editor metadata fields + always-focused text body

**Files:** Modify `src/renderer/modules/reports/ReportEditor.tsx`, `src/renderer/modules/reports/ReportsModule.tsx` (seed a text block on new report). Test: `test/reports-editor-wordprocessor.test.tsx` (createRoot harness).

**Interfaces — Consumes:** `Report` metadata (T1).

- [ ] **Step 1: Write the failing test** — mounting `ReportEditor` with a report whose `blocks: []` renders a focused `contentEditable` text body (assert a `.ga98-report-textblock-body` exists and is the active element after mount); the header renders inputs labelled "Case #", "Reference #", "Classification", "Signature"; changing "Case #" calls `onChange` with `caseNumber` set.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — In `ReportEditor`: (a) add compact labelled inputs for `caseNumber`/`referenceNumber`/`classification`/`signature` in the header, each `patch({...})` on change (mirror the existing Title/To inputs). (b) Ensure a text body always exists: if `report.blocks` has no `kind:'text'` block, call `onChange` once (in an effect) to seed `{ id: crypto.randomUUID(), kind:'text', html:'' }` at the front; on mount, focus the first text block's contentEditable (a `ref` + `useEffect(() => ref.current?.focus(), [])`, guarded for jsdom). In `ReportsModule.seedReport()`, seed the new report with one empty text block so "Create New Report" opens straight into a typable document.
- [ ] **Step 4: Run tests + typecheck** — PASS; clean.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/ReportEditor.tsx src/renderer/modules/reports/ReportsModule.tsx test/reports-editor-wordprocessor.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): metadata header fields + always-present focused text body (type-immediately)"
```

---

## Task 5: Templates nav branch + Template Preview panel

**Files:** Create `src/renderer/modules/reports/TemplatePreview.tsx`. Modify `src/renderer/modules/reports/ReportsNavTree.tsx` (add Templates branch), `src/renderer/modules/reports/ReportsModule.tsx` (load templates, host preview). Test: `test/reports-template-preview.test.tsx`.

**Interfaces — Consumes:** `window.api.reports.templates.list` (T2); `buildReportHtml` is main-side, so the preview asks main to build it — OR the renderer renders a lightweight preview. **Decision:** add a main-side `reports.previewTemplate(id): Promise<string>` IPC that returns `buildReportHtml(templateAsReport, assets, contact)` (assets resolved main-side), and the renderer drops it into a `sandbox=""` `srcdoc` iframe. (This keeps `buildReportHtml` main-only and the preview faithful to export.) Add that channel/handler/preload alongside T2's if not already; it is part of THIS task.

- [ ] **Step 1: Write the failing test** — `TemplatePreview` given `html` renders an `<iframe sandbox="" srcdoc=...>`; the nav tree renders a "Templates" branch with "My Templates"; selecting it calls the templates-view callback.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — `TemplatePreview.tsx`: a titled Win98 panel with an `<iframe sandbox="" srcdoc={html} className="ga98-report-tpl-preview-frame">` + a "Select Template" button (`onSelect`). Add the `Templates [My Templates]` branch to `ReportsNavTree` (folder + page icons, matching the existing branches). In `ReportsModule`: load templates on mount; when the Templates node is active (or the Use-Template flow is open), show the template list + `<TemplatePreview>` in the right rail, fetching preview HTML via the new `previewTemplate` IPC.
- [ ] **Step 4: Run tests + typecheck** — PASS; clean.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/TemplatePreview.tsx src/renderer/modules/reports/ReportsNavTree.tsx src/renderer/modules/reports/ReportsModule.tsx src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/reports-template-preview.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): Templates nav branch + sandboxed Template Preview panel"
```

---

## Task 6: Save-as-template + create-from-template + un-grey Templates controls

**Files:** Modify `src/renderer/modules/reports/ReportsModule.tsx`, `ReportsMenuBar.tsx`, `ReportsToolbar.tsx`, `ReportsDashboard.tsx`, `ReportsNavTree.tsx`. Test: `test/reports-templates-actions.test.tsx`.

**Interfaces — Consumes:** everything above.

- [ ] **Step 1: Write the failing test** — clicking "Save as Template" with an open report calls `promptDialog` then `templates.save` with the report's content + a name; "Use Template" / "Select Template" calls `reports.save` with a fresh-id copy of the template then swaps to the editor; the Templates menu items / "Use Template" tile / quick-action are NOT `disabled`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — In `ReportsModule`:
  - `saveAsTemplate()`: `promptDialog` for a name; build a `ReportTemplate` from the open report (copy `bannerRef` + image `assetRef`s through `window.api.reports.copyAsset` — add that IPC if not present, mirroring `getAsset`); `templates.save`; toast.
  - `createFromTemplate(t)`: deep-copy `t` content, copy its assets via `copyAsset`, build a `Report` (fresh id, `status:'draft'`, `author` from settings), `reports.save`, open in editor.
  - Wire the dispatch `actionId`s for `saveAsTemplate` / `useTemplate` and pass real handlers.
  - Remove the `disabled` from the Templates menu items (`ReportsMenuBar`), the "Use Template" tile (`ReportsDashboard`), and the "Use Template" quick-action (`ReportsNavTree`) — wire each to the flows.
- [ ] **Step 4: Run tests + typecheck** — PASS; clean.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/ReportsModule.tsx src/renderer/modules/reports/ReportsMenuBar.tsx src/renderer/modules/reports/ReportsToolbar.tsx src/renderer/modules/reports/ReportsDashboard.tsx src/renderer/modules/reports/ReportsNavTree.tsx test/reports-templates-actions.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): save-as-template + create-from-template; un-grey all Templates controls"
```

(If `reports.copyAsset` IPC is needed by the renderer flows, add its channel/handler/preload in this task — main calls `reportStore.copyAsset`.)

---

## Task 7: Light-Win98 CSS for template preview + metadata fields

**Files:** Modify `src/renderer/styles/theme.css`. Test: `test/reports-templates-css.test.ts` (jsdom computed-style, mirroring `reports-shell-css.test.ts`).

- [ ] **Step 1: Write the failing test** — `.ga98-report-tpl-preview-frame` has a white background + a border (sunken); the metadata field container lays out; `.ga98-report-tpl-list` styled. Assert declared values per the light-Win98 palette (`#c0c0c0`/`#fff`/`#808080`).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — append rules to the `ga98-report` block: `.ga98-report-tpl-preview` (silver panel), `.ga98-report-tpl-preview-frame` (white, sunken border, `width:100%`, aspect-ratio or fixed height, no scroll bleed), `.ga98-report-tpl-list` (white sunken list like the recent table), and metadata-field layout (compact labelled inputs in the header). Match the v3.49.1 Win98 palette + bevels.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/theme.css test/reports-templates-css.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): Win98 styling for the Template Preview panel + metadata fields"
```

---

## Final Verification (controller)

1. `pnpm test` → all green; `pnpm exec tsc --noEmit` → clean.
2. **Visual gate:** SSR-render the editor (with metadata fields populated) + the Template Preview panel → headless-Chrome screenshot; confirm light-Win98, metadata fields present, preview renders.
3. `pnpm package:win`; asar grep `previewTemplate` / `ga98-report-tpl-preview` / `caseNumber` / `Save as Template` (mind the un-minified `x: y` spacing).
4. Whole-branch adversarial review: template asset independence (source delete doesn't break the template + vice-versa), the sandboxed preview iframe (no script execution — `sandbox=""`), metadata escaping in exports, no dead Templates control, and the seeded-text-block not double-seeding or fighting autosave.

## Self-Review (author, done)

- **Spec coverage:** template model+store+copyAsset (T1), IPC (T2), export metadata (T3), editor focused-body + metadata fields (T4), nav+preview (T5), save/create/un-grey (T6), CSS (T7). All spec sections covered.
- **Placeholder scan:** none — the one "implementer picks the wiring" note in the spec is resolved in T5 (main-side `previewTemplate` IPC) and T6 (`copyAsset` IPC), with concrete instructions, not TODOs.
- **Type consistency:** `ReportTemplate` shape identical across T1 (defn) / T2 (IPC) / T5-T6 (consumers); `Report` metadata fields (T1) consumed by T3 exports + T4 editor; `copyAsset` signature (T1) matched by T6; `previewTemplate` IPC introduced + consumed in T5.
