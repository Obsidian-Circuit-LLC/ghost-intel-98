# Chain of Custody Report Generator — Design

**Date:** 2026-07-15
**Origin:** GhostExodus / operator request — a report-builder for the final deliverable after an OSINT investigation.
**Repo:** `/dcs98` (core). Target **v3.46.0** (or a series if phased across releases).

## What it is

A global **Reports** module: a Google-doc-like builder for a formal "Chain of Custody" report — a logo banner, sender/recipient header, rich text, drag-drop resizable captioned photos, reusable canned-text "descriptors", and export to **PDF** and **DOCX**. It is the last step after the OSINT work is done, so it stands apart from any single case (but can pull a case's photos in).

## Operator decisions (2026-07-15)

- **Editor model = structured blocks** (not free-form contentEditable): a fixed header + an ordered list of body blocks. Deterministic, testable, clean export.
- **Location = global Reports module** (Access menu, Organizer category, next to Ghost Ledger) + an **Import-from-case** action.
- **Font sizing = presets** (Small / Normal / Large / Heading) + Bold / Italic / Underline.
- **Descriptors** = a named canned-text library; right-click in a text block → menu with a preview → **Insert text** OR **Insert with title (bold)** per insert.

## Reuse (this is mostly assembly of proven pieces)

- **Saved libraries** ← `invoices/store.ts` pattern (list/save/delete of reusable entities, encrypted-at-rest).
- **DOCX with images** ← `invoices/docx.ts` (OOXML, images as `word/media` + DrawingML runs, adm-zip — already a dependency).
- **PDF** ← the shared `htmlToPdf` in `services/export.ts` (printToPDF; used by invoices + INTELREPORT).
- **HTML sanitization** ← `lib/sanitizeHtml` (DOMPurify) — already used by the doc-viewer.
- **Case photos** ← `loadAttachmentBytes` / the `files.*` attachment IPC.
- **Logo/banner image handling + assets** ← the invoice logo pattern (`putAsset`/`logoRef`).

## Document model

```
Report {
  id, title, createdAt, updatedAt,
  bannerRef?: string,            // uploaded logo banner (full-width, top). Defaults to the last-used banner.
  fromContactId?: string,        // selected saved Contact (fills the From header)
  to: string,                    // recipient ("To:"), free text
  blocks: Block[]                // ordered body
}
Block =
  | TextBlock  { id, type:'text',  html: string }              // sanitized rich text
  | ImageBlock { id, type:'image', assetRef: string, widthPct: number, caption: string }
```

Two shared libraries live beside the reports list in the same store:

```
Contact    { id, name, title?, org?, email?, phone?, address?, logoRef? }   // the address book
Descriptor { id, name, body: string }                                       // canned-text snippets
```

## Screen layout (the editor)

```
┌ [ LOGO BANNER — upload / replace ] ───────────────────────┐
│ From: [ pick contact ▾ ]  (name · title · org · contact)  │
│ To:   [ recipient text ______________________ ]           │
├───────────────────────────────────────────────────────────┤
│ Toolbar: [B] [I] [U]  [Size: Normal ▾]   + Text   + Photo  │
│                                                            │
│ ¶ text block (rich, right-click → Descriptors ▸)           │
│ [ photo ]  caption (smaller font)   ⟲ resize handle        │
│ ¶ text block …                                             │
└────────────────────────────────────────────────────────────┘
```

- **Banner:** per-report upload (stored as an asset); remembers the last-used as the default for new reports.
- **From:** a dropdown of saved Contacts; picking one fills the header. The **Contact book** panel does add/edit/delete/select.
- **To:** a plain text field (add/edit/delete the recipient).
- **Body toolbar:** `+ Text` and `+ Photo` append blocks; `B/I/U` + `Size` format the current text-block selection.

## Rich text (text blocks)

- Each `TextBlock` is a `contentEditable` region. Bold/Italic/Underline via `document.execCommand` (reliable in Electron/Chromium). Font size = wrapping the selection in a `<span style="font-size:Npt">` for one of 4 presets: **Small 9pt · Normal 11pt · Large 14pt · Heading 18pt bold**.
- On change, the block's `innerHTML` is **DOMPurify-sanitized to a strict allowlist** — `b, strong, i, em, u, span[style: font-size only], p, br` — and stored. Anything else (scripts, tags, attrs, styles) is stripped. This is the security spine: the same HTML feeds PDF *and* DOCX.

## Descriptors (canned text)

- A **Descriptors** manager (add/edit/delete; each has a `name` + `body`) alongside the contact book.
- In a text block, **right-click** opens a menu listing descriptors by name; hovering/expanding shows a small **preview** of the body. Each entry offers **Insert text** (body only) and **Insert with title (bold)** (`<b>Name</b> — body`). The chosen text is inserted at the caret (then sanitized like any edit).

## Photo blocks

- Drag-drop an image onto the body (or `+ Photo`) → stored as a report asset → an `ImageBlock` with a default width. **Resize** via a handle (stores `widthPct`, a % of the page width so PDF/DOCX scale predictably). A **caption** field below renders in a smaller font.
- **Import from case:** pick a case → its image attachments list → selected ones copy their bytes into report assets as `ImageBlock`s.

## Export

- `report-html.ts` builds ONE sanitized HTML document: banner `<img>` → From/To header → blocks (text HTML as-is post-sanitize; images as `<figure><img width=..><figcaption>`). Used for both the live preview and PDF.
- **PDF:** `htmlToPdf(html)` → `saveBufferWithDialog`. Reuses `services/export.ts`.
- **DOCX:** `reports/docx.ts` (mirror `invoices/docx.ts`): a section with the banner image, From/To paragraphs, each text block parsed (b/i/u/size → OOXML runs), each image block as a `word/media` part + inline DrawingML + a caption paragraph in the smaller size.

## Architecture / files

- **Main:** `src/main/reports/store.ts` (reports + contacts + descriptors, encrypted-at-rest), `src/main/reports/report-html.ts` (report → sanitized HTML), `src/main/reports/docx.ts` (OOXML). Assets via the invoice-style asset store. IPC: `reports:list/read/save/delete`, `reports:contacts:*`, `reports:descriptors:*`, `reports:asset:put/get`, `reports:exportPdf`, `reports:exportDocx`, `reports:importCasePhotos`.
- **Renderer:** `src/renderer/modules/reports/ReportsModule.tsx` (saved-reports list + New), `ReportEditor.tsx` (header + toolbar + block list), `blocks/TextBlock.tsx` + `blocks/ImageBlock.tsx`, `ContactBook.tsx`, `DescriptorLibrary.tsx`, and a pure `rich-text.ts` (size map, selection formatting helpers, the sanitize allowlist, descriptor-insert builders).
- **Shared:** `src/shared/reports-types.ts` (Report / Block / Contact / Descriptor).
- **Registration:** `report` module key + Access-menu Organizer entry (5-point pattern).

## Security / charter

- **DOMPurify allowlist** on every text-block edit + at export (no HTML/CSS/script injection into PDF or DOCX). The single most important boundary.
- **Encrypt-at-rest:** `reports.json` + assets through secure-fs (like invoices/cases). `.gic`/export sanitised.
- **No new dependency** (execCommand + existing DOMPurify / adm-zip / printToPDF). **No egress.** Bounded image sizes + report/library counts (validator).

## Testing

- **Pure/unit:** `rich-text.ts` (preset→pt map, sanitize allowlist strips script/tags/attrs, descriptor-insert builders for both modes), `report-html.ts` (deterministic HTML, sanitized), `docx.ts` (OOXML structure — runs, media parts, figure/caption), block-model ops, store CRUD + encryption for reports/contacts/descriptors.
- **Live-verified (jsdom can't do real contentEditable/layout):** the typing + B/I/U/size interactions, drag-drop + resize, the descriptor right-click preview. Verified by GhostExodus, consistent with this session's UI work.
- `pnpm test` + `pnpm typecheck` green; grep the packaged asar for the module + `reports/docx`.

## Phasing (one spec, phased plan → ~8 TDD tasks)

1. `reports-types` + `store` (reports/contacts/descriptors CRUD + encryption + validator).
2. `report-html` + PDF export.
3. `reports/docx` DOCX export.
4. Editor shell + fixed header (banner upload, From/contact book, To/recipient).
5. Text blocks + rich text (B/I/U + preset sizes + sanitize).
6. Descriptor library + right-click insert (both modes, with preview).
7. Photo blocks (drag-drop, resize, caption) + import-from-case.
8. Module registration + Access-menu entry + wiring.

## Out of scope (YAGNI)

- Free-form page layout, tables, multi-column, page-break control beyond what PDF/DOCX give by default.
- Collaborative editing, versioning/track-changes.
- Auto-populating findings/entities from a case (only *photos* import in v1; text is authored).
- Numeric arbitrary point sizes (presets only), custom fonts, colored text.
- Signature capture (the invoice module has it; not requested here — add later if wanted).
