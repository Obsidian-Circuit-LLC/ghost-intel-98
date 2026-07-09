# Ghost Ledger 98 — .docx Export, Logo Remove/Display, Branding — Design

**Date:** 2026-07-09
**Origin:** GhostExodus field feedback on the shipped invoice module ("a masterpiece" — wants a `.docx` export, the ability to remove an uploaded image, each logo displayed in its box, and a name/branding for the empty space).
**Repo:** `/dcs98` (core, public MIT). Extends the `invoices` module. Target release **v3.38.0**.

## Goals

Three additions to the invoice generator, plus a rename:

1. **`.docx` export** alongside PDF — a real, editable OOXML Word document.
2. **Remove an uploaded image** — a clear control on each logo and the signature.
3. **Display each logo in its box** — render the uploaded logo in the From/To blocks (with the remove control), not only in the preview.
4. **Branding / rename** — the tool becomes **Ghost Ledger 98** *everywhere* (desktop label, taskbar, shortcuts) plus a sleek in-app branded header with a Win98 emblem, filling the empty header space.

Operator decisions (2026-07-09): name = **Ghost Ledger 98**, applied **everywhere** (not just an in-app header).

## Charter constraints

- **No new dependency.** `.docx` is built with **`adm-zip`** (already a dependency — `backup.ts` uses it for `.ghost` case bundles). No egress, all local.
- **No fabricated data.** `.docx` numbers reuse `calc.ts` (`lineHours`/`round2`/`computeTotals`/`formatMoney`) — they foot identically to the PDF and the preview.
- **Encrypt at rest preserved.** Logo/signature assets remain encrypted blobs; removal clears the invoice's `logoRef`/`signatureRef` (the blob is *not* deleted — `duplicateInvoice` clones refs, so a blob may be shared; ref-clearing is the correct, safe operation).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `-c` identity, `--no-verify`, no AI trailers, explicit-path adds; never stage the known-dirty files.

## Feature 1 — `.docx` export

- **`src/main/invoices/docx.ts`** — `renderInvoiceDocx(invoice: Invoice, assets: Record<string,string>): Buffer`. Assembles the minimal OOXML package with `adm-zip`:
  - `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels`, and `word/media/image{N}.{png|jpg}` for each present logo/signature (decoded from the `ref→dataURL` map).
  - `document.xml` lays out: a header (INVOICE #, issue date, sender logo), From/To parties (+ client logo), a native Word **line-item table** (Date · Time · Description · Hours · Amount), the totals block (Total hours / Subtotal / Tax / **Total**), notes, and the signature (image + signer + date). Every user string is XML-escaped.
  - Images use OOXML `w:drawing`/`a:blip` with a relationship id per media part.
- **IPC `invoices:exportDocx({ invoice: Invoice; assets: Record<string,string> })` → `string | null`** — the renderer passes the *structured* invoice + the resolved `ref→dataURL` map it already builds for the PDF; main renders the docx (no HTML parsing), shows a save dialog (`invoice.docx`), refuses a symlink target (mirrors `exportPdf`), writes, returns the filename. `ensureInvoice` validates.
- **Renderer** — an **Export DOCX** button beside Export PDF in `InvoicesModule`; same asset resolution, calls `window.api.invoices.exportDocx(...)`.

**Honest scope:** the `.docx` is a clean, professional, editable Word layout (real table + text + images) — not a pixel-perfect clone of the PDF's CSS. That's the right trade for an editable format.

## Feature 2 — Logo display box + remove; signature button, preview + remove

- **`InvoiceForm` party block** — below the Logo file input, a bordered **preview box**: when `p.logoRef && assets[p.logoRef]`, show `<img>` + a **✕ Remove** button; else a subtle "No logo" placeholder (stable layout). Remove calls `setParty(which, { logoRef: undefined })`, dropping the image from the box, the live preview, and both exports.
- **Signature — button styling.** In `SignaturePad`, the "Upload signature" control is currently a bare `<label>` (renders as plain text). Restyle it to render as a proper Win98 button matching the "Clear" button beside it (a `.ga98-file-button` label, or a real `<button>` that triggers a hidden `ref`'d file input) so the two controls look consistent.
- **Signature — preview + remove.** In the form, a bordered signature **preview box** mirroring the logo boxes: when `invoice.signature?.signatureRef && assets[signatureRef]`, show the signature `<img>` (validating an upload/draw succeeded) + a **✕ Remove** that clears `invoice.signature.signatureRef` (keeps signer name/date unless also cleared); else a "No signature" placeholder.
- Ref-clearing only — the encrypted blob is not deleted (may be shared via `duplicateInvoice`).

## Feature 3 — Rename to Ghost Ledger 98 (everywhere) + branded header

- **Everywhere (display label):** `register-builtins.tsx` `registerModule({ key: 'invoices', title: 'Ghost Ledger 98', glyph: '📒', … })` (the **key stays `invoices`** — stable id for persistence/shortcuts/tests; only the display title + glyph change). Update the `Desktop.tsx` title and the `types.ts` shortcut label to "Ghost Ledger 98". The `register-builtins` enumeration test asserts the *key* set (unchanged), so it stays green.
- **In-app header — banner image (delivered):** a branded header strip at the top of `InvoicesModule` renders the bundled banner **`src/renderer/assets/ghost-ledger-banner.png`** — the operator's native "GHOST LEDGER 98 · PROFESSIONAL BILLING & INVOICING" artwork (1983×793, ~2.5:1, self-framed, already placed in the repo). Imported like the existing `logo.png` (`import bannerUrl from '../../assets/ghost-ledger-banner.png'`). Because it carries its own frame at a 2.5:1 aspect, it's rendered **centered and height-capped** rather than stretched full-width — `.ga98-ledger-banner { display:block; margin:0 auto; height:auto; width:auto; max-height:180px; max-width:100%; }` — so the complete framed banner shows at ~180px tall against the header strip, filling the empty header space GhostExodus flagged without dominating the module.

## Data model

No schema change. `Invoice`/`Party`/`Signature` unchanged (`logoRef?`/`signatureRef?` are already optional — clearing them to `undefined` is valid). New IPC channel `invoices:exportDocx` in `ipc-contracts.ts`.

## Error handling

- Missing/corrupt logo or signature asset → the `.docx` (and PDF) render without that image (no crash).
- Remove on an already-empty logo → no-op.
- `exportDocx` with no line items → still produces a valid empty-table doc.
- Invalid invoice at the IPC boundary → `ensureInvoice` throws before any file write.

## Testing

- **`docx.ts`** — unzip the result: assert it's a valid ZIP containing the required OOXML parts; `document.xml` contains the invoice number, a line row, and the footed total (matches `computeTotals`); an image-bearing invoice writes a `word/media/*` part + a relationship; user text is XML-escaped (no raw `<`/`&`).
- **Logo remove/display** — `InvoiceForm`: with a `logoRef` + asset, the preview box renders the image + a Remove button; clicking Remove emits an invoice with that `logoRef` undefined; no `logoRef` → placeholder, no image.
- **Signature** — `SignaturePad`'s upload control renders as a button (a `role="button"`/`.ga98-file-button` element, not bare text); with a `signatureRef` + asset the form shows the signature preview `<img>`; Remove clears `signatureRef`; no ref → placeholder.
- **IPC** — `invoices:exportDocx` channel present; handler validates the invoice.
- **Rename** — `register-builtins` still lists `invoices` (key) and its title is "Ghost Ledger 98"; the enumeration test (keys) stays green.

## Out of scope (YAGNI)

- Pixel-perfect PDF↔DOCX visual parity.
- Orphaned-asset garbage collection (refs may be shared via duplicate; needs refcounting — separate concern).
- Additional export formats (CSV/XLSX) — not requested.
- A configurable/custom-banner upload UI (one operator-bundled banner asset; text-wordmark fallback until it lands).
