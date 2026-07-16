# Reports Editor Follow-ups (v3.52.0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Six fixes + one feature on the Report Template editor from GhostExodus's testing: the descriptor popup chaos, a "To" combobox, an image signature, upload-from-computer in the photo picker, image whitespace/resize, and a document that grows with content.

**Tech Stack:** Electron 33 + React 18 + TS, vitest/jsdom. Repo `/dcs98`, branch `feat/reports-editor-followups`.

## Global Constraints
- No new egress/dependency/IPC. Reuse `SignaturePad`, the report asset store (`putAsset`), and existing export helpers. Don't regress the v3.50.2 typing fix or v3.51.0 font-picker/`toContactId` work.
- **Commit ONLY on `feat/reports-editor-followups`. NEVER checkout/merge/delete branches or touch main — the controller merges.**
- Commits: author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `--no-verify` + `-c`; NO AI trailers; explicit-path adds; never stage `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`, `pnpm-lock.yaml`.
- Commands: `pnpm test`, `pnpm typecheck`.

**Sequencing:** T1–T5 are independent (mostly separate files); T6 (signature) is the model/export change. Any order; recommended T1→T6.

---

### Task 1: Descriptor/Introduction popup — kill the double menu + fix off-screen placement
**Files:** `src/renderer/modules/reports/blocks/TextBlock.tsx`; Test: `test/reports-descmenu.test.tsx`.
- [ ] **Step 1: Failing test** (jsdom) — render `TextBlock` inside a container that also has `ReportEditor`'s block-level `onContextMenu`; fire `contextMenu` inside the text body; assert exactly ONE descriptor menu opens (the bubbling no longer opens a second block menu); assert the menu is rendered under `document.body` (portal) not inside `.ga98-report-page`; outside-click dismisses it.
- [ ] **Step 2: Run → FAIL** (currently the event bubbles → double menu; menu is a direct child, `position:fixed` inside the transformed page).
- [ ] **Step 3: Implement.** In `openDescriptorMenu` (`TextBlock.tsx:203-215`) add `e.stopPropagation();` alongside the existing `e.preventDefault()`. Render the descriptor menu (`:344-350`) via `ReactDOM.createPortal(<menu/>, document.body)` so its `position:fixed` + `clientX/clientY` coords resolve against the true viewport (not the `transform:scale`d `.ga98-report-page`). Keep the outside-click dismiss (`:259-267`) and `insertFragment` unchanged.
- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `fix(reports): descriptor popup — stop double menu + portal it out of the scaled page`.

---

### Task 2: "To" field — combobox (dropdown + free-type)
**Files:** `src/renderer/modules/reports/ReportEditor.tsx`; Test: `test/reports-to-combobox.test.tsx`.
- [ ] **Step 1: Failing test** — the To control is a text `<input list=...>` with a `<datalist>` of contacts; typing a free value calls `patch({ to: <typed>, toContactId: undefined })`; typing/selecting a value equal to a saved contact's display name calls `patch({ toContactId: <id> })` (and clears `to`). (Mock `contacts`.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Replace the To `<select>` block (`ReportEditor.tsx:313-334`) with: an `<input aria-label="To recipient" list="report-to-contacts" value={report.toContactId ? <contact display> : report.to} onChange={...}>` + a `<datalist id="report-to-contacts">` of `contacts.map(c => <option value={displayName(c)}>)`. `onChange`: if the typed value matches a contact's display name → `patch({ toContactId: c.id, to: '' })`; else → `patch({ to: value, toContactId: undefined })`. Keep the "Choose…" ContactBook button. Export is unchanged (it already resolves `toContactId ?? report.to`).
- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `feat(reports): To field is a combobox — pick a contact or free-type a recipient`.

---

### Task 3: Image block — size the frame to the image (whitespace + resize)
**Files:** `src/renderer/modules/reports/blocks/ImageBlock.tsx`, `src/renderer/styles/theme.css`; Test: `test/reports-imageblock.test.tsx`.
- [ ] **Step 1: Failing test** — render `ImageBlock` at `widthPct:40`; assert the frame's width tracks `widthPct` (40%) and the `<img>` is `width:100%` of the frame (not the img at 40% of a full-width frame); the resize handle sits on the image's corner; a resize drag updates `widthPct`.
- [ ] **Step 2: Run → FAIL** (frame spans full column; img at 40%).
- [ ] **Step 3: Implement.** Move the width sizing from the `<img>` to the frame: in `ImageBlock.tsx:80` set the `<img>` to `width:100%` (remove its `widthPct` inline width), and apply `width: ${clampPct(block.widthPct)}%` to `.ga98-report-imageblock-frame` (via inline style on the frame element). In `theme.css` (`.ga98-report-imageblock-frame` `:1566`) ensure the frame is `display:inline-block` with the dynamic width (drop `max-width:100%` conflicts if needed; keep it ≤100%). The handle (`.ga98-report-imageblock-handle`, `right:0;bottom:0`) now lands on the image corner. Keep the resize drag width-only (export model is `widthPct`).
- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `fix(reports): image frame hugs the image (no whitespace) + resize handle on the corner`.

---

### Task 4: Document grows with content (page auto-height)
**Files:** `src/renderer/styles/theme.css`; Test: `test/reports-page-grow.test.ts` (structural/CSS).
- [ ] **Step 1: Failing test** — assert `.ga98-report-pagescroll` does not stretch the page to viewport height — i.e. the rule sets `align-items:flex-start` (or `.ga98-report-page` sets `align-self:flex-start`). (A computed-style / CSS-text assertion, per the 98.css-cascade lesson; if a Playwright harness is overkill, assert the theme.css rule contains the property.)
- [ ] **Step 2: Run → FAIL** (currently `align-items:stretch` default).
- [ ] **Step 3: Implement.** Add `align-items: flex-start;` to `.ga98-report-pagescroll` (`theme.css:1497`). The page (`min-height:1056px`) now grows past the viewport with content and the container scrolls. No other change.
- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `fix(reports): document page grows with content instead of clipping at one viewport`.

---

### Task 5: Photo picker — upload from computer
**Files:** `src/renderer/modules/reports/CasePhotoPicker.tsx` (+ wiring in `ReportsModule.tsx`/`ReportEditor.tsx`); Test: `test/reports-photopicker-upload.test.tsx`.
- [ ] **Step 1: Failing test** — the `CasePhotoPicker` has an "Upload from computer" `<input type=file accept="image/png,image/jpeg">`; choosing a file reads its bytes and calls the existing add-photo path (`addPhotoBytes`/`addPhoto`) → an image block is added and the picker closes.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Add an upload `<input type=file accept="image/png,image/jpeg">` to `CasePhotoPicker.tsx` (mirror `SignaturePad.upload()`'s FileReader→data-URL, or read `file.arrayBuffer()`), invoking the same callback the "+ Photo" toolbar uses (`addPhoto`/`addPhotoBytes` in `ReportsModule.tsx:281-290,266-267`). Surface it alongside the case-photo list.
- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `feat(reports): upload an image from the computer in the photo picker`.

---

### Task 6: Signature — draw/upload an image (SUBSTANTIVE)
**Files:** `src/shared/reports-types.ts`, `src/renderer/modules/reports/ReportEditor.tsx`, `src/renderer/modules/reports/ReportsModule.tsx`, `src/main/reports/report-html.ts`, `src/main/reports/docx.ts`, `src/main/security/validate.ts`; Test: `test/reports-signature-image.test.ts` + `.tsx`.
**Interfaces:** adds `signatureRef?: string` to `Report` + `ReportTemplate`.
- [ ] **Step 1: Failing tests** — (a) `ensureReport`/`ensureReportTemplate` accept + bound `signatureRef`; a template round-trips it (saveAsTemplate/createFromTemplate copy it). (b) `buildReportHtml` emits an `<img src=...>` for the signature when `signatureRef` resolves in the asset map, else the legacy `Signature: <text>`; `renderReportDocx` uses its `addImage` media helper when `signatureRef` set, else the text run. (c) capturing a signature in the editor calls `putAsset` and sets `signatureRef`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `reports-types.ts`: add `signatureRef?: string;` to `Report` and `ReportTemplate` (keep the text `signature`).
  - `validate.ts`: validate `signatureRef` like other asset refs (`ensureFileName`/bounded) in `ensureReport` AND `ensureReportTemplate`.
  - `ReportsModule.tsx`: ensure `saveAsTemplate`/`createFromTemplate` copy `signatureRef` (the v3.51.0 template-round-trip lesson); a `captureSignature(dataUrl,mime)` that `putAsset`s the bytes → `patch({ signatureRef })`.
  - `ReportEditor.tsx` (`:362-368`): render `<SignaturePad onCapture={captureSignature}/>` (draw/upload) + a preview of `assets[signatureRef]`; keep the text field as a fallback/label if desired.
  - `report-html.ts:61`: when `signatureRef` resolves in the assets map, emit `<img src="${dataUri}">` (reuse the banner/image data-URI path); else the legacy text.
  - `docx.ts:250`: when `signatureRef` set, use the existing `addImage(ref, widthPct)` helper (`:186-191`); else the text run.
- [ ] **Step 4: test + typecheck + build** → PASS. **Commit** — `feat(reports): signature can be drawn or uploaded (image), rendered into PDF + DOCX`.

---

## Post-tasks (controller, after all tasks green + whole-branch review)
- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-run).
- [ ] Bump `package.json` → `3.52.0`; `RELEASE_NOTES_v3.52.0.md`; README (status/changelog/version/test count).
- [ ] `pnpm package:win`; grep packaged `app.asar` for `signatureRef`, `report-to-contacts`, `imageblock-frame`.
- [ ] Merge `feat/reports-editor-followups` → main; GitHub release (gh-api + curl); profile README update; push all.
- [ ] THEN resume the paused PDF Signer (feat/pdf-signer, Tasks 3–6) as v3.53.0, then foraging Plan 2.

## Self-Review
- **Coverage:** #1→T1, #2→T2, #5+#6→T3, #7→T4, #4→T5, #3→T6. Six quick + one substantive.
- **Type consistency:** `signatureRef?` on Report+ReportTemplate (T6) consumed by editor/putAsset (T6), both exports (T6), validators (T6) — wired through the template paths per the v3.51.0 lesson.
- **Charter:** no egress/dep/IPC; v3.50.2/v3.51.0 internals preserved; signature image encrypted at rest via the existing asset store.
