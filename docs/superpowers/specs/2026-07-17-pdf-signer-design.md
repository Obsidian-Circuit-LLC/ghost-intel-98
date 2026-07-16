# PDF Signer — Design

**Date:** 2026-07-17
**Status:** Approved for planning (pending spec review)
**Author:** Obsidian Circuit (from GhostExodus's request — a no-frills PDF signing tool)

## Overview

A standalone, fully-offline **PDF Signer**: import a `.pdf` (a contract, form, etc.), **draw or upload** a signature, place it on a page, and **save a signed copy**. "Short, simple, to the point" — no frills. It reuses the app's existing signature pad and PDF renderer; the only genuinely new pieces are a main-process signing service (pdf-lib) and its two IPC channels.

Operator decision (2026-07-17): use **pdf-lib** (a pure-JS, MIT, offline PDF editor) to stamp the signature into the real PDF — faithful (preserves the original text/vectors/pages), simpler than the flatten-to-image alternative.

Target release: **v3.52.0** (new user-facing tool).

## What's reused vs new

**Reused (no change):**
- `src/renderer/modules/invoices/SignaturePad.tsx` — draw/upload → PNG data URL (`onCapture(dataUrl, mime)`); its `scaleToBitmap` helper for drag math.
- The pdfjs-dist page→canvas render core from `src/renderer/modules/doc-viewer/DocViewerModule.tsx` (`PdfBody`, the `getDocument`/`getViewport`/`page.render({canvas,viewport})` path) — extracted to render one page at a chosen scale.
- `saveBufferWithDialog(win, name, data)` (`src/main/ipc/register.ts`) — writes the signed PDF via the OS save dialog (sanitize + symlink-refuse + atomic write).
- Validators: `ensureAssetInput` (image mime allowlist + 2 MB cap) for the signature; `ensureImportSourcePath` for the picked PDF path.

**New:**
- Dependency **pdf-lib** (pure-JS, MIT, no native/network — bundles via electron-vite; vetted offline).
- `src/main/pdf-signer/sign.ts` — the signing service.
- Two IPC channels (`pdfsign:read`, `pdfsign:sign`).
- `src/renderer/modules/pdf-signer/PdfSignerModule.tsx` + the module registration (Organizer category).

## Architecture

**Flow:** pick a `.pdf` → read its bytes (transient, capped, not vaulted) → render pages in the module → capture a signature (draw/upload) → place it (drag + resize) on a chosen page → **Sign & Save** → main embeds the signature into the PDF via pdf-lib and writes the signed copy through the save dialog.

**Renderer — `PdfSignerModule.tsx`:**
- "Open PDF…" → `window.api.files.pickOpen({ filters:[{name:'PDF',extensions:['pdf']}] })` → path → `window.api.pdfsign.read(path)` → bytes.
- Render pages with the extracted pdfjs single-page renderer (page nav + zoom, mirroring DocViewer).
- `SignaturePad` captures a PNG data URL; the signature shows as a **draggable, resizable overlay** on the current page canvas (drag to position, corner handle to resize; `scaleToBitmap` maps display↔bitmap coords).
- Placement is stored **normalized to the page** (`{ page, xFrac, yFrac, wFrac }` — fractions of page width/height, plus page index), so it's scale- and DPI-independent and needs no coordinate coupling to the renderer's zoom.
- "Sign & Save" → `window.api.pdfsign.sign({ pdfBytes, signatureDataUrl, placement })`.
- v1: **one** signature placement on **one** page (the common case). Multiple placements is a trivial later extension (the API already takes a placement — widen to an array if wanted). YAGNI for v1.

**Main — `src/main/pdf-signer/sign.ts` + IPC:**
- `pdfsign:read(path)` → validate `ensureImportSourcePath(path)`, enforce a PDF size cap (new `MAX_PDF_SIGN_BYTES`, modeled on `MAX_EXPORT_ASSET_BYTES` ≈ 25 MB), read bytes, return them. Transient — the source PDF is NOT written to the vault (a signer operates on a user file, then saves a new one).
- `pdfsign:sign({ pdfBytes, signatureDataUrl, placement })` → `signPdf(...)`:
  - Validate the signature via `ensureAssetInput` (png/jpeg, ≤2 MB); decode the data URL to bytes.
  - `PDFDocument.load(pdfBytes)`; `pdfDoc.embedPng`/`embedJpg` the signature; get `page = pages[placement.page]`; compute PDF-space coords from the normalized placement and the page's `getWidth()/getHeight()` (PDF origin is bottom-left: `x = xFrac*W`, `w = wFrac*W`, `h = w * sigAspect`, `y = H*(1 - yFrac) - h`); `page.drawImage(img, {x, y, width, height})`; `pdfDoc.save()` → `Uint8Array`.
  - `saveBufferWithDialog(win, '<original-stem>-signed.pdf', Buffer.from(bytes))` → returns saved/canceled.
- The signing is a **pure `signPdf(pdfBytes, sigBytes, sigMime, placement): Promise<Uint8Array>`** function over injected inputs (unit-testable with a fixture PDF, no dialog), wrapped by the IPC handler that adds the save dialog.

**Module registration (Organizer):**
- Add `'pdf-signer'` to the `ModuleKey` union (`state/store.ts`).
- One `registerModule({ key:'pdf-signer', title:'PDF Signer', glyph:'✒️', component: PdfSignerAdapter, builtin:true, defaultWidth, defaultHeight })` in `register-builtins.tsx`.
- Add `{ module:'pdf-signer', label:'PDF Signer' }` to the **Organizer** category in `shell/AccessMenu.tsx`.
- (ModuleHost needs no change — runtime registry routes it.)

## Charter alignment
- **Fully offline, no egress.** Render (pdfjs, in-process), sign (pdf-lib, pure-JS), save (dialog) are all local. No network surface added — the only new component is the pdf-lib dependency (pure-JS, no native/network; vet the pinned version).
- **Caps + validation:** signature ≤2 MB via `ensureAssetInput`; PDF ≤~25 MB via a new `MAX_PDF_SIGN_BYTES`; picked path via `ensureImportSourcePath`; save name sanitized by `saveBufferWithDialog`.
- **No vault clutter:** the source PDF is read transiently and never written to the encrypted store; only the user's explicit "Save signed copy" writes anything, to a location they choose.
- **Determinism** is not a concern here (a signing tool is inherently interactive), but `signPdf` is a pure function over its inputs for testing.

## New dependency
- `pdf-lib` (latest stable, pinned). Add to `package.json` `dependencies`; it bundles into `out/` via electron-vite (pure ESM/CJS JS, no native addon, no postinstall). Confirm no telemetry/network in the package (it has none). This is analogous to the bundled `adm-zip` added for `.docx`.

## Tests
- `test/pdf-signer-sign.test.ts` (node) — `signPdf` over a tiny fixture PDF + a fixture PNG: the output is a valid PDF (`PDFDocument.load` round-trips), the target page count is unchanged, and the page now contains an embedded image (assert an image XObject / that the byte length grew and re-loads). Placement math: normalized coords map to expected PDF-space x/y within the page; an out-of-range page index errors cleanly; an oversize/invalid signature is rejected (`ensureAssetInput`); an oversize PDF is rejected by the read cap.
- `test/pdf-signer-placement.test.ts` (renderer, pure) — the display↔normalized coordinate helpers (drag/resize → `{xFrac,yFrac,wFrac}`) are correct and clamp to the page.
- `test/pdf-signer-module.test.tsx` (jsdom) — the module registers under `pdf-signer`; Open→read→render wiring calls the right IPC; Sign & Save calls `pdfsign:sign` with the normalized placement; no signature ⇒ Sign disabled.

## Verification
- `pnpm typecheck` + full `pnpm test` green (new suites). `node esbuild`/`electron-vite build` bundles pdf-lib. Windows smoke (operator-gated): open a real multi-page PDF, draw + place a signature, save, reopen the signed PDF and confirm the signature is on the right page/position and the rest of the document is intact.
- Grep the packaged `app.asar` for `signPdf`, `pdfsign`, and a pdf-lib identifier.

## Out of scope (YAGNI / future)
- Multiple signatures / initials-per-page / typed-text signatures (v1 = one drawn/uploaded signature on one page; the API is a trivial widen to an array).
- Filling form fields, flattening, or certificate/cryptographic PDF signatures (this is a *visual* signature, not a digital PKI signature — the app's PQ evidence/lineage signing is the separate cryptographic-integrity story).
- Editing an existing signature after save (re-open the signed PDF and sign again).
