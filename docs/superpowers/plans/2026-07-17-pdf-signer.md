# PDF Signer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A standalone offline **PDF Signer** module — import a `.pdf`, draw/upload a signature, place it on a page, save a signed copy (pdf-lib overlay preserving the original document). From GhostExodus's request.

**Architecture:** Renderer module reusing `SignaturePad` + the pdfjs page renderer; a pure main-side `signPdf` (pdf-lib) behind two IPC channels; save via `saveBufferWithDialog`. Registered in the Organizer Access-menu category.

**Tech Stack:** Electron 33 + React 18 + TS, pdf-lib (new), pdfjs-dist (existing), vitest/jsdom. Repo `/dcs98`, branch `feat/pdf-signer`.

## Global Constraints
- **Fully offline, no egress.** Render/sign/save all local. The only new surface is the `pdf-lib` dependency (pure-JS, no native/network).
- **Caps/validation:** signature ≤2 MB via `ensureAssetInput` (png/jpeg); picked PDF path via `ensureImportSourcePath`; new `MAX_PDF_SIGN_BYTES` (~25 MB, model on `MAX_EXPORT_ASSET_BYTES`); save name via `saveBufferWithDialog`. No vault write for the source PDF (transient).
- **Workflow subagents: commit ONLY on `feat/pdf-signer`. NEVER checkout/merge/delete branches or touch main — the controller merges.** Task 1 (add pdf-lib) is done by the controller before the workflow; the workflow implements Tasks 2–6.
- Commits: author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `--no-verify` + `-c`; NO AI trailers; explicit-path adds; never stage `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`. (`pnpm-lock.yaml` IS staged in Task 1 — it's the pdf-lib addition, and the lock is otherwise clean.)
- Commands: `pnpm test`, `pnpm typecheck` (both configs), `pnpm build`/electron-vite.

## File Structure
**New:** `src/main/pdf-signer/sign.ts` (T2), `src/renderer/modules/pdf-signer/PdfSignerModule.tsx` + `pdf-page.tsx` (render) + `placement.ts` (T4/T5/T6); tests `test/pdf-signer-*.test.ts(x)`.
**Modified:** `package.json`+`pnpm-lock.yaml` (T1), `src/shared/ipc-contracts.ts`+`src/preload/index.ts`+`src/preload/api.d.ts`+`src/main/ipc/register.ts`+`src/main/security/validate.ts` (T3), `src/renderer/state/store.ts`+`src/renderer/modules/register-builtins.tsx`+`src/renderer/shell/AccessMenu.tsx` (T6).
**Sequencing:** T1 (controller) → T2 (signPdf) → T3 (IPC, uses signPdf) → T4/T5 (renderer render + placement, independent) → T6 (module composes T4/T5 + T3 + registration).

---

### Task 1 (controller, pre-workflow): Add pdf-lib
- [ ] `pnpm add pdf-lib` (pins latest 1.x, ~1.17.1). Confirm no native addon / no postinstall (pure JS). Verify `node -e "require('pdf-lib').PDFDocument"` resolves and `pnpm build` bundles it. Commit `build: add pdf-lib dependency for the PDF Signer` (stage `package.json` + `pnpm-lock.yaml` only).

---

### Task 2: `signPdf` main-side signing service
**Files:** `src/main/pdf-signer/sign.ts`; Test: `test/pdf-signer-sign.test.ts`.
**Interfaces:** Produces `interface Placement { page: number; xFrac: number; yFrac: number; wFrac: number }` and `signPdf(pdfBytes: Uint8Array, sigBytes: Uint8Array, sigMime: 'image/png'|'image/jpeg', p: Placement): Promise<Uint8Array>`.

- [ ] **Step 1: Failing test** (node) — build a fixture in-test: `PDFDocument.create()` → `addPage([600,800])` → `save()` = `pdfBytes`; a tiny fixture PNG (1×1) = `sigBytes`. Assert: `signPdf(pdfBytes, png, 'image/png', {page:0,xFrac:0.5,yFrac:0.1,wFrac:0.2})` returns bytes that `PDFDocument.load` round-trips, page count unchanged, and byte length grew (image embedded). `page` out of range throws `'page out of range'`. (Add a placement-math assertion: for a 600pt-wide page, `xFrac:0.5` → the drawn x ≈ 300.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `sign.ts`:
  ```ts
  import { PDFDocument } from 'pdf-lib';
  export interface Placement { page: number; xFrac: number; yFrac: number; wFrac: number }
  export async function signPdf(pdfBytes: Uint8Array, sigBytes: Uint8Array, sigMime: 'image/png'|'image/jpeg', p: Placement): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes);
    const pages = doc.getPages();
    if (!Number.isInteger(p.page) || p.page < 0 || p.page >= pages.length) throw new Error('page out of range');
    const page = pages[p.page];
    const W = page.getWidth(), H = page.getHeight();
    const img = sigMime === 'image/png' ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);
    const w = Math.max(1, p.wFrac * W);
    const h = w * (img.height / img.width);
    // xFrac/yFrac are top-left anchored fractions from the page's top-left; PDF origin is bottom-left.
    const x = p.xFrac * W;
    const y = H * (1 - p.yFrac) - h;
    page.drawImage(img, { x, y, width: w, height: h });
    return doc.save();
  }
  ```

- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `feat(pdf-signer): signPdf — overlay a signature onto a PDF page via pdf-lib`.

---

### Task 3: IPC channels (`pdfsign:read`, `pdfsign:sign`)
**Files:** `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/ipc/register.ts`, `src/main/security/validate.ts`; Test: `test/pdf-signer-ipc.test.ts`.
**Consumes:** Task 2 `signPdf`; existing `ensureImportSourcePath`, `ensureAssetInput`, `saveBufferWithDialog`.

- [ ] **Step 1: Failing test** — the `pdfsign:sign` handler: given a fixture PDF (bytes), a valid signature data URL, and a placement, it calls `signPdf` and hands the result to `saveBufferWithDialog` (mock the dialog → assert the signed bytes are passed with a `*-signed.pdf` default name); an oversize signature is rejected via `ensureAssetInput`. The `pdfsign:read` handler: a path over `MAX_PDF_SIGN_BYTES` is rejected; a valid path returns bytes. (Follow an existing register.ts handler test harness.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `validate.ts`: add `export const MAX_PDF_SIGN_BYTES = 25 * 1024 * 1024;` and a `parseSignatureDataUrl(dataUrl): { bytes: Uint8Array; mime: 'image/png'|'image/jpeg' }` that decodes + validates via `ensureAssetInput` (reuse its mime/size rules).
  - `ipc-contracts.ts`: add `pdfsign: { read: 'pdfsign:read', sign: 'pdfsign:sign' }`.
  - `register.ts`: `pdfsign:read` handler — `ensureImportSourcePath(path)`, `stat` size ≤ `MAX_PDF_SIGN_BYTES` else throw, `readFile` → return `Uint8Array`. `pdfsign:sign` handler — validate the placement (ints/fractions in [0,1]), parse+validate the signature data URL, `const signed = await signPdf(pdfBytes, sig.bytes, sig.mime, placement)`, then `saveBufferWithDialog(win, stem+'-signed.pdf', Buffer.from(signed))` → return `{ saved: boolean }`.
  - `preload/index.ts` + `api.d.ts`: `pdfsign.read(path)` / `pdfsign.sign({ pdfBytes, signatureDataUrl, placement })`.

- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `feat(pdf-signer): pdfsign read/sign IPC (capped read, validated sign + save dialog)`.

---

### Task 4: Single-page pdfjs renderer (reused)
**Files:** `src/renderer/modules/pdf-signer/pdf-page.tsx`; Test: `test/pdf-signer-page.test.tsx`.

- [ ] **Step 1: Failing test** (jsdom, mock pdfjs `getDocument`/`getPage`/`render`) — a `PdfPage` component given PDF bytes + a page index + scale renders that page to a `<canvas>` and reports the page's viewport dimensions via a callback; page nav changes the rendered page. (Mock the pdfjs module the way DocViewer tests do, if any; else assert `page.render` was called with the right page/scale.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — extract the render core from `DocViewerModule.tsx` `PdfBody` (lines ~288–309: `getDocument({data})`, `getPage(n)`, `getViewport({scale})`, canvas sizing, `page.render({canvas, viewport})`, the same worker setup) into a `PdfPage` that renders ONE page at a chosen scale and exposes `{ canvas, viewportWidth, viewportHeight, pageCount }` (for the overlay math). No TextLayer needed.

- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `feat(pdf-signer): single-page pdfjs renderer`.

---

### Task 5: Placement coordinate helpers (pure)
**Files:** `src/renderer/modules/pdf-signer/placement.ts`; Test: `test/pdf-signer-placement.test.ts`.
**Interfaces:** `toNormalized(rect, canvasW, canvasH): { xFrac, yFrac, wFrac }` and clamps to [0,1]; `fromNormalized(p, canvasW, canvasH): { left, top, width }` (for rendering the overlay); resize keeps the signature aspect.

- [ ] **Step 1: Failing test** — a rect at (canvasW/2, canvasH/10) size canvasW/5 → `xFrac 0.5, yFrac 0.1, wFrac 0.2`; round-trips `fromNormalized(toNormalized(r)) == r`; a rect dragged past the edge clamps xFrac/yFrac into [0,1]. Pure, no DOM.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the pure helpers (fractions of canvas W/H; clamp).

- [ ] **Step 4: test + typecheck** → PASS. **Commit** — `feat(pdf-signer): normalized placement helpers`.

---

### Task 6: PdfSignerModule + registration
**Files:** `src/renderer/modules/pdf-signer/PdfSignerModule.tsx`, `src/renderer/state/store.ts`, `src/renderer/modules/register-builtins.tsx`, `src/renderer/shell/AccessMenu.tsx`; Test: `test/pdf-signer-module.test.tsx`.
**Consumes:** T3 IPC, T4 `PdfPage`, T5 placement, existing `SignaturePad`.

- [ ] **Step 1: Failing test** (jsdom, mock `window.api`) — the module registers under `pdf-signer`; "Open PDF…" calls `files.pickOpen` then `pdfsign.read`; a captured `SignaturePad` signature shows a draggable overlay; "Sign & Save" (enabled only with both a PDF and a signature) calls `pdfsign.sign` with `{ pdfBytes, signatureDataUrl, placement:{page,xFrac,yFrac,wFrac} }`; no signature ⇒ Sign disabled.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `PdfSignerModule.tsx`: Open→`pickOpen`→`pdfsign.read`→bytes; render current page via `PdfPage` (+ page nav + zoom); `SignaturePad` → data URL; a draggable/resizable overlay `<img>` on the page (use `placement.ts` + `scaleToBitmap` from SignaturePad for the drag math); page selector; "Sign & Save" → `pdfsign.sign(...)` → toast on saved/canceled.
  - Registration: add `'pdf-signer'` to the `ModuleKey` union (`store.ts`); a `PdfSignerAdapter` + `registerModule({ key:'pdf-signer', title:'PDF Signer', glyph:'✒️', component: PdfSignerAdapter, builtin:true, defaultWidth: 900, defaultHeight: 720 })` in `register-builtins.tsx`; `{ module:'pdf-signer', label:'PDF Signer' }` in the **Organizer** category of `AccessMenu.tsx`.

- [ ] **Step 4: test + typecheck + build** → PASS; electron-vite bundles pdf-lib. **Commit** — `feat(pdf-signer): PDF Signer module (open, render, place signature, sign & save) + Organizer entry`.

---

## Post-tasks (controller, after all tasks green + whole-branch review)
- [ ] Full `pnpm test` + `pnpm typecheck` + build (pdf-lib bundled).
- [ ] Bump `package.json` → `3.52.0`; `RELEASE_NOTES_v3.52.0.md`; README (status/changelog/version/test count).
- [ ] `pnpm package:win`; grep packaged `app.asar` for `signPdf`, `pdfsign`, and a `pdf-lib` identifier.
- [ ] Merge `feat/pdf-signer` → main; GitHub release (gh-api + curl); profile README update; push all.
- [ ] THEN proceed to foraging Plan 2 (the other queued build).

## Self-Review
- **Coverage:** signing (T2) + IPC/caps (T3) + render (T4) + placement (T5) + module/registration (T6); dep (T1). Charter: offline, caps, no vault clutter, pure `signPdf`.
- **Type consistency:** `Placement{page,xFrac,yFrac,wFrac}` defined T2, used T3 (validate+call) and T6 (build+send); `signPdf` signature stable T2↔T3; `PdfPage` viewport out (T4) feeds placement (T5/T6).
- **Charter:** no egress; the lone new dependency is pure-JS/offline; source PDF transient; signature/PDF size-capped.
