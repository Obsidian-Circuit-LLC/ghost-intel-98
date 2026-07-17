# Reports Editor — GhostExodus follow-ups (v3.52.0) — Design

**Date:** 2026-07-17
**Status:** Approved for planning (pending spec review)
**Author:** Obsidian Circuit (relaying GhostExodus field feedback on the Report Template editor)

## Overview

Seven items from GhostExodus's continued testing of the Report Template editor — six quick fixes (bugs + small wiring) and one substantive feature (an image signature). All grounded against the current code. The v3.50.2/v3.51.0 editor internals (typing fix, font pickers, `toContactId`) are untouched except where a fix explicitly extends them.

Target release: **v3.52.0**. (The PDF Signer, whose spec/plan currently say v3.52.0, is paused mid-build on `feat/pdf-signer` — it re-versions to **v3.53.0** when resumed; update its docs then.)

## Global Constraints
- No new network egress, no new dependency (reuse `SignaturePad`, the report asset store, existing export helpers). Encrypt-at-rest unchanged (signature image goes through the same `putAsset` path as photos).
- Do not regress the v3.50.2 typing fix or the v3.51.0 font-picker/`toContactId` work.
- **Workflow subagents: commit ONLY on the branch `feat/reports-editor-followups`. NEVER checkout/merge/delete branches or touch main — the controller merges.**
- Commits: author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `--no-verify` + `-c`; NO AI trailers; explicit-path adds; never stage the known-dirty files.

---

## WS1 — Descriptor/Introduction popup chaos (#1) — QUICK (two bugs)
**Root cause (both in `blocks/TextBlock.tsx`):** (a) `openDescriptorMenu` (`:203-215`) calls `e.preventDefault()` but not `e.stopPropagation()`, so the contextmenu bubbles to `ReportEditor.tsx:241` `onContextMenu={openContextMenu}` and opens a **second** block-level menu at the same coords — the "chaotic double menu." (b) The descriptor menu is `position:fixed` (`:344-350`) but sits inside `.ga98-report-page` which has `transform:scale` (`theme.css:1498`); a CSS transform makes that element the containing block for `position:fixed`, so the viewport `clientX/clientY` coords place the menu off-screen.
**Design:** add `e.stopPropagation()` in `openDescriptorMenu` (kills the double menu); render the descriptor menu through a **React portal to `document.body`** (outside the transformed page) so `position:fixed` uses true viewport coords. Keep the existing outside-click dismiss (`:259-267`) and the insert logic (`insertFragment`, sound).
**Files:** `blocks/TextBlock.tsx`. **Test:** `test/reports-descmenu.test.tsx` — a right-click in the text body opens exactly ONE menu (not two); the menu renders at the pointer coords via a portal; outside-click dismisses it.

## WS2 — "To" field: dropdown + free-type (#2) — QUICK
**Root cause:** v3.51.0 replaced the recipient input with a `<select>` (`ReportEditor.tsx:313-334`), so free-typing a recipient into `report.to` is no longer possible (the model field still exists; export already handles both — `report-html.ts:53`, `docx.ts:209-225`).
**Design:** make the "To" control a **combobox** — a text `<input list="report-to-contacts">` + a `<datalist>` of saved contacts. Typing writes `report.to` via `patch({ to })` and clears `toContactId`; selecting/typing a value that matches a saved contact's name sets `toContactId` (and may clear `to`). Whichever is populated is what export renders (contact block vs. escaped string — no export change).
**Files:** `ReportEditor.tsx`. **Test:** `test/reports-to-combobox.test.tsx` — free-typing sets `report.to` and clears `toContactId`; picking a contact name sets `toContactId`; both export paths still resolve (unit or via the existing recipient-contact test).

## WS3 — Signature: draw/upload (#3) — SUBSTANTIVE (model + export)
**Root cause:** the report `signature` is a plain text `<input>` (`ReportEditor.tsx:362-368`, model `reports-types.ts:38`) rendered as text (`report-html.ts:61`, `docx.ts:250`). `SignaturePad` (`invoices/SignaturePad.tsx`) is reusable (draw/upload → PNG data URL).
**Design:** add `signatureRef?: string` to `Report` (+ `ReportTemplate`, keep the text `signature` for back-compat). In the editor, render `<SignaturePad onCapture={...}>` that stores the captured PNG via the report asset path (`window.api.reports.putAsset(bytes,mime)` → set `signatureRef`), resolving the preview via the same `assets[ref]` cache used for the banner/images. Export: `report-html.ts` signature branch emits `<img src="${assets[signatureRef]}">` when a ref exists (else the legacy text); `docx.ts:250` uses its existing `addImage(ref, widthPct)` media helper. Carry `signatureRef` through the template save/create paths + validators (lesson from v3.51.0: wire new report fields through `ReportTemplate` + `ensureReport`/`ensureReportTemplate`).
**Files:** `reports-types.ts`, `ReportEditor.tsx`, `ReportsModule.tsx` (asset put), `src/main/reports/report-html.ts`, `src/main/reports/docx.ts`, `src/main/security/validate.ts`. **Test:** `test/reports-signature-image.test.ts(x)` — capturing a signature sets `signatureRef` via putAsset; PDF HTML + DOCX render an `<img>`/image when `signatureRef` is set, else the legacy text; a template round-trips `signatureRef`; validators accept it.

## WS4 — Image import: upload-from-computer in the picker (#4) — QUICK
**Note:** upload-from-computer ALREADY exists as the "+ Photo" toolbar button (`ReportEditor.tsx:214-222` → `ReportsModule.addPhoto` → `putAsset`). The gap: the **"Import from case"** dialog (`CasePhotoPicker.tsx`) is case-only, which is where the user looked.
**Design:** add an **"Upload from computer"** affordance inside `CasePhotoPicker.tsx` — a `<input type=file accept="image/png,image/jpeg">` that calls the existing `addPhotoBytes`/`addPhoto` path (mirror the SignaturePad `upload()` FileReader pattern), so the picker offers both case photos and a disk upload.
**Files:** `CasePhotoPicker.tsx` (+ the callback wiring in `ReportsModule.tsx`/`ReportEditor.tsx`). **Test:** `test/reports-photopicker-upload.test.tsx` — the picker has an upload input; choosing a file calls the add-photo path and inserts an image block.

## WS5 — Image whitespace + one-direction resize (#5, #6) — QUICK (one fix)
**Root cause:** in `blocks/ImageBlock.tsx`, `widthPct` is applied to the `<img>` (`:80`) but the container `.ga98-report-imageblock-frame` (`theme.css:1566`) is `display:inline-block; max-width:100%` with no width tied to the image — so the frame resolves to the full column width while the image fills only `widthPct`, leaving the empty band (and the resize handle at the frame's `right:0`, not the image corner → "one direction").
**Design:** size the **frame** to the image, not the img to the frame — move `widthPct` onto `.ga98-report-imageblock-frame` (`width: <pct>%`) and make the `<img>` `width:100%` (or set the frame `width:fit-content`). Whitespace disappears; the resize handle lands on the image's real corner so width-drag reads as proportional. Keep the export model width-only (`widthPct`) — no export change. (True 2-axis resize is out of scope; proportional width with a correctly-placed handle is the ask.)
**Files:** `blocks/ImageBlock.tsx`, `theme.css` (`.ga98-report-imageblock-frame/-handle`). **Test:** `test/reports-imageblock.test.tsx` (computed-style or structural) — the frame width tracks `widthPct`, the img is 100% of the frame, the handle is on the image corner; a resize drag changes `widthPct`.

## WS6 — Document auto-grow (#7) — QUICK (flexbox trap)
**Root cause:** `.ga98-report-page` uses `min-height:1056px` (would grow), but `.ga98-report-pagescroll` is `display:flex; justify-content:center` with default `align-items:stretch` (`theme.css:1497`), pinning the page's height to the scroll viewport — so content taller than the viewport overflows below the sheet instead of extending it ("only 1 page / abruptly ends").
**Design:** stop stretching — add `align-items:flex-start` to `.ga98-report-pagescroll` (or `align-self:flex-start` to `.ga98-report-page`). The page then grows with content off its `min-height:1056` floor and the container scrolls. (Continuous auto-height, which is what "keep extending" asks for; true multi-page pagination is deferred.)
**Files:** `theme.css`. **Test:** covered by a computed-style assertion or the smoke pass (CSS-only); assert `.ga98-report-pagescroll` no longer stretches the page (structural/CSS test).

---

## Cross-cutting
- No new IPC channel/dependency. WS3 is the only model/export change; the rest are renderer/CSS/wiring.
- Version → **3.52.0**; README + release notes + profile README on ship.

## Verification
- `pnpm typecheck` + full `pnpm test` green (new suites). Windows smoke (operator-gated): right-click in the text body shows one menu at the pointer that dismisses; type a recipient OR pick a contact; draw/upload a signature that appears in the PDF+DOCX; upload an image from disk via the picker; a dropped image has no whitespace and resizes on its corner; adding lots of content extends the page (scrolls) instead of cutting off.

## Out of scope (deferred)
- True multi-page pagination (continuous auto-grow only).
- Two-axis free image resize (proportional width only).
- The PDF Signer (paused; resumes as v3.53.0).
