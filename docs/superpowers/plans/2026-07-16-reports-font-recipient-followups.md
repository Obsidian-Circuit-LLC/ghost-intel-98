# Reports Font-Picker Fix + Structured Recipient — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the report editor's font-family/size pickers apply (they silently no-op), and give the report recipient the same structured `Contact` the sender already has (Org/Name/Phone/Email via the existing ContactBook popup), rendered into PDF + DOCX. From GhostExodus's field feedback on the Report Template Generator.

**Architecture:** Renderer fix in `TextBlock.tsx` (snapshot the selection before the native `<select>` steals focus, mirroring the working `linkRange` flow); a `toContactId` on `Report`, a recipient contact select in `ReportEditor.tsx` reusing `ContactBook`, structured "To" export with a legacy-string fallback, and a validator update.

**Tech Stack:** Electron 33 + React 18 + TS, vitest/jsdom. Repo `/dcs98`, branch `feat/reports-font-recipient`.

## Global Constraints
- **Do NOT modify the v3.50.2 typing/text-body fix** — leave `TextBlock.tsx`'s `initialHtml` ref + `dangerouslySetInnerHTML` (line 45/320) and `.ga98-report-textblock-body` CSS alone.
- No new egress, no new dependency, no new IPC channel. Backward compatible: reports without `toContactId` still export via the legacy `report.to` string.
- **Workflow subagents: commit ONLY on the branch `feat/reports-font-recipient`. NEVER checkout/merge/delete branches or touch `main` — the controller merges.**
- Commits: author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- Commands: `pnpm test`, `pnpm typecheck` (both configs).

## File Structure
**Modified:** `src/renderer/modules/reports/blocks/TextBlock.tsx` (T1), `src/shared/reports-types.ts` + `src/main/security/validate.ts` (T2), `src/renderer/modules/reports/ReportEditor.tsx` (T3), `src/main/reports/report-html.ts` + `src/main/reports/docx.ts` (T4).
**Tests:** `test/reports-fontpicker.test.tsx` (T1), `test/reports-recipient-contact.test.ts(x)` (T2/T4), and a renderer wiring test (T3).
**Sequencing:** T1 independent; T2 (model+validator) before T3 (UI) and T4 (export).

---

### Task 1: Fix the font-family + font-size pickers (selection snapshot)
**Files:** `src/renderer/modules/reports/blocks/TextBlock.tsx`; Test: `test/reports-fontpicker.test.tsx`.

**Root cause:** the two pickers are native `<select>`s (`:258-286`) with `onChange` but no selection preservation. Opening a native select blurs the `contentEditable`, so by the time `onChange` fires, `applyFont`/`applySize` read a collapsed `window.getSelection()` and hit their `isCollapsed` guard → no-op. The `linkRange` flow (`openLink`/`confirmLink`, `:149-182`) already solves this class by snapshotting on `onMouseDown`.

- [ ] **Step 1: Failing test** `test/reports-fontpicker.test.tsx` (jsdom, follow `test/reports-textblock.test.tsx` harness): render `TextBlock` with a text block + an `onChange` spy; put text in the body, create a Range selecting it, `fireEvent.mouseDown` the Font-family `<select>`, then `fireEvent.change` it to `'Arial'`; assert the committed (sanitized) HTML passed to `onChange` contains `font-family:Arial`. Same for the Font-size select → `font-size:<pt>pt`. Assert that WITHOUT the mousedown snapshot (selection collapsed) it no-ops (guards intact).

- [ ] **Step 2: Run → FAIL** (current code reads live collapsed selection).

- [ ] **Step 3: Implement.** Add a `const fontRange = useRef<Range | null>(null);` (beside `linkRange`) and a helper:
  ```tsx
  function snapshotFontRange(): void {
    const el = ref.current; const sel = window.getSelection();
    fontRange.current = (el && sel && sel.rangeCount > 0 && !sel.isCollapsed
      && el.contains(sel.getRangeAt(0).commonAncestorContainer)) ? sel.getRangeAt(0).cloneRange() : null;
  }
  ```
  Add `onMouseDown={snapshotFontRange}` to BOTH `<select>`s (`:258`, `:273`). Rewrite `applySize`/`applyFont` to operate on `fontRange.current` instead of the live selection: guard `const range = fontRange.current; if (!range || range.collapsed || !el.contains(range.commonAncestorContainer)) return;`, do the existing `extractContents`/`insertNode` wrap on `range`, then `el.focus()` + re-select the wrapper, `fontRange.current = null`, `commit()`. (Keep the size/bold wrapper logic and the `sanitizeReportHtml`-on-commit exactly as-is.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `fix(reports): apply font family/size by snapshotting the selection before the picker steals focus`.

---

### Task 2: `toContactId` model + validator
**Files:** `src/shared/reports-types.ts`, `src/main/security/validate.ts`; Test: `test/reports-recipient-contact.test.ts`.

- [ ] **Step 1: Failing test** — `ensureReport` accepts a report with `toContactId: '<uuid>'` (bounded string, like `fromContactId`) and preserves it; a report without it is unchanged; an over-long/invalid `toContactId` is rejected/bounded. (Follow the existing `ensureReport`/`ensureContact` test harness.)

- [ ] **Step 2: Run → FAIL** (field unknown).

- [ ] **Step 3: Implement.** In `reports-types.ts`, add `toContactId?: string;` to `Report` (after `fromContactId`, `:31`) and to `ReportTemplate` (after its `fromContactId`, `:53`). Keep `to: string`. In `validate.ts` `ensureReport`, validate `toContactId` exactly as `fromContactId` is validated (optional bounded string).

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(reports): add toContactId to the report model (+ validator)`.

---

### Task 3: Recipient as a Contact in the editor
**Files:** `src/renderer/modules/reports/ReportEditor.tsx`; Test: `test/reports-recipient-ui.test.tsx`.

**Consumes:** Task 2 `toContactId`; the existing `ContactBook` popup (`onUse(id)`/`onClose`) and the From-select pattern (`:285-297`).

- [ ] **Step 1: Failing test** — render `ReportEditor` (mock `window.api.reports.contacts.list`): the "To" control is a contact `<select>` bound to `report.toContactId` whose change calls `patch({ toContactId })`; opening the ContactBook targeted at the recipient and choosing a contact (`onUse`) sets `toContactId` (not `fromContactId`). Legacy: a report with only `report.to` still shows its value as a fallback.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Replace the bare To `<input>` (`:299-306`) with a To contact `<select>` mirroring the From block (`:282-297`): bound to `report.toContactId ?? ''`, options from `contacts`, `onChange={(e) => patch({ toContactId: e.target.value || undefined })}`, plus the org span. Generalize the existing ContactBook-open flow so its `onUse` can target either field — read how From currently opens ContactBook (the `onUse` handler that sets `fromContactId`) and parametrize it with a target `'from' | 'to'` so the same popup fills the recipient. Keep the legacy `report.to` visible as a read-only fallback line when `toContactId` is unset and `to` is non-empty (so old reports don't lose their recipient in the UI).

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(reports): recipient is a Contact (select + ContactBook popup), sender fields now reachable for both`.

---

### Task 4: Structured "To" in PDF + DOCX export (legacy fallback)
**Files:** `src/main/reports/report-html.ts`, `src/main/reports/docx.ts`; Test: extend `test/reports-recipient-contact.test.ts`.

**Consumes:** Task 2 `toContactId`; the existing `contactHtml(contact)` (PDF) and the DOCX contact-line block used for From.

- [ ] **Step 1: Failing test** — building the PDF HTML for a report whose `toContactId` resolves to a Contact renders the structured To block (org/name/phone/email lines, HTML-escaped) via the same helper the From block uses; a report with only `report.to` renders the escaped legacy string; same for DOCX (`docx.ts`). (Look up the contact by id from the store data the builder already has.)

- [ ] **Step 2: Run → FAIL** (To always renders the string).

- [ ] **Step 3: Implement.** In `report-html.ts` (the To rendering at ~`:48`), resolve `report.toContactId` to a `Contact` from the report store data (as From is resolved) and render it with `contactHtml(contact)` when present; else `escapeHtml(report.to)`. Mirror in `docx.ts` (~`:213`): structured contact lines when `toContactId` resolves, else the legacy `report.to` line. No change to the From path.

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(reports): render the structured recipient in PDF + DOCX (legacy-string fallback)`.

---

## Post-tasks (controller, after all 4 green + whole-branch review)
- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-run).
- [ ] Bump `package.json` → `3.51.0`; `RELEASE_NOTES_v3.51.0.md`; README (status/changelog/version/test count).
- [ ] `pnpm package:win`; grep packaged `app.asar` for `toContactId`, `snapshotFontRange`, `fontRange`.
- [ ] Merge `feat/reports-font-recipient` → main; GitHub release (gh-api + curl); profile README 6-spot update; push all.

## Self-Review
- **Coverage:** WS-A (font) → T1; WS-B (recipient) → T2 (model) + T3 (UI) + T4 (export). The "no response" perception = the font pickers, fixed by T1.
- **Type consistency:** `toContactId?: string` on `Report`/`ReportTemplate` (T2) consumed by T3 (patch) and T4 (resolve+render); `fontRange` ref + `snapshotFontRange` local to T1.
- **Charter:** no egress/dep/IPC/cap added; v3.50.2 editor internals untouched; backward-compatible legacy `to` fallback in UI + export.
