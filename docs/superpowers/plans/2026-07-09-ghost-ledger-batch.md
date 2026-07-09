# Ghost Ledger 98 Batch (v3.38.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the invoice module: add a real editable `.docx` export, show/remove uploaded logos + signature, style the signature upload as a button with a preview, and rebrand the module as **Ghost Ledger 98** with the operator's banner header.

**Architecture:** `.docx` is built by hand as an OOXML package with the already-present `adm-zip`, from the structured `Invoice` (reusing `calc.ts` so numbers foot with the PDF). The UI work is local to `InvoiceForm`/`SignaturePad`/`InvoicesModule`. The rename touches only display strings (the module *key* `invoices` is unchanged). No new dependency, no egress.

**Tech Stack:** Electron 33 + React + TypeScript, `adm-zip` (existing), vitest + @testing-library/react.

## Global Constraints

- **No new dependency.** `.docx` uses `adm-zip` (already used by `src/main/services/backup.ts`). No egress; all local.
- **Numbers foot with the PDF.** `.docx` totals reuse `calc.ts` (`lineHours`/`round2`/`computeTotals`/`formatMoney`).
- **XML-escape all user text** in `document.xml` (untrusted-into-XML fence).
- **Remove clears the ref only** — never delete the encrypted asset blob (a blob can be shared via `duplicateInvoice`).
- **Module key stays `invoices`** — only the display title/glyph + shortcut labels change (the `register-builtins` enumeration test asserts the *key* set, which is unchanged).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage the known-dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`). NEVER checkout/merge/delete branches or touch main — commit only on the feature branch; the controller merges.
- **Branch:** `feat/ghost-ledger-batch`.
- **Commands:** `pnpm test`, `pnpm typecheck`.

## File Structure

**New:** `src/main/invoices/docx.ts`, `test/invoice-docx.test.ts`.
**Modified:** `src/shared/ipc-contracts.ts` (+`exportDocx` channel+contract), `src/main/ipc/register.ts` (+handler), `src/preload/index.ts` + `src/preload/api.d.ts` (+method), `src/renderer/modules/invoices/InvoicesModule.tsx` (Export DOCX button + banner header + rename), `src/renderer/modules/invoices/InvoiceForm.tsx` (logo/signature preview + remove), `src/renderer/modules/invoices/SignaturePad.tsx` (upload-as-button), `src/renderer/modules/register-builtins.tsx` (title+glyph), `src/shared/types.ts` (2 shortcut labels), `src/renderer/styles/theme.css` (banner + preview boxes). **Asset already present:** `src/renderer/assets/ghost-ledger-banner.png`.

**Sequencing:** T1 docx builder → T2 docx IPC+button → T3 logo/signature preview+remove → T4 signature upload-button → T5 rename+banner. Each leaves the suite green.

---

### Task 1: `.docx` OOXML builder

**Files:** Create `src/main/invoices/docx.ts`; Test: `test/invoice-docx.test.ts`.

**Interfaces:**
- Consumes: `Invoice` (`@shared/invoice-types`); `lineHours`/`round2`/`computeTotals`/`formatMoney` (`../../renderer/modules/invoices/calc` — pure, importable from main). `AdmZip` (`adm-zip`).
- Produces: `renderInvoiceDocx(invoice: Invoice, assets: Record<string, string>): Buffer`.

- [ ] **Step 1: Write the failing test** `test/invoice-docx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { renderInvoiceDocx } from '../src/main/invoices/docx';
import type { Invoice } from '../src/shared/invoice-types';

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGWqXcQAAAAAElFTkSuQmCC';
const inv: Invoice = {
  id: 'i1', number: '0007', issueDate: '2026-07-09', currency: 'USD', rate: 20, taxPct: 10,
  sender: { name: 'Me', company: 'GI', logoRef: 'a.png' },
  client: { name: '<b>C</b>', company: 'Co' },
  lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon & <ops>' }],
  createdAt: 'x', updatedAt: 'x',
};

function docXml(buf: Buffer): string { return new AdmZip(buf).readAsText('word/document.xml'); }

describe('renderInvoiceDocx', () => {
  it('produces a valid zip with the required OOXML parts', () => {
    const zip = new AdmZip(renderInvoiceDocx(inv, {}));
    const names = zip.getEntries().map((e) => e.entryName);
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels']) {
      expect(names).toContain(p);
    }
  });
  it('document.xml carries the number, a line row and the footed total; user text is XML-escaped', () => {
    const xml = docXml(renderInvoiceDocx(inv, {}));
    expect(xml).toContain('0007');
    expect(xml).toContain('Recon &amp; &lt;ops&gt;');   // escaped
    expect(xml).not.toContain('Recon & <ops>');
    expect(xml).toContain('$77.00');                     // 3.5h*20=70 +10% tax
    expect(xml).toContain('&lt;b&gt;C&lt;/b&gt;');       // client name escaped
  });
  it('an image-bearing invoice writes a word/media part + a relationship', () => {
    const buf = renderInvoiceDocx(inv, { 'a.png': PNG });
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.startsWith('word/media/image'))).toBe(true);
    expect(zip.readAsText('word/_rels/document.xml.rels')).toMatch(/relationships\/image/);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-docx`.

- [ ] **Step 3: Implement** `src/main/invoices/docx.ts`:

```ts
/** Builds a real, editable OOXML .docx (a ZIP of XML parts) from a structured Invoice, using adm-zip
 *  (already a dep). Numbers reuse calc.ts so they foot with the PDF. All user text is XML-escaped.
 *  Images (logos/signature) become word/media parts + inline DrawingML runs. */
import AdmZip from 'adm-zip';
import type { Invoice } from '@shared/invoice-types';
import { lineHours, round2, computeTotals, formatMoney } from '../../renderer/modules/invoices/calc';

const EMU_PER_PX = 9525; // 1px @96dpi = 9525 EMU

function esc(s: string | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}
/** Read intrinsic pixel size from PNG (IHDR) or JPEG (SOF); fall back to 120x60 if unparseable. */
function imageSize(bytes: Buffer, mime: string): { w: number; h: number } {
  try {
    if (mime === 'image/png') return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
    // JPEG: scan for an SOF marker
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  } catch { /* fall through */ }
  return { w: 120, h: 60 };
}
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(image\/(png|jpe?g));base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], bytes: Buffer.from(m[3], 'base64') };
}

interface Media { rId: string; part: string; ext: string; bytes: Buffer; cx: number; cy: number }

function para(runs: string, pPr = ''): string { return `<w:p>${pPr}${runs}</w:p>`; }
function textRun(text: string, opts?: { bold?: boolean; size?: number }): string {
  const rPr = `<w:rPr>${opts?.bold ? '<w:b/>' : ''}${opts?.size ? `<w:sz w:val="${opts.size}"/>` : ''}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function imageRun(m: Media, id: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${m.cx}" cy="${m.cy}"/>`
    + `<wp:docPr id="${id}" name="img${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${m.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.cx}" cy="${m.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
function cell(inner: string): string { return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${inner}</w:tc>`; }
function rowOf(cells: string[]): string { return `<w:tr>${cells.map((c) => cell(c)).join('')}</w:tr>`; }

export function renderInvoiceDocx(invoice: Invoice, assets: Record<string, string>): Buffer {
  const { currency, rate, taxPct } = invoice;
  const media: Media[] = [];
  const addImage = (ref?: string): Media | null => {
    if (!ref || !assets[ref]) return null;
    const d = decodeDataUrl(assets[ref]);
    if (!d) return null;
    const { w, h } = imageSize(d.bytes, d.mime);
    const maxW = 130; const scale = w > maxW ? maxW / w : 1;
    const ext = d.mime === 'image/png' ? 'png' : 'jpg';
    const m: Media = { rId: `rIdImg${media.length + 1}`, part: `word/media/image${media.length + 1}.${ext}`, ext, bytes: d.bytes,
      cx: Math.round(w * scale * EMU_PER_PX), cy: Math.round(h * scale * EMU_PER_PX) };
    media.push(m); return m;
  };
  const senderLogo = addImage(invoice.sender.logoRef);
  const clientLogo = addImage(invoice.client.logoRef);
  const sigImg = addImage(invoice.signature?.signatureRef);
  let imgId = 1;

  const t = computeTotals(invoice.lines, rate, taxPct);
  const headRow = rowOf(['Date', 'Time', 'Description', 'Hours', 'Amount'].map((h) => para(textRun(h, { bold: true }))));
  const lineRows = invoice.lines.map((l) => {
    const h = lineHours(l);
    return rowOf([
      para(textRun(l.date)), para(textRun(`${l.start}–${l.end}`)), para(textRun(l.description)),
      para(textRun(String(h))), para(textRun(formatMoney(round2(h * rate), currency))),
    ]);
  }).join('');
  const tableXml = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>`
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')}</w:tblBorders>`
    + `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="1800"/>'.repeat(5)}</w:tblGrid>${headRow}${lineRows}</w:tbl>`;

  const body = [
    para(textRun(`INVOICE ${invoice.number}`, { bold: true, size: 40 })),
    para(textRun(`Date: ${invoice.issueDate}`)),
    senderLogo ? para(imageRun(senderLogo, imgId++)) : '',
    para(textRun('From', { bold: true })), para(textRun(invoice.sender.name)), para(textRun(invoice.sender.company)),
    para(textRun('To', { bold: true })), para(textRun(invoice.client.name)), para(textRun(invoice.client.company)),
    clientLogo ? para(imageRun(clientLogo, imgId++)) : '',
    tableXml,
    para(textRun(`Total hours: ${t.totalHours}`)),
    para(textRun(`Subtotal: ${formatMoney(t.subtotal, currency)}`)),
    taxPct ? para(textRun(`Tax: ${formatMoney(t.tax, currency)}`)) : '',
    para(textRun(`Total: ${formatMoney(t.total, currency)}`, { bold: true })),
    invoice.notes ? para(textRun(`Notes: ${invoice.notes}`)) : '',
    sigImg ? para(imageRun(sigImg, imgId++)) : '',
    invoice.signature?.signerName ? para(textRun(`${invoice.signature.signerName}  ${invoice.signature.signedDate ?? ''}  (Signature)`)) : '',
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + media.map((m) => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${m.part.split('image')[1]}"/>`).join('')
    + `</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRels, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf8'));
  for (const m of media) zip.addFile(m.part, m.bytes);
  return zip.toBuffer();
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-docx && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): OOXML .docx builder (adm-zip, footed via calc, escaped, images)`.

---

### Task 2: `exportDocx` IPC + preload + Export DOCX button

**Files:** Modify `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/renderer/modules/invoices/InvoicesModule.tsx`; Test: extend `test/invoice-ipc.test.ts`.

**Interfaces:**
- Consumes: `renderInvoiceDocx` (T1); `ensureInvoice` (existing); `loadAssetsFor` (existing in InvoicesModule).
- Produces: `channels.invoices.exportDocx = 'invoices:exportDocx'`; `window.api.invoices.exportDocx(args: { invoice: Invoice; assets: Record<string,string> }): Promise<string | null>`.

- [ ] **Step 1: Failing test** — add to `test/invoice-ipc.test.ts`:

```ts
it('exposes exportDocx', () => { expect(channels.invoices.exportDocx).toBe('invoices:exportDocx'); });
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-ipc`.

- [ ] **Step 3: Implement.**
  - `ipc-contracts.ts`: in the `invoices` channel block add `exportDocx: 'invoices:exportDocx'`; in `ChannelContract` add `[channels.invoices.exportDocx]: { args: [{ invoice: Invoice; assets: Record<string, string> }]; returns: string | null };`.
  - `register.ts`: `import { renderInvoiceDocx } from '../invoices/docx';` and after the `exportPdf` handler add:
```ts
  safeHandle(channels.invoices.exportDocx, async (...a) => {
    const { invoice, assets } = a[0] as { invoice: unknown; assets: Record<string, string> };
    const buf = renderInvoiceDocx(ensureInvoice(invoice), assets ?? {});
    const win = getWindow();
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: 'invoice.docx' }) : await dialog.showSaveDialog({ defaultPath: 'invoice.docx' });
    if (r.canceled || !r.filePath) return null;
    try { const st = await lstat(r.filePath); if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await writeFile(r.filePath, buf); return basename(r.filePath);
  });
```
  - `preload/index.ts` invoices block: add `exportDocx: (args: { invoice: unknown; assets: Record<string, string> }) => ipcRenderer.invoke(channels.invoices.exportDocx, args),`.
  - `api.d.ts`: mirror `exportDocx(args: { invoice: Invoice; assets: Record<string, string> }): Promise<string | null>`.
  - `InvoicesModule.tsx`: add an `exportDocx()` beside `exportPdf()`:
```ts
  async function exportDocx(): Promise<void> {
    if (!invoice) return;
    setBusy(true);
    try {
      const resolved = await loadAssetsFor(invoice);
      const filename = await window.api.invoices.exportDocx({ invoice, assets: resolved });
      if (filename) toast.success(`Exported ${filename}`);
    } finally { setBusy(false); }
  }
```
    and a button next to Export PDF: `<button disabled={busy} onClick={() => { void exportDocx(); }}>Export DOCX</button>`.

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(invoices): exportDocx IPC + preload + Export DOCX button`.

---

### Task 3: Logo + signature preview boxes with Remove

**Files:** Modify `src/renderer/modules/invoices/InvoiceForm.tsx`, `src/renderer/styles/theme.css`; Test: extend `test/invoice-form.test.tsx`.

**Interfaces:**
- Consumes: `assets` prop (ref→dataURL, existing); `setParty` (existing); `onChange`.

- [ ] **Step 1: Failing test** — add to `test/invoice-form.test.tsx` (mirror its harness): with `sender.logoRef='a.png'` and `assets={{'a.png':'data:image/png;base64,AAA'}}`, the From block renders an `<img>` with that src and a "Remove logo" control; clicking it emits an invoice whose `sender.logoRef` is undefined. With a `signature.signatureRef` + asset, a signature preview `<img>` + "Remove signature" appears; clicking clears `signatureRef`.

```tsx
it('shows a logo preview + Remove that clears the ref', () => {
  const onChange = vi.fn();
  const withLogo = { ...inv, sender: { ...inv.sender, logoRef: 'a.png' } };
  render(<InvoiceForm invoice={withLogo} assets={{ 'a.png': 'data:image/png;base64,AAA' }} onChange={onChange} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
  expect(screen.getByAltText('From logo')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Remove From logo'));
  expect(onChange.mock.calls[0][0].sender.logoRef).toBeUndefined();
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-form`.

- [ ] **Step 3: Implement.** In `InvoiceForm.tsx` `partyBlock`, after the Logo file input, add the preview box:
```tsx
        <div className="ga98-invoice-logo-box">
          {p.logoRef && assets[p.logoRef]
            ? <><img src={assets[p.logoRef]} alt={`${label} logo`} className="ga98-invoice-logo-img" />
                <button type="button" aria-label={`Remove ${label} logo`} className="ga98-invoice-img-remove"
                  onClick={() => setParty(which, { logoRef: undefined })}>✕</button></>
            : <span className="ga98-invoice-logo-empty">No logo</span>}
        </div>
```
  Add a signature preview + remove near the `<SignaturePad>` (the form already renders SignaturePad; wrap it): when `invoice.signature?.signatureRef && assets[invoice.signature.signatureRef]`, show `<img alt="Signature" className="ga98-invoice-sig-img">` + a `<button aria-label="Remove signature" onClick={() => onChange({ ...invoice, signature: { ...invoice.signature, signatureRef: undefined } })}>✕ Remove signature</button>`; else a "No signature" placeholder.
  `theme.css`: `.ga98-invoice-logo-box` (bordered inset box, min-height ~48px, position relative), `.ga98-invoice-logo-img`/`.ga98-invoice-sig-img { max-height: 44px; max-width: 100%; }`, `.ga98-invoice-img-remove` (small ✕ button, top-right), `.ga98-invoice-logo-empty` (muted centered "No logo").

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(invoices): logo + signature preview boxes with Remove`.

---

### Task 4: Signature "Upload signature" as a button

**Files:** Modify `src/renderer/modules/invoices/SignaturePad.tsx`, `src/renderer/styles/theme.css`; Test: extend `test/invoice-signature-pad.test.tsx`.

- [ ] **Step 1: Failing test** — assert the upload control renders as a button-styled element (a `.ga98-file-button` label), matching Clear:

```tsx
it('the upload control is a button-styled control, not bare text', () => {
  const onCapture = vi.fn();
  // render SignaturePad (existing harness), then:
  const up = container.querySelector('.ga98-file-button');
  expect(up).toBeTruthy();
  expect(up!.textContent).toMatch(/upload signature/i);
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-signature-pad`.

- [ ] **Step 3: Implement.** In `SignaturePad.tsx`, wrap the hidden file input in a label styled as a Win98 button: `<label className="ga98-file-button">Upload signature<input type="file" accept="image/png,image/jpeg" aria-label="Upload signature" onChange={upload} style={{ display: 'none' }} /></label>`. Add `theme.css` `.ga98-file-button` — replicate the 98.css button look (border, background, padding) so it sits beside the real `<button>Clear</button>` identically (e.g. `display:inline-block; border:1px outset #c0c0c0; background:#c0c0c0; padding:2px 10px; cursor:pointer; font-size:11px;` and an `:active` inset).

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(invoices): style Upload signature as a button matching Clear`.

---

### Task 5: Rename to Ghost Ledger 98 + banner header

**Files:** Modify `src/renderer/modules/register-builtins.tsx`, `src/shared/types.ts`, `src/renderer/modules/invoices/InvoicesModule.tsx`, `src/renderer/styles/theme.css`; Test: `test/invoices-module.test.tsx`, `test/register-builtins.test.ts` (title assertion).

**Interfaces:** Consumes the bundled `src/renderer/assets/ghost-ledger-banner.png` (already present).

- [ ] **Step 1: Failing test.** In `test/register-builtins.test.ts`, add: the `invoices` module's title is `'Ghost Ledger 98'` (keep the existing keys-set assertion unchanged). In `test/invoices-module.test.tsx`, assert the module renders a banner image (`<img>` with the ledger banner) at the top.

```ts
// register-builtins.test.ts
it('the invoices module is titled Ghost Ledger 98', () => {
  registerBuiltins();
  const m = listModules().find((x) => x.key === 'invoices');
  expect(m?.title).toBe('Ghost Ledger 98');
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test register-builtins invoices-module`.

- [ ] **Step 3: Implement.**
  - `register-builtins.tsx:270`: `registerModule({ key: 'invoices', title: 'Ghost Ledger 98', glyph: '📒', component: InvoicesAdapter, builtin: true, defaultWidth: 900, defaultHeight: 640 });` (key unchanged).
  - `types.ts:606` and `:628`: change `label: 'Invoices'` → `label: 'Ghost Ledger 98'` (both shortcut entries; `id`/`target` stay `invoices`).
  - `InvoicesModule.tsx`: `import bannerUrl from '../../assets/ghost-ledger-banner.png';` and render a header at the very top of the module's root: `<img src={bannerUrl} alt="Ghost Ledger 98" className="ga98-ledger-banner" />`.
  - `theme.css`: `.ga98-ledger-banner { display:block; margin:0 auto 6px; height:auto; width:auto; max-height:180px; max-width:100%; }`.

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(invoices): rename to Ghost Ledger 98 + banner header`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`.
- [ ] Whole-branch adversarial review — focus: the OOXML is well-formed (no unescaped user text; relationship ids match media parts; `document.xml.rels` Target matches the `word/media/image*` names); remove clears the ref (never deletes a shared blob); `exportDocx` validates the invoice + refuses symlinks; the rename kept the `invoices` *key* (persistence/shortcuts intact).
- [ ] Grep packaged `app.asar` for `invoices:exportDocx`, `ga98-ledger-banner`, `renderInvoiceDocx`, `Ghost Ledger 98`; confirm the banner PNG is in the packaged resources.
- [ ] Merge `feat/ghost-ledger-batch` → main (`--no-ff`); **hold the release** until the operator approves the finished build (per GhostExodus).

## Self-Review

- **Spec coverage:** .docx builder (T1) ✓; exportDocx IPC + button (T2) ✓; logo display+remove + signature preview+remove (T3) ✓; signature upload-as-button (T4) ✓; rename everywhere + banner header (T5) ✓; footed via calc (T1) ✓; XML-escape (T1) ✓; remove clears ref only (T3) ✓; key stays `invoices` (T5) ✓; banner centered/height-capped (T5) ✓.
- **Placeholder scan:** none — T1 carries the full builder; T2–T5 give exact edits + test code.
- **Type consistency:** `renderInvoiceDocx(invoice, assets)` stable T1→T2; `exportDocx` args shape `{ invoice, assets }` identical across contracts/preload/handler/module; `calc` fns reused unchanged.
- **Charter:** no new dep (adm-zip existing); no egress; XML-escape fence; remove is ref-only; persona identity; feature-branch-only commits.
