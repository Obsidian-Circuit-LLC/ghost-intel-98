# Chain of Custody Report Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A global Reports module — a structured-block document editor (logo banner, From-contact, To-recipient, rich-text + resizable captioned photo blocks, a right-click descriptor library) that exports to PDF and DOCX.

**Architecture:** Mirrors the invoice module. Main `reports/store.ts` persists three encrypted-at-rest libraries (reports/contacts/descriptors) + assets; `reports/report-html.ts` and `reports/docx.ts` export. The renderer is a block editor; the **security spine** is a dedicated `sanitizeReportHtml` (font-size-only style allowlist) applied at the store boundary. Pure helpers carry testable logic.

**Tech Stack:** Electron 33 + React + TS, DOMPurify (existing), adm-zip (existing), `htmlToPdf`. vitest.

## Global Constraints

- No new dependency; no egress; encrypt-at-rest via secure-fs (mirror `invoices/store.ts`: `secureReadText`/`secureWriteFile`). Bounded blocks/libraries + image sizes (validator). Export only via the OS save dialog (`saveBufferWithDialog`).
- **Security spine:** text-block HTML is `sanitizeReportHtml`-cleaned in the RENDERER at every edit before it is saved (main has no DOM/DOMPurify). Main builds report HTML from the stored (already-sanitized) block html + **escapes every plain field** (title/to/caption/contact/descriptor name) before it enters PDF HTML or DOCX XML. The existing `lib/sanitizeHtml` FORBIDS `style` — it is WRONG for this; use the new `sanitizeReportHtml`.
- **Reuse (exact):** `invoices/store.ts` shape (`read`/`write` via secure-fs, `putAsset(bytes,mime):Promise<string>`, `getAsset(ref):Promise<Asset|null>`, list/save/remove); `renderInvoiceDocx(invoice, assets):Buffer` pattern (`invoices/docx.ts` — media parts + DrawingML; copy the private `imageSize`/`decodeDataUrl`/`esc` helpers as `board-docx.ts` did); `htmlToPdf(html):Promise<Buffer>` + `saveBufferWithDialog`; `escapeHtml` (`main/whiteboard/board-export.ts`, exported); `loadAttachmentBytes` + `files.*` attachment IPC (import-from-case); module registration (`register-builtins.tsx`) + Access-menu **Organizer** entry (`AccessMenu.tsx`, `{ module: 'report', label: 'Reports' }`).
- Commit author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `-c` identity; `--no-verify`; NO AI trailers; explicit-path adds; never stage pnpm-lock.yaml / active-snapshot.tle / Cargo.lock / docs/superpowers/ideation/** / resources/local-ai/**.
- Branch `feat/report-generator`. Commit ONLY here; the controller merges. Commands: `pnpm test`, `pnpm typecheck`.

## File Structure

- Shared: `src/shared/reports-types.ts` (Report/Block/Contact/Descriptor).
- Main: `src/main/reports/store.ts`, `src/main/reports/report-html.ts`, `src/main/reports/docx.ts`; validator additions in `src/main/security/validate.ts`; IPC in `register.ts`/`ipc-contracts.ts`/preload.
- Renderer: `src/renderer/modules/reports/ReportsModule.tsx`, `ReportEditor.tsx`, `blocks/TextBlock.tsx`, `blocks/ImageBlock.tsx`, `ContactBook.tsx`, `DescriptorLibrary.tsx`, `rich-text.ts` (pure).

**Sequencing:** T1 types+store → T2 rich-text (sanitize/sizes/descriptor) → T3 report-html+PDF → T4 docx → T5 editor shell+header+contacts → T6 text blocks → T7 descriptors → T8 photos+import+registration.

---

### Task 1: Types + store + validator

**Files:** Create `src/shared/reports-types.ts`, `src/main/reports/store.ts`; Modify `src/main/security/validate.ts`; Test `test/reports-store.test.ts`.

**Interfaces (Produces):**
```ts
// reports-types.ts
export interface Contact { id: string; name: string; title?: string; org?: string; email?: string; phone?: string; address?: string; logoRef?: string }
export interface Descriptor { id: string; name: string; body: string }
export type ReportBlock =
  | { id: string; kind: 'text'; html: string }
  | { id: string; kind: 'image'; assetRef: string; widthPct: number; caption: string };
export interface Report { id: string; title: string; createdAt: string; updatedAt: string; bannerRef?: string; fromContactId?: string; to: string; blocks: ReportBlock[] }
export interface ReportStoreData { reports: Report[]; contacts: Contact[]; descriptors: Descriptor[] }
```
Store (mirror `invoices/store.ts`): `listReports/saveReport(r)/removeReport(id)`, `listContacts/saveContact/removeContact`, `listDescriptors/saveDescriptor/removeDescriptor`, `putAsset(bytes,mime):Promise<string>`, `getAsset(ref):Promise<{bytes:Buffer;mime:string}|null>`, `_resetForTest`. File `reports.json` + `report-assets/` in dataRoot via `secureReadText`/`secureWriteFile`.
Validator: `ensureReport`/`ensureContact`/`ensureDescriptor` — bound counts (≤500 reports/contacts/descriptors), string caps (title≤200, to≤400, block html≤50_000, caption≤500, descriptor body≤10_000, contact fields≤400), ≤400 blocks/report, widthPct clamp [10,100], block kind allowlist, assetRef/logoRef/bannerRef via `ensureFileName`.

- [ ] **Step 1: Failing test** `test/reports-store.test.ts` — save+list+remove a report; a contact; a descriptor; `ensureReport` clamps widthPct + caps title + drops an unknown block kind. (Mirror `test/invoices-store` if present; else use `_resetForTest` + the store fns directly with a mocked secure-fs like other store tests.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement types, store (copy `invoices/store.ts` structure), validator fns.
- [ ] **Step 4:** Run → PASS + `pnpm typecheck`.
- [ ] **Step 5:** Commit — `feat(reports): types + encrypted store (reports/contacts/descriptors) + validator`.

---

### Task 2: `rich-text.ts` — sanitizer + size map + descriptor insert (pure, SECURITY SPINE)

**Files:** Create `src/renderer/modules/reports/rich-text.ts`; Test `test/reports-rich-text.test.ts`.

**Produces:** `FONT_SIZES: { key:'small'|'normal'|'large'|'heading'; label:string; pt:number; bold?:boolean }[]` (small 9 · normal 11 · large 14 · heading 18 bold); `sanitizeReportHtml(html:string):string`; `descriptorInsertHtml(d:{name:string;body:string}, mode:'text'|'title'):string`.

- [ ] **Step 1: Failing test** `test/reports-rich-text.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeReportHtml, descriptorInsertHtml, FONT_SIZES } from '../src/renderer/modules/reports/rich-text';
describe('report rich text', () => {
  it('keeps b/i/u + font-size span, strips everything else', () => {
    const out = sanitizeReportHtml('<b>x</b><i>y</i><u>z</u><span style="font-size:14pt">big</span><p>p</p>');
    expect(out).toContain('<b>x</b>'); expect(out).toContain('<i>y</i>'); expect(out).toContain('<u>z</u>');
    expect(out).toContain('font-size:14pt'); expect(out).toContain('big');
  });
  it('strips script, event handlers, and non-font-size style props', () => {
    const out = sanitizeReportHtml('<script>bad()</script><span style="font-size:12pt;color:red;position:fixed" onclick="x()">t</span><img src=x onerror=y>');
    expect(out).not.toContain('script'); expect(out).not.toContain('onclick'); expect(out).not.toContain('onerror');
    expect(out).not.toContain('color'); expect(out).not.toContain('position'); expect(out).not.toContain('<img');
    expect(out).toContain('font-size:12pt'); expect(out).toContain('t'); // the safe part survives
  });
  it('descriptorInsertHtml: text mode = body only; title mode = bold name + body', () => {
    const d = { name: 'OSINT.Industries', body: 'A tool that finds public links.' };
    expect(descriptorInsertHtml(d, 'text')).toBe('A tool that finds public links.');
    const t = descriptorInsertHtml(d, 'title');
    expect(t).toContain('<b>OSINT.Industries</b>'); expect(t).toContain('A tool that finds public links.');
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `sanitizeReportHtml` uses DOMPurify with `ALLOWED_TAGS: ['b','strong','i','em','u','p','br','span']`, `ALLOWED_ATTR: ['style']`, and a `DOMPurify.addHook('uponSanitizeAttribute', ...)` (or `.sanitize` with a hook) that, for `style`, keeps ONLY a `font-size: <n>pt` declaration and drops the attribute otherwise. Escape descriptor `name`/`body` (reuse an escape) before wrapping; `text` mode returns the escaped body; `title` returns `<b>${escName}</b> — ${escBody}`.
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** Commit — `feat(reports): rich-text sanitizer (font-size-only) + size map + descriptor insert`.

---

### Task 3: `report-html.ts` + PDF export

**Files:** Create `src/main/reports/report-html.ts`; Modify `register.ts`/`ipc-contracts.ts`/preload; Test `test/reports-html.test.ts`.

**Produces:** `buildReportHtml(report: Report, assets: Record<string,string>, contact: Contact | null): string` (banner `<img src=dataUri>` if `bannerRef`; From = escaped contact fields; To = escaped `report.to`; blocks: text → the stored (already-sanitized) `html` verbatim, image → `<figure><img src=dataUri style="width:${widthPct}%"><figcaption>${escape(caption)}</figcaption></figure>`). `reportToPdf(report, assets, contact):Promise<Buffer>` = `htmlToPdf(buildReportHtml(...))`. Use the exported `escapeHtml` from `main/whiteboard/board-export.ts` for plain fields.

- [ ] **Step 1: Failing test** — buildReportHtml escapes `to`/caption/contact (a `to` of `<b>x` renders `&lt;b&gt;x`), embeds the banner + image data URIs, and passes a text block's sanitized `html` through unescaped (it's already safe). Assert banner precedes From precedes blocks.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS + typecheck.
- [ ] **Step 5:** IPC `reports:exportPdf(id)` → load report + assets (getAsset → data URI) + from-contact → `saveBufferWithDialog(win, `${report.title}.pdf`, await reportToPdf(...))`. Commit — `feat(reports): report→HTML + PDF export`.

---

### Task 4: `reports/docx.ts` — DOCX export

**Files:** Create `src/main/reports/docx.ts`; Modify `register.ts` (IPC); Test `test/reports-docx.test.ts`.

**Produces:** `renderReportDocx(report: Report, assets: Record<string,string>, contact: Contact | null): Buffer`.

- [ ] **Step 1: Failing test** — a report with a banner + a text block `<b>Bold</b> <span style="font-size:14pt">Big</span>` + an image+caption yields a valid docx zip: `word/document.xml` present, ≥1 `word/media/` part, the doc contains a bold run (`<w:b/>`) and the escaped caption + `to`; no raw `<script>`/unescaped markup.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (mirror `invoices/docx.ts`; copy its private `imageSize`/`decodeDataUrl`/`esc`): banner image part; From/To paragraphs (esc); each text block parsed by a small **constrained** HTML→runs parser — the html is limited to `b/strong/i/em/u/p/br/span[font-size]` by the sanitizer, so walk it with `DOMParser`… NO (main has no DOM). Instead parse with a tiny tokenizer over the known tag set: track bold/italic/underline/size state across `<b>`/`<i>`/`<u>`/`<span style="font-size:Npt">` open/close, emit a `<w:r>` per text run with `<w:rPr>` (`<w:b/>`/`<w:i/>`/`<w:u w:val="single"/>`/`<w:sz w:val="${pt*2}"/>`), XML-escape text; `<p>`/`<br>` → paragraph/break. (A regex/stack tokenizer over the 6-tag allowlist is tractable and unit-tested.) Each image block → media part + inline DrawingML at `widthPct` + a caption paragraph in the small size.
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** IPC `reports:exportDocx(id)`. Commit — `feat(reports): DOCX export (banner + rich runs + captioned images)`.

---

### Task 5: Editor shell + fixed header + contact book

**Files:** Create `src/renderer/modules/reports/ReportsModule.tsx`, `ReportEditor.tsx`, `ContactBook.tsx`; IPC bindings. Test `test/reports-module.test.tsx` (render smoke).

- [ ] **Step 1:** `ReportsModule` — saved-reports list (from `reports:list`) + "New report" + open → `ReportEditor`. `ReportEditor` — the fixed header: **banner** (upload → `reports:putAsset`, shows preview, Remove), **From** (a `<select>` of contacts + a "Manage contacts" button opening `ContactBook`), **To** (`<input>` bound to `report.to`). Debounced autosave (`reports:save`, 600ms, like the whiteboard). `ContactBook` — list + add/edit/delete (name/title/org/email/phone/address) via `reports:contacts:*`; "Use" sets `report.fromContactId`.
- [ ] **Step 2:** Render smoke test: the editor renders the banner slot, a From select, a To input; ContactBook lists a saved contact + calls save on add. (jsdom createRoot, mock `window.api.reports`.)
- [ ] **Step 3:** Commit — `feat(reports): editor shell + header (banner/From/To) + contact book`.

---

### Task 6: Text blocks + rich text

**Files:** Create `src/renderer/modules/reports/blocks/TextBlock.tsx`; wire the body toolbar in `ReportEditor.tsx`. Test: `test/reports-rich-text.test.ts` (T2) covers the pure helpers; add a `TextBlock` render smoke.

- [ ] **Step 1:** `+ Text` appends a `{kind:'text', html:''}` block. `TextBlock` is a `contentEditable` div bound to the block; the toolbar `[B][I][U]` call `document.execCommand('bold'|'italic'|'underline')`; `[Size ▾]` applies the chosen preset by wrapping the selection in a `<span style="font-size:${pt}pt">` (+ bold for heading). On `input`/blur → `sanitizeReportHtml(el.innerHTML)` → update the block → autosave. The stored html is thus always sanitized.
- [ ] **Step 2:** Smoke test: editing a text block runs its html through `sanitizeReportHtml` before save (spy the save; feed `<b>hi</b><script>`; assert saved html has `<b>hi</b>` and no `script`).
- [ ] **Step 3:** Commit — `feat(reports): rich-text blocks (B/I/U + preset sizes, sanitized on save)`.

---

### Task 7: Descriptor library + right-click insert

**Files:** Create `src/renderer/modules/reports/DescriptorLibrary.tsx`; extend `TextBlock.tsx` (context menu). Test: `test/reports-rich-text.test.ts` covers `descriptorInsertHtml`; add a descriptor-menu structural test.

- [ ] **Step 1:** `DescriptorLibrary` — list + add/edit/delete (name + body) via `reports:descriptors:*`. In `TextBlock`, `onContextMenu` (preventDefault) opens a menu listing descriptors by `name`; each shows a small **preview** (first ~120 chars of body) and two actions **Insert text** / **Insert with title** → `document.execCommand('insertHTML', false, descriptorInsertHtml(d, mode))` at the caret → re-sanitize on the ensuing input. Outside-click closes (window mousedown handler, transform-proof — mirror the whiteboard color-popover fix).
- [ ] **Step 2:** Structural test: the menu renders a descriptor name + preview + both insert buttons; clicking "Insert text" calls insert with the body.
- [ ] **Step 3:** Commit — `feat(reports): descriptor library + right-click insert (text / title) with preview`.

---

### Task 8: Photo blocks + import-from-case + registration

**Files:** Create `src/renderer/modules/reports/blocks/ImageBlock.tsx`; extend `ReportEditor.tsx`; Modify `register-builtins.tsx`, `AccessMenu.tsx`; IPC `reports:importCasePhotos`. Test: `test/register-builtins.test.ts` (module registered) + an ImageBlock resize-clamp unit.

- [ ] **Step 1:** `+ Photo` / drag-drop onto the body → `reports:putAsset` → `{kind:'image', assetRef, widthPct:60, caption:''}`. `ImageBlock` renders the image (getAsset → object URL), a **resize handle** (bottom-right, sets `widthPct` clamped [10,100], reuse a `clampPct` helper), and a caption `<input>` in a smaller font. **Import from case:** a button → pick a case (`cases:list`) → its image attachments (`files.*`) → selected ones `putAsset` (bytes via `loadAttachmentBytes`) → append ImageBlocks.
- [ ] **Step 2:** Register `report` module: `registerModule({ key:'report', title:'Reports', glyph:'📋', component: ReportsAdapter, builtin:true, defaultWidth:900, defaultHeight:680 })`; add `{ module:'report', label:'Reports' }` to the Organizer category in `AccessMenu.tsx`. Test: `register-builtins` lists the `report` key; `clampPct` unit.
- [ ] **Step 3:** Run `pnpm test` + `pnpm typecheck`; commit — `feat(reports): photo blocks (drag/resize/caption) + import-from-case + module registration`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`. Grep packaged asar for `report` module + `renderReportDocx` + `sanitizeReportHtml`.
- [ ] Whole-branch adversarial review (focus: `sanitizeReportHtml` truly strips script/handlers/non-font-size-style — no injection into PDF/DOCX; every plain field is escaped in report-html + docx; the docx html→runs tokenizer can't emit raw unescaped text or break on malformed input; widthPct/counts bounded; import-from-case copies only within the case + can't overwrite; no `window.prompt`; encrypt-at-rest preserved).
- [ ] Merge `feat/report-generator` → main (`--no-ff`); ship v3.47.0.

## Self-Review

- **Spec coverage:** libraries+store (T1) ✓; sanitizer/sizes/descriptor-insert (T2) ✓; PDF (T3) ✓; DOCX (T4) ✓; banner/From/To/contacts (T5) ✓; rich-text blocks (T6) ✓; descriptor right-click (T7) ✓; photo blocks+import+registration (T8) ✓; DOMPurify spine + escape-plain-fields ✓.
- **Placeholder scan:** security + pure units carry full code/tests; the docx tokenizer is specified over a fixed 6-tag allowlist (no open-ended "parse HTML").
- **Type consistency:** `Report`/`ReportBlock`/`Contact`/`Descriptor` stable T1→T8; `sanitizeReportHtml`/`descriptorInsertHtml`/`FONT_SIZES` T2→T6/T7; `renderReportDocx`/`buildReportHtml` signatures stable into the IPC.
