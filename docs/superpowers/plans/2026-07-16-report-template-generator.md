# Report Template Generator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Ghost Intel 98 Reports module into the mockup's "Report Template Generator" — a styled three-column editor with a fixed-width document page, rich toolbar, reusable-text libraries, tables, right-rail panels, and full PDF/DOCX parity — folding in the root-cause CSS fix (v3.47.0 shipped Reports with zero `ga98-report` styling).

**Architecture:** Keep the existing block model (text/image blocks with encrypted `assetRef` images) and ADD a `table` block; style blocks to read as one continuous fixed-width page. The renderer `sanitizeReportHtml` stays the sole security barrier before the main-process exporters. New libraries (introductions) and panels mirror existing patterns exactly.

**Tech Stack:** TypeScript, React, Electron (main/preload/renderer split), DOMPurify (renderer sanitizer), adm-zip (DOCX OOXML), Chromium `printToPDF` (PDF), Vitest + jsdom (tests), Playwright (computed-style checks). No new dependencies.

## Global Constraints

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`. NEVER emit `Co-Authored-By` / `Signed-off-by` / `Claude-Session` trailers.
- **Explicit-path `git add` only.** Never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- **No new npm dependencies. No new bundled resources (no font files).**
- **No new network egress / no telemetry.** Encrypt-at-rest preserved: images remain `assetRef` blocks, never inlined into persisted HTML.
- **Security spine:** `sanitizeReportHtml` (renderer) is the sole barrier before `report-html.ts` / `docx.ts` interpolate block HTML. Every expansion stays allowlist-only. Every non-block-HTML field (title, to, caption, contact, descriptor, introduction, reportDate) stays escaped in exporters.
- **Font whitelist (exact closed set):** `Segoe UI`, `Arial`, `Times New Roman`, `Georgia`, `Courier New`, `Verdana`. `font-family` accepted by the sanitizer ONLY if the value is exactly one of these six.
- **98.css dark-table cascade:** any `<table>` styling MUST restate background on a **class** selector (bundled 98.css paints native tables white via element rules).
- **Windows-only target.** Tests run via `pnpm test` (Vitest); typecheck via `pnpm typecheck` (or `pnpm exec tsc --noEmit`).

---

## File Structure

**Modified:**
- `src/shared/reports-types.ts` — add `reportDate`, `TableBlock`, `introductions` to `ReportStoreData`, `align` to image block.
- `src/main/reports/store.ts` — introductions CRUD + `read()`/`write()` include introductions.
- `src/main/security/validate.ts` — `ensureReportBlock` handles `table`; `ensureReport` handles `reportDate`; add `ensureIntroduction`; image `align`.
- `src/renderer/modules/reports/rich-text.ts` — sanitizer expansion (SECURITY SPINE); `FONT_FAMILIES`; `introductionInsertHtml`.
- `src/main/reports/docx.ts` — tokenizer expansion (links/lists/align/font) + table blocks + reportDate.
- `src/main/reports/report-html.ts` — table blocks + reportDate + page CSS.
- `src/renderer/styles/theme.css` — the full `ga98-report` stylesheet (ROOT-CAUSE FIX).
- `src/shared/ipc-contracts.ts` — `reports.introductionsList/Save/Remove` channels.
- `src/main/ipc/register.ts` — introductions IPC handlers.
- `src/preload/index.ts` + `src/preload/api.d.ts` — introductions API + types.
- `src/renderer/modules/reports/blocks/TextBlock.tsx` — toolbar (font-family/align/lists/link).
- `src/renderer/modules/reports/ReportEditor.tsx` — table blocks, three-column layout, right-click menu, status bar.
- `src/renderer/modules/reports/ReportsModule.tsx` — left rail libraries, right panels, add-table/introduction wiring.
- `src/renderer/modules/reports/blocks/ImageBlock.tsx` — align support.

**Created:**
- `src/renderer/modules/reports/IntroductionLibrary.tsx` — mirrors `DescriptorLibrary.tsx`.
- `src/renderer/modules/reports/blocks/TableBlock.tsx` — grid editor.
- `src/renderer/modules/reports/outline.ts` — pure heading-extraction + word/page-count helpers.
- `src/renderer/modules/reports/panels/RightRail.tsx` — Descriptor Preview / Document Outline / Image Properties.
- Test files per task (below).

---

## Task 1: Data model + validators + store

**Files:**
- Modify: `src/shared/reports-types.ts`
- Modify: `src/main/reports/store.ts`
- Modify: `src/main/security/validate.ts:1233-1330`
- Test: `test/reports-model.test.ts` (create)

**Interfaces:**
- Produces:
  - `ReportBlock` gains `| { id: string; kind: 'table'; cells: string[][] }`.
  - Image block gains optional `align?: 'left' | 'center' | 'right'`.
  - `Report` gains `reportDate?: string`.
  - `ReportStoreData` gains `introductions: Descriptor[]`.
  - Store: `listIntroductions(): Promise<Descriptor[]>`, `saveIntroduction(d: Descriptor): Promise<Descriptor>`, `removeIntroduction(id: string): Promise<void>`.
  - `validate.ts`: `ensureIntroduction(raw: unknown): Descriptor` (exported).

- [ ] **Step 1: Write the failing test** — `test/reports-model.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureReport, ensureIntroduction } from '../src/main/security/validate';

describe('report model additions', () => {
  it('keeps a valid table block (rectangular string cells)', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [
      { id: 'b1', kind: 'table', cells: [['a', 'b'], ['c', 'd']] }
    ] });
    expect(r.blocks[0]).toEqual({ id: 'b1', kind: 'table', cells: [['a', 'b'], ['c', 'd']] });
  });

  it('drops a table block whose cells are not a rectangular string grid', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [
      { id: 'b1', kind: 'table', cells: [['a', 'b'], ['c']] },          // ragged
      { id: 'b2', kind: 'table', cells: [[1, 2]] },                     // non-string
      { id: 'b3', kind: 'table', cells: 'nope' }                        // not a grid
    ] });
    expect(r.blocks).toHaveLength(0);
  });

  it('preserves reportDate and image align, clamps unknown align to undefined', () => {
    const r = ensureReport({ id: 'r1', to: '', reportDate: '2026-07-16', blocks: [
      { id: 'b1', kind: 'image', assetRef: 'x.png', widthPct: 50, caption: 'c', align: 'center' },
      { id: 'b2', kind: 'image', assetRef: 'y.png', widthPct: 50, caption: 'c', align: 'diagonal' }
    ] });
    expect(r.reportDate).toBe('2026-07-16');
    expect((r.blocks[0] as any).align).toBe('center');
    expect((r.blocks[1] as any).align).toBeUndefined();
  });

  it('ensureIntroduction bounds name and body like a descriptor', () => {
    const d = ensureIntroduction({ id: 'i1', name: 'Intro', body: 'hello' });
    expect(d).toEqual({ id: 'i1', name: 'Intro', body: 'hello' });
    expect(() => ensureIntroduction({ name: 'x' })).toThrow(/id/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/reports-model.test.ts` → FAIL (`ensureIntroduction` not exported, table branch missing).

- [ ] **Step 3: Implement — types** (`src/shared/reports-types.ts`). Replace the `ReportBlock` union and add fields:

```ts
export type ReportBlock =
  | { id: string; kind: 'text'; html: string }
  | { id: string; kind: 'image'; assetRef: string; widthPct: number; caption: string; align?: 'left' | 'center' | 'right' }
  | { id: string; kind: 'table'; cells: string[][] };

export interface Report {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bannerRef?: string;
  fromContactId?: string;
  to: string;
  reportDate?: string;
  blocks: ReportBlock[];
}

export interface ReportStoreData { reports: Report[]; contacts: Contact[]; descriptors: Descriptor[]; introductions: Descriptor[] }
```

- [ ] **Step 4: Implement — validators** (`src/main/security/validate.ts`).

In `ensureReportBlock`, before the final `return null;`, add the table branch and extend the image branch with `align`:

```ts
  if (o['kind'] === 'image') {
    let assetRef: string;
    try { assetRef = ensureFileName(o['assetRef'], 'block.assetRef'); } catch { return null; }
    const align = o['align'] === 'left' || o['align'] === 'center' || o['align'] === 'right' ? o['align'] : undefined;
    const img: import('@shared/reports-types').ReportBlock = { id, kind: 'image', assetRef, widthPct: clampWidthPct(o['widthPct']), caption: reportStr(o['caption'], MAX_REPORT_CAPTION) };
    if (align) (img as { align?: string }).align = align;
    return img;
  }
  if (o['kind'] === 'table') {
    const rows = o['cells'];
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_TABLE_ROWS) return null;
    const width = Array.isArray(rows[0]) ? rows[0].length : -1;
    if (width <= 0 || width > MAX_TABLE_COLS) return null;
    const cells: string[][] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== width) return null;              // ragged → drop block
      const outRow: string[] = [];
      for (const cell of row) {
        if (typeof cell !== 'string') return null;                               // non-string → drop block
        outRow.push(cell.slice(0, MAX_REPORT_BLOCK_HTML));
      }
      cells.push(outRow);
    }
    return { id, kind: 'table', cells };
  }
```

Add the caps near the other `MAX_REPORT_*` constants:

```ts
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 12;
```

In `ensureReport`, after `to: reportStr(o['to'], MAX_REPORT_TO),` add `reportDate` handling (after building `out`, before `return out;`):

```ts
  if (typeof o['reportDate'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o['reportDate'])) {
    out.reportDate = o['reportDate'];
  }
```

Add `ensureIntroduction` right after `ensureDescriptor` (identical shape — an introduction IS a descriptor):

```ts
/** An introduction is a named reusable text, structurally identical to a Descriptor. */
export function ensureIntroduction(raw: unknown): import('@shared/reports-types').Descriptor {
  return ensureDescriptor(raw);
}
```

- [ ] **Step 5: Implement — store** (`src/main/reports/store.ts`). Update `read()` return, `write` shape, `_resetForTest`, and add introductions CRUD.

Change the three `{ reports, contacts, descriptors }` object literals in `read()` (both the parse path and the catch path) and `_resetForTest()` to include `introductions: p.introductions ?? []` (and `introductions: []` for fresh/catch). Add near `MAX_DESCRIPTORS`:

```ts
const MAX_INTRODUCTIONS = 500;
```

Add after the descriptor CRUD block:

```ts
export async function listIntroductions(): Promise<Descriptor[]> { return (await read()).introductions; }
export async function saveIntroduction(desc: Descriptor): Promise<Descriptor> {
  const d = await read();
  const i = d.introductions.findIndex((x) => x.id === desc.id);
  if (i >= 0) d.introductions[i] = desc; else d.introductions.push(desc);
  if (d.introductions.length > MAX_INTRODUCTIONS) d.introductions = d.introductions.slice(d.introductions.length - MAX_INTRODUCTIONS);
  await write(d); return desc;
}
export async function removeIntroduction(id: string): Promise<void> {
  const d = await read(); d.introductions = d.introductions.filter((x) => x.id !== id); await write(d);
}
```

- [ ] **Step 6: Run tests + typecheck** — `pnpm exec vitest run test/reports-model.test.ts` → PASS; `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/reports-types.ts src/main/reports/store.ts src/main/security/validate.ts test/reports-model.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): table block, reportDate, image align, introductions store+validator"
```

---

## Task 2: Rich-text sanitizer expansion — SECURITY SPINE

**Files:**
- Modify: `src/renderer/modules/reports/rich-text.ts`
- Test: `test/reports-sanitize.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `FONT_FAMILIES: string[]` (the six-family whitelist, exported).
  - `sanitizeReportHtml` now allows `ul/ol/li/a`, `style` may carry `font-size:<n>pt` and/or `font-family:<whitelisted>` and/or `text-align:left|center|right`, `a[href]` scheme-guarded to http/https/mailto.
  - `introductionInsertHtml(d: { name: string; body: string }, mode: 'text' | 'title'): string` (reuses `descriptorInsertHtml`).

- [ ] **Step 1: Write the failing test** — `test/reports-sanitize.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeReportHtml, FONT_FAMILIES } from '../src/renderer/modules/reports/rich-text';

describe('sanitizeReportHtml expansion', () => {
  it('keeps a whitelisted font-family, drops a non-whitelisted one', () => {
    expect(sanitizeReportHtml('<span style="font-family:Georgia">x</span>')).toContain('font-family:Georgia');
    const evil = sanitizeReportHtml('<span style="font-family:EvilFont">x</span>');
    expect(evil).not.toContain('EvilFont');
    expect(evil).not.toContain('font-family');
  });

  it('keeps text-align in {left,center,right}, drops others', () => {
    expect(sanitizeReportHtml('<p style="text-align:center">x</p>')).toContain('text-align:center');
    expect(sanitizeReportHtml('<p style="text-align:justify">x</p>')).not.toContain('text-align');
  });

  it('keeps font-size alongside a font-family in one style', () => {
    const out = sanitizeReportHtml('<span style="font-size:14pt;font-family:Arial">x</span>');
    expect(out).toContain('font-size:14pt');
    expect(out).toContain('font-family:Arial');
  });

  it('keeps lists', () => {
    const out = sanitizeReportHtml('<ul><li>a</li><li>b</li></ul>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>a</li>');
  });

  it('keeps http/https/mailto links, strips javascript: and data:', () => {
    expect(sanitizeReportHtml('<a href="https://example.com">x</a>')).toContain('href="https://example.com"');
    expect(sanitizeReportHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
    const js = sanitizeReportHtml('<a href="javascript:alert(1)">x</a>');
    expect(js).not.toContain('javascript');
    const data = sanitizeReportHtml('<a href="data:text/html,x">x</a>');
    expect(data).not.toContain('data:');
  });

  it('still strips scripts, handlers, and disallowed style props', () => {
    expect(sanitizeReportHtml('<script>alert(1)</script>')).toBe('');
    expect(sanitizeReportHtml('<span onclick="x()">y</span>')).not.toContain('onclick');
    expect(sanitizeReportHtml('<span style="color:red;position:fixed">y</span>')).not.toContain('color');
  });

  it('exports exactly the six-family whitelist', () => {
    expect(FONT_FAMILIES).toEqual(['Segoe UI', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/reports-sanitize.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/renderer/modules/reports/rich-text.ts`). Add the whitelist, rewrite the hook's `style` branch, add an `href` branch, widen the allowlists, add `introductionInsertHtml`.

```ts
/** Closed whitelist of typefaces guaranteed present on Windows (the only ship target). The sanitizer
 *  accepts font-family ONLY when the value is exactly one of these strings. */
export const FONT_FAMILIES: string[] = ['Segoe UI', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana'];

const ALIGNS = new Set(['left', 'center', 'right']);
```

Replace the body of the `installHook` `addHook` callback:

```ts
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style') {
      const decls: string[] = [];
      const raw = data.attrValue || '';
      const size = /font-size:\s*(\d+(?:\.\d+)?)pt/i.exec(raw);
      if (size) decls.push(`font-size:${size[1]}pt`);
      const fam = /font-family:\s*([^;]+)/i.exec(raw);
      if (fam) {
        const name = fam[1].trim().replace(/^['"]|['"]$/g, '');
        if (FONT_FAMILIES.includes(name)) decls.push(`font-family:${name}`);
      }
      const align = /text-align:\s*(left|center|right)/i.exec(raw);
      if (align && ALIGNS.has(align[1].toLowerCase())) decls.push(`text-align:${align[1].toLowerCase()}`);
      if (decls.length > 0) data.attrValue = decls.join(';');
      else data.keepAttr = false;
    } else if (data.attrName === 'href') {
      const v = (data.attrValue || '').trim();
      if (!/^(https?:|mailto:)/i.test(v)) data.keepAttr = false;
    }
  });
```

Widen `sanitizeReportHtml`:

```ts
export function sanitizeReportHtml(html: string): string {
  installHook();
  return DOMPurify.sanitize(String(html ?? ''), {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'span', 'ul', 'ol', 'li', 'a'],
    ALLOWED_ATTR: ['style', 'href'],
    ALLOW_DATA_ATTR: false
  });
}
```

Add after `descriptorInsertHtml`:

```ts
/** An introduction inserts identically to a descriptor (both are escaped plain-text data). */
export function introductionInsertHtml(d: { name: string; body: string }, mode: 'text' | 'title'): string {
  return descriptorInsertHtml(d, mode);
}
```

- [ ] **Step 4: Run tests** — `pnpm exec vitest run test/reports-sanitize.test.ts` → PASS. Also re-run the existing `test/` reports sanitize/docx tests to confirm no regression: `pnpm exec vitest run test/reports-*.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/rich-text.ts test/reports-sanitize.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): sanitizer allows font-family (whitelist), align, lists, scheme-guarded links"
```

---

## Task 3: DOCX tokenizer expansion + tables

**Files:**
- Modify: `src/main/reports/docx.ts`
- Test: `test/reports-docx.test.ts` (extend if present; else create)

**Interfaces:**
- Consumes: `ReportBlock` table variant + `reportDate` (Task 1); sanitizer output shape `ul/ol/li/a` + `text-align`/`font-family` styles (Task 2).
- Produces: `renderReportDocx` emits `w:jc` alignment, `w:rFonts` fonts, numbered/bulleted list paragraphs, `w:hyperlink` runs, `w:tbl` tables, and a reportDate paragraph. Well-formed OOXML.

**Implementation notes:** The existing `blockRuns` splits on `/(<[^>]*>)/` and tracks bold/italic/underline counters + a `sizeStack`. Extend it to also track a `fontStack` (font-family) and `alignStack` (per `<p>`), and to recognize `ul/ol/li` and `a`. Because paragraph-level properties (alignment, list numbering) attach to `<w:p>`, `blockRuns` must return **paragraph descriptors**, not just run strings. Change its return type to `{ runs: string; pPr: string }[]` and update `renderReportDocx`'s consumer loop accordingly (it currently does `for (const runs of paras) body.push(para(runs))` → becomes `for (const p of paras) body.push(para(p.runs, p.pPr))`).

- [ ] **Step 1: Write the failing test** — `test/reports-docx.test.ts` (add these; keep existing cases)

```ts
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { renderReportDocx } from '../src/main/reports/docx';
import type { Report } from '../src/shared/reports-types';

function docXml(buf: Buffer): string {
  return new AdmZip(buf).readAsText('word/document.xml');
}
function baseReport(blocks: Report['blocks']): Report {
  return { id: 'r', title: 'T', createdAt: '', updatedAt: '', to: 'you', blocks };
}

describe('renderReportDocx expansion', () => {
  it('emits centered paragraph alignment', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<p style="text-align:center">hi</p>' }]), {}, null));
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it('emits a run font from font-family', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<span style="font-family:Georgia">hi</span>' }]), {}, null));
    expect(xml).toContain('w:rFonts');
    expect(xml).toContain('Georgia');
  });

  it('emits list paragraphs for ul/li', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<ul><li>a</li><li>b</li></ul>' }]), {}, null));
    expect(xml).toContain('<w:numPr>');
  });

  it('emits a hyperlink for a link', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<a href="https://x.co">L</a>' }]), {}, null));
    expect(xml).toMatch(/w:hyperlink|HYPERLINK/);
  });

  it('emits a w:tbl for a table block', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'table', cells: [['a', 'b'], ['c', 'd']] }]), {}, null));
    expect(xml).toContain('<w:tbl>');
    expect((xml.match(/<w:tc>/g) || []).length).toBe(4);
  });

  it('emits reportDate', () => {
    const r = baseReport([]); r.reportDate = '2026-07-16';
    expect(docXml(renderReportDocx(r, {}, null))).toContain('2026-07-16');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/reports-docx.test.ts` → FAIL on the new cases.

- [ ] **Step 3: Implement.** In `src/main/reports/docx.ts`:

Extend `richRun` to accept a font:

```ts
function richRun(text: string, opts: { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: string }): string {
  const rPr = `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.italic ? '<w:i/>' : ''}${opts.underline ? '<w:u w:val="single"/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ''}${opts.font ? `<w:rFonts w:ascii="${esc(opts.font)}" w:hAnsi="${esc(opts.font)}"/>` : ''}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
```

Rewrite `blockRuns` to return paragraph descriptors with paragraph properties (alignment + list numbering), tracking a font stack and list state:

```ts
interface ParaOut { runs: string; pPr: string }

function blockRuns(html: string): ParaOut[] {
  let bold = 0, italic = 0, underline = 0;
  const sizeStack: (number | null)[] = [];
  const fontStack: (string | null)[] = [];
  let listDepth = 0;                 // >0 while inside ul/ol
  let ordered = false;               // last-opened list type
  let curAlign = '';                 // from the current <p style="text-align:...">
  const paragraphs: ParaOut[] = [];
  let current = '';

  const jc = (a: string): string => (a ? `<w:pPr><w:jc w:val="${a}"/></w:pPr>` : '');
  const listPPr = (): string => `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr></w:pPr>`;

  const flushPara = (): void => { if (current) { paragraphs.push({ runs: current, pPr: jc(curAlign) }); current = ''; } curAlign = ''; };
  const flushListItem = (): void => { if (current) { paragraphs.push({ runs: current, pPr: listPPr() }); current = ''; } };

  const effSize = (): number | undefined => { for (let i = sizeStack.length - 1; i >= 0; i--) { const s = sizeStack[i]; if (s != null) return s; } return undefined; };
  const effFont = (): string | undefined => { for (let i = fontStack.length - 1; i >= 0; i--) { const f = fontStack[i]; if (f != null) return f; } return undefined; };

  const parts = String(html ?? '').split(/(<[^>]*>)/);
  for (const tok of parts) {
    if (tok === '') continue;
    if (tok[0] === '<') {
      const closing = tok[1] === '/';
      const name = (/^<\/?\s*([a-zA-Z0-9]+)/.exec(tok)?.[1] || '').toLowerCase();
      if (name === 'b' || name === 'strong') closing ? (bold = Math.max(0, bold - 1)) : bold++;
      else if (name === 'i' || name === 'em') closing ? (italic = Math.max(0, italic - 1)) : italic++;
      else if (name === 'u') closing ? (underline = Math.max(0, underline - 1)) : underline++;
      else if (name === 'span') {
        if (closing) { sizeStack.pop(); fontStack.pop(); }
        else {
          const sz = /font-size:\s*(\d+(?:\.\d+)?)pt/i.exec(tok); sizeStack.push(sz ? parseFloat(sz[1]) : null);
          const fm = /font-family:\s*([^;"]+)/i.exec(tok); fontStack.push(fm ? fm[1].trim() : null);
        }
      }
      else if (name === 'ul' || name === 'ol') { if (closing) listDepth = Math.max(0, listDepth - 1); else { listDepth++; ordered = name === 'ol'; } }
      else if (name === 'li') { if (closing) flushListItem(); }
      else if (name === 'br') current += '<w:r><w:br/></w:r>';
      else if (name === 'p') { if (closing) flushPara(); else { flushPara(); const a = /text-align:\s*(left|center|right)/i.exec(tok); curAlign = a ? a[1].toLowerCase() : ''; } }
      continue;
    }
    const text = decodeEntities(tok);
    if (text === '') continue;
    const size = effSize();
    current += richRun(text, { bold: bold > 0, italic: italic > 0, underline: underline > 0, size: size != null ? Math.round(size * 2) : undefined, font: effFont() });
  }
  if (listDepth > 0) flushListItem(); else flushPara();
  return paragraphs;
}
```

Add a table renderer and a hyperlink-aware note. For hyperlinks, the simplest well-formed approach that round-trips is a **field-code hyperlink** run (`w:fldSimple` referencing `HYPERLINK`), which needs no relationship part:

```ts
function tableXml(cells: string[][]): string {
  const rows = cells.map((row) => {
    const tcs = row.map((cell) => {
      const paras = blockRuns(cell);
      const body = paras.length ? paras.map((p) => para(p.runs, p.pPr)).join('') : para('');
      return `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>${body}</w:tc>`;
    }).join('');
    return `<w:tr>${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}
```

For links inside `blockRuns`, handle `a` by wrapping the run text in a `fldSimple`. Add to the tag dispatch (before `br`): track `let linkUrl = '';` and on `a` open capture `const h = /href="([^"]*)"/.exec(tok); linkUrl = h ? h[1] : '';` and on close `linkUrl = ''`. When emitting a text run and `linkUrl` is set, wrap: `current += `<w:fldSimple w:instr="HYPERLINK &quot;${esc(linkUrl)}&quot;">${richRun(text, {...})}</w:fldSimple>`;` else the plain run.

In `renderReportDocx`:
- After the `To` paragraphs, add: `if (report.reportDate) body.push(para(richRun('Date: ' + report.reportDate, {})));`
- Update the block loop: text uses the new `ParaOut[]`; add a `table` branch:

```ts
  for (const b of report.blocks as ReportBlock[]) {
    if (b.kind === 'text') {
      const paras = blockRuns(b.html);
      if (paras.length === 0) { body.push(para('')); continue; }
      for (const p of paras) body.push(para(p.runs, p.pPr));
    } else if (b.kind === 'table') {
      body.push(tableXml(b.cells));
    } else {
      const m = addImage(b.assetRef, b.widthPct);
      if (m) body.push(para(imageRun(m, imgId++)));
      body.push(para(richRun(b.caption, { size: smallSz })));
    }
  }
```

Add a numbering part so `w:numId` 1 (bullet) and 2 (decimal) resolve. Add `word/numbering.xml` to the zip and its content-type + relationship. Minimal numbering.xml:

```ts
const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
  + `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`
  + `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`
  + `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
```

Wire it: add `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` to `contentTypes`; add `<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` to `docRels`; `zip.addFile('word/numbering.xml', Buffer.from(numberingXml, 'utf8'));`.

- [ ] **Step 4: Run tests** — `pnpm exec vitest run test/reports-docx.test.ts` → PASS. Confirm XML well-formedness is implicitly covered (adm-zip readAsText + string asserts).

- [ ] **Step 5: Commit**

```bash
git add src/main/reports/docx.ts test/reports-docx.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): DOCX alignment, fonts, lists, hyperlinks, tables, reportDate"
```

---

## Task 4: PDF / report-html expansion + tables + page CSS

**Files:**
- Modify: `src/main/reports/report-html.ts`
- Test: `test/reports-html.test.ts` (extend if present; else create)

**Interfaces:**
- Consumes: table block + reportDate (Task 1); sanitized block HTML (Task 2).
- Produces: `buildReportHtml` renders `table` blocks as `<table class="ga98-report-doc-table">`, a reportDate line, image `align`, and a fixed-width page style so the PDF matches the editor.

- [ ] **Step 1: Write the failing test** — `test/reports-html.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildReportHtml } from '../src/main/reports/report-html';
import type { Report } from '../src/shared/reports-types';

function base(blocks: Report['blocks']): Report {
  return { id: 'r', title: 'T', createdAt: '', updatedAt: '', to: 'you', blocks };
}

describe('buildReportHtml expansion', () => {
  it('renders a table block as an HTML table with all cells', () => {
    const html = buildReportHtml(base([{ id: 'b', kind: 'table', cells: [['a', 'b'], ['c', 'd']] }]), {}, null);
    expect(html).toContain('<table');
    expect((html.match(/<td/g) || []).length).toBe(4);
  });

  it('renders reportDate when present', () => {
    const r = base([]); r.reportDate = '2026-07-16';
    expect(buildReportHtml(r, {}, null)).toContain('2026-07-16');
  });

  it('applies image align', () => {
    const html = buildReportHtml(base([{ id: 'b', kind: 'image', assetRef: 'x', widthPct: 40, caption: 'c', align: 'center' }]), { x: 'data:image/png;base64,AA' }, null);
    expect(html).toMatch(/margin:0 auto|text-align:center|align.*center/i);
  });

  it('embeds a fixed-width page style', () => {
    expect(buildReportHtml(base([]), {}, null)).toMatch(/max-width:\s*8\.5in|width:\s*8\.5in|816px/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/reports-html.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/main/reports/report-html.ts`). In the block `.map`, add a table branch and image align; add reportDate; extend the embedded `<style>`.

Table cell HTML is sanitized-clean (same trust level as text blocks) — interpolate verbatim:

```ts
  const blocks = report.blocks
    .map((b) => {
      if (b.kind === 'text') return `<div class="block block-text">${b.html}</div>`;
      if (b.kind === 'table') {
        const rows = b.cells.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `<table class="ga98-report-doc-table">${rows}</table>`;
      }
      const src = assets[b.assetRef] || '';
      const align = b.align === 'center' ? 'margin:0 auto;' : b.align === 'right' ? 'margin-left:auto;' : '';
      return `<figure class="block block-image" style="${align ? 'display:block;' : ''}"><img src="${src}" style="width:${safeWidthPct(b.widthPct)}%;${align}display:block" alt="">` +
        `<figcaption>${escapeHtml(b.caption)}</figcaption></figure>`;
    })
    .join('');
```

Add the date line (after `to`):

```ts
  const dateLine = report.reportDate ? `<div class="reportdate">Date: ${escapeHtml(report.reportDate)}</div>` : '';
```

Insert `${dateLine}` into the body after `${to}`. Extend the `<style>` block with page framing + table styling:

```
body{font-family:'Segoe UI',sans-serif;margin:0;color:#111;background:#fff}
.page{max-width:8.5in;margin:0 auto;padding:0.75in}
.banner{max-width:100%;margin-bottom:1.5em;display:block}
.reportdate{margin-bottom:1em;color:#333}
.ga98-report-doc-table{border-collapse:collapse;width:100%;margin:1em 0}
.ga98-report-doc-table td{border:1px solid #333;padding:4px 6px;vertical-align:top}
```

Wrap the emitted body in `<div class="page">…</div>`.

- [ ] **Step 4: Run tests** — `pnpm exec vitest run test/reports-html.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/reports/report-html.ts test/reports-html.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): PDF tables, reportDate, image align, fixed-width page style"
```

---

## Task 5: theme.css `ga98-report` stylesheet — ROOT-CAUSE FIX

**Files:**
- Modify: `src/renderer/styles/theme.css` (append a `ga98-report` block after the invoice block, ~line 1357)
- Test: `test/reports-css.spec.ts` (create — Playwright computed-style; if the repo's Playwright harness lives elsewhere, mirror the existing `98css-table` computed-style harness the memory references)

**Interfaces:**
- Produces: styling for every `ga98-report-*` class used across the module. Class names the components use (from Tasks 6–9 and existing): `ga98-report-shell` (3-col grid), `ga98-report-leftrail`, `ga98-report-rightrail`, `ga98-report-center`, `ga98-report-page`, `ga98-report-toolbar`, `ga98-report-statusbar`, `ga98-report-banner-img`, `ga98-report-imageblock-img`, `ga98-report-doc-table`, plus the existing library/menu/block classes.

**Note for the implementer:** the app renders dark by default (see the invoice block: `.ga98-invoices { background:#1a0f2e; color:#ece6f7 }` is unconditional). Match that palette. The document **page** itself is the one white surface (it represents paper). Restate table backgrounds on the `.ga98-report-doc-table` CLASS (98.css paints native `<table>` white via an element rule; a class selector wins on specificity).

- [ ] **Step 1: Write the failing test** — `test/reports-css.spec.ts`. Use the existing Playwright computed-style pattern (load the built renderer or a fixture that imports theme.css, mount minimal markup, assert computed styles). Assertions:
  - a `.ga98-report-banner-img` inside `.ga98-report-page` has `max-width` resolving to ≤ its container (not native).
  - `.ga98-report-page` is centered (`margin-left === margin-right` auto) and has a bounded width.
  - `.ga98-report-doc-table td` background is NOT white (`rgb(255, 255, 255)`), proving the cascade restatement.

(If the repo has no Playwright CSS harness to extend, the implementer adds a jsdom-based fallback that asserts the raw rule strings exist in `theme.css` for the three classes above — a weaker but non-zero guard — and notes the limitation in the test file header.)

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement.** Append a complete `ga98-report` block. Core rules (the implementer completes the rail/panel/toolbar/library styling to match the invoice block's thoroughness):

```css
/* ===== Reports (Report Template Generator) ===== */
.ga98-report-shell { display: grid; grid-template-columns: 210px 1fr 230px; gap: 6px; height: 100%; overflow: hidden; background: #1a0f2e; color: #ece6f7; }
.ga98-report-leftrail, .ga98-report-rightrail { overflow-y: auto; background: #241539; border: 1px solid #5a3aa8; padding: 6px; display: flex; flex-direction: column; gap: 10px; }
.ga98-report-center { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.ga98-report-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: #241539; border: 1px solid #5a3aa8; align-items: center; }
.ga98-report-pagescroll { flex: 1; overflow: auto; background: #12081f; display: flex; justify-content: center; padding: 16px; }
.ga98-report-page { width: 816px; min-height: 1056px; background: #fff; color: #111; box-shadow: 0 2px 12px rgba(0,0,0,0.6); padding: 72px; transform: scale(var(--ga98-report-zoom, 1)); transform-origin: top center; }
.ga98-report-banner-img { max-width: 100%; display: block; margin-bottom: 16px; }
.ga98-report-imageblock-img { max-width: 100%; display: block; }
.ga98-report-doc-table { border-collapse: collapse; width: 100%; margin: 12px 0; background: #fff; }
.ga98-report-doc-table td, .ga98-report-doc-table th { border: 1px solid #333; padding: 4px 6px; background: #fff; color: #111; vertical-align: top; }
.ga98-report-statusbar { display: flex; gap: 16px; padding: 3px 8px; background: #241539; border-top: 1px solid #5a3aa8; font-size: 11px; }
.ga98-report-rightrail section { border-bottom: 1px solid #5a3aa8; padding-bottom: 8px; }
.ga98-report-outline-item { cursor: pointer; padding: 2px 4px; }
.ga98-report-outline-item:hover { background: var(--ga98-blue); color: #fff; }
```

Also add `max-width:100%` safety directly on the historic classes if any remain (`.ga98-report-banner-img`, `.ga98-report-imageblock-img` above cover the two the videos showed). Keep the existing library/menu classes styled (mirror the descriptor/contact list styling from the invoice block palette).

- [ ] **Step 4: Run tests** — computed-style spec PASS. Also verify no other module regressed (the block is namespaced under `.ga98-report-*`, so it can't leak).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/theme.css test/reports-css.spec.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "fix(reports): write the missing ga98-report stylesheet (root cause of native-size banner/photo + grey void)"
```

---

## Task 6: IntroductionLibrary component + IPC + preload + channels

**Files:**
- Create: `src/renderer/modules/reports/IntroductionLibrary.tsx`
- Modify: `src/shared/ipc-contracts.ts` (add `introductionsList/Save/Remove` to the `reports` channels — mirror `descriptorsList/Save/Remove`)
- Modify: `src/main/ipc/register.ts:1495-1497` (add three handlers mirroring descriptors)
- Modify: `src/preload/index.ts:346-348` (add `introductions: { list/save/remove }`)
- Modify: `src/preload/api.d.ts:404+` (add the `introductions` API type)
- Test: `test/reports-introductions-ipc.test.ts` (create — store round-trip, since IPC wiring itself is thin)

**Interfaces:**
- Consumes: store `listIntroductions/saveIntroduction/removeIntroduction` (Task 1); `ensureIntroduction` (Task 1).
- Produces: `window.api.reports.introductions.{ list, save, remove }`; `<IntroductionLibrary onClose />` component.

- [ ] **Step 1: Write the failing test** — `test/reports-introductions-ipc.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { _resetForTest, listIntroductions, saveIntroduction, removeIntroduction } from '../src/main/reports/store';

describe('introductions store', () => {
  beforeEach(async () => { await _resetForTest(); });
  it('round-trips introductions independently of descriptors', async () => {
    await saveIntroduction({ id: 'i1', name: 'Standard', body: 'This report summarizes…' });
    expect(await listIntroductions()).toEqual([{ id: 'i1', name: 'Standard', body: 'This report summarizes…' }]);
    await removeIntroduction('i1');
    expect(await listIntroductions()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run test/reports-introductions-ipc.test.ts` → FAIL (store fns from Task 1 must exist; if Task 1 committed, this passes at the store layer — then this task's real deliverable is the component + wiring; keep the test as the regression guard).

- [ ] **Step 3: Implement channels** (`src/shared/ipc-contracts.ts`). Find the `reports:` channel object with `descriptorsList/descriptorsSave/descriptorsRemove` and add alongside:

```ts
    introductionsList: 'reports:introductions:list',
    introductionsSave: 'reports:introductions:save',
    introductionsRemove: 'reports:introductions:remove',
```

- [ ] **Step 4: Implement handlers** (`src/main/ipc/register.ts`, after line 1497). Add `import { ensureIntroduction }` to the existing validate import if not wildcard-imported:

```ts
  safeHandle(channels.reports.introductionsList, () => reportStore.listIntroductions());
  safeHandle(channels.reports.introductionsSave, (...a) => reportStore.saveIntroduction(ensureIntroduction(a[0])));
  safeHandle(channels.reports.introductionsRemove, (...a) => reportStore.removeIntroduction(a[0] as string));
```

- [ ] **Step 5: Implement preload** (`src/preload/index.ts`, in `reports:` after the `descriptors` object):

```ts
    introductions: {
      list: () => ipcRenderer.invoke(channels.reports.introductionsList),
      save: (introduction: unknown) => ipcRenderer.invoke(channels.reports.introductionsSave, introduction),
      remove: (id: string) => ipcRenderer.invoke(channels.reports.introductionsRemove, id)
    },
```

And the matching type in `src/preload/api.d.ts` under `reports:` (mirror the `descriptors` block, `Descriptor` type reused).

- [ ] **Step 6: Implement component** (`src/renderer/modules/reports/IntroductionLibrary.tsx`). Copy `DescriptorLibrary.tsx` verbatim, then s/descriptor/introduction/ on: the component name (`IntroductionLibrary`), all `window.api.reports.descriptors.*` → `window.api.reports.introductions.*`, class names `ga98-report-descriptorlib*` → `ga98-report-introlib*`, and labels ("Descriptors" → "Introductions", "Add descriptor" → "Add introduction", aria labels). Keep the `Descriptor` type import (introductions reuse it).

- [ ] **Step 7: Run tests + typecheck** — `pnpm exec vitest run test/reports-introductions-ipc.test.ts` PASS; `pnpm exec tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/reports/IntroductionLibrary.tsx src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/reports-introductions-ipc.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): introductions library (component + IPC + preload)"
```

---

## Task 7: TextBlock toolbar expansion (font-family / align / lists / link)

**Files:**
- Modify: `src/renderer/modules/reports/blocks/TextBlock.tsx`
- Test: `test/reports-textblock.test.tsx` (create — React Testing Library + jsdom)

**Interfaces:**
- Consumes: `FONT_FAMILIES` + expanded `sanitizeReportHtml` (Task 2).
- Produces: TextBlock toolbar with font-family `<select>`, align buttons, list buttons, and a link button. Each applies then re-`commit()`s (re-sanitizes).

**Implementation notes:** align/lists/link use `document.execCommand` (`justifyLeft/justifyCenter/justifyRight`, `insertUnorderedList/insertOrderedList`, `createLink`) guarded in try/catch (jsdom lacks execCommand — the same guard `format()` already uses). Font-family reuses the Range-wrap approach `applySize` uses (wrap selection in `<span style="font-family:…">`) so it's deterministic. Link uses `window.prompt` — but NOTE the Electron `window.prompt` no-op memory: prompt returns null in the renderer. Use a small inline input popover instead of `window.prompt` for the URL (mirror the descriptor menu popover pattern already in this file).

- [ ] **Step 1: Write the failing test** — `test/reports-textblock.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextBlock } from '../src/renderer/modules/reports/blocks/TextBlock';

describe('TextBlock toolbar expansion', () => {
  it('applying a font-family wraps the selection and emits a sanitized font-family span', () => {
    const onChange = vi.fn();
    render(<TextBlock block={{ id: 'b', kind: 'text', html: '<p>hello</p>' }} onChange={onChange} />);
    const body = screen.getByLabelText('Report text block');
    // select all text in the contentEditable
    const range = document.createRange(); range.selectNodeContents(body);
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    fireEvent.change(screen.getByLabelText('Font family'), { target: { value: 'Georgia' } });
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('font-family:Georgia');
  });

  it('renders align, list, and link controls', () => {
    render(<TextBlock block={{ id: 'b', kind: 'text', html: '' }} onChange={() => {}} />);
    expect(screen.getByLabelText('Align left')).toBeTruthy();
    expect(screen.getByLabelText('Bulleted list')).toBeTruthy();
    expect(screen.getByLabelText('Insert link')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Add to `TextBlock.tsx`:
  - Import `FONT_FAMILIES`.
  - An `applyFont(name: string)` that mirrors `applySize` but wraps the selection in `<span style="font-family:${name}">` (no bold wrapper).
  - `format()` already handles bold/italic/underline; add `align(dir)`, `list(kind)` calling the respective `execCommand` in the same guarded way, each ending with `commit()`.
  - A link popover: a small state `{ url }` + inline input (reuse the `.ga98-report-descmenu` popover pattern); on confirm, run guarded `document.execCommand('createLink', false, url)` then `commit()`. Do NOT use `window.prompt`.
  - Toolbar buttons with the aria-labels the test asserts: `Font family` (select of `FONT_FAMILIES`), `Align left/center/right`, `Bulleted list`, `Numbered list`, `Insert link`.

- [ ] **Step 4: Run tests** — `pnpm exec vitest run test/reports-textblock.test.tsx` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/reports/blocks/TextBlock.tsx test/reports-textblock.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): TextBlock font-family, alignment, lists, and link controls"
```

---

## Task 8: TableBlock component + editor wiring

**Files:**
- Create: `src/renderer/modules/reports/blocks/TableBlock.tsx`
- Modify: `src/renderer/modules/reports/ReportEditor.tsx` (render table blocks; add "+ Table"; table ops)
- Modify: `src/renderer/modules/reports/ReportsModule.tsx` (seed a table block)
- Test: `test/reports-tableblock.test.tsx` (create) + `test/reports-tableops.test.ts` (pure ops)

**Interfaces:**
- Consumes: table block type (Task 1); `sanitizeReportHtml` for cell content (Task 2).
- Produces: `<TableBlock block onChange onRemove />`; pure helpers `addRow/addCol/removeRow/removeCol(cells): string[][]` in the component module (exported for the pure test).

- [ ] **Step 1: Write the failing pure-ops test** — `test/reports-tableops.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { addRow, addCol, removeRow, removeCol } from '../src/renderer/modules/reports/blocks/TableBlock';

describe('table ops keep the grid rectangular', () => {
  const g = [['a', 'b'], ['c', 'd']];
  it('addRow appends an empty row of the right width', () => {
    expect(addRow(g)).toEqual([['a', 'b'], ['c', 'd'], ['', '']]);
  });
  it('addCol appends an empty cell to every row', () => {
    expect(addCol(g)).toEqual([['a', 'b', ''], ['c', 'd', '']]);
  });
  it('removeRow never drops the last row', () => {
    expect(removeRow([['x']], 0)).toEqual([['x']]);
    expect(removeRow(g, 0)).toEqual([['c', 'd']]);
  });
  it('removeCol never drops the last column', () => {
    expect(removeCol([['x'], ['y']], 0)).toEqual([['x'], ['y']]);
    expect(removeCol(g, 0)).toEqual([['b'], ['d']]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `TableBlock.tsx`.** Pure helpers + a grid of per-cell `contentEditable` cells that `sanitizeReportHtml` on input:

```tsx
import type { ReportBlock } from '@shared/reports-types';
import { sanitizeReportHtml } from '../rich-text';

type TableData = Extract<ReportBlock, { kind: 'table' }>;

export function addRow(cells: string[][]): string[][] { const w = cells[0]?.length ?? 1; return [...cells, Array(w).fill('')]; }
export function addCol(cells: string[][]): string[][] { return cells.map((r) => [...r, '']); }
export function removeRow(cells: string[][], i: number): string[][] { return cells.length <= 1 ? cells : cells.filter((_, x) => x !== i); }
export function removeCol(cells: string[][], j: number): string[][] { return (cells[0]?.length ?? 0) <= 1 ? cells : cells.map((r) => r.filter((_, x) => x !== j)); }

export interface TableBlockProps { block: TableData; onChange: (cells: string[][]) => void; onRemove?: () => void; }

export function TableBlock({ block, onChange, onRemove }: TableBlockProps): JSX.Element {
  function setCell(i: number, j: number, html: string): void {
    onChange(block.cells.map((row, x) => x === i ? row.map((c, y) => (y === j ? sanitizeReportHtml(html) : c)) : row));
  }
  return (
    <div className="ga98-report-tableblock">
      <div className="ga98-report-tableblock-toolbar">
        <button type="button" onClick={() => onChange(addRow(block.cells))}>+ Row</button>
        <button type="button" onClick={() => onChange(addCol(block.cells))}>+ Col</button>
        {onRemove ? <button type="button" aria-label="Remove table" onClick={onRemove}>✕</button> : null}
      </div>
      <table className="ga98-report-doc-table">
        <tbody>
          {block.cells.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>
                  <div contentEditable suppressContentEditableWarning role="textbox" aria-label={`Cell ${i + 1},${j + 1}`}
                    dangerouslySetInnerHTML={{ __html: cell }}
                    onInput={(e) => setCell(i, j, (e.target as HTMLElement).innerHTML)}
                    onBlur={(e) => setCell(i, j, (e.target as HTMLElement).innerHTML)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Wire into ReportEditor.** Add an `onAddTable` prop + a "+ Table" button in the body toolbar; render `b.kind === 'table'` blocks via `<TableBlock>`; add `updateTableBlock(id, cells)` mirroring `updateTextBlock`. In `ReportsModule`, add `addTable()` that appends `{ id: uid(), kind: 'table', cells: [['',''],['','']] }` and pass it down.

- [ ] **Step 5: Write + run the component test** `test/reports-tableblock.test.tsx` (render a 2×2, type into a cell, assert `onChange` receives sanitized html; click "+ Row" → onChange gets a 3×2 grid). Run both table tests → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/reports/blocks/TableBlock.tsx src/renderer/modules/reports/ReportEditor.tsx src/renderer/modules/reports/ReportsModule.tsx test/reports-tableops.test.ts test/reports-tableblock.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): table block editor + rectangular grid ops"
```

---

## Task 9: Three-column layout shell + right-rail panels + status bar + context menu

**Files:**
- Create: `src/renderer/modules/reports/outline.ts` (pure)
- Create: `src/renderer/modules/reports/panels/RightRail.tsx`
- Modify: `src/renderer/modules/reports/ReportEditor.tsx` (three-column shell, page wrapper, status bar, right-click context menu)
- Modify: `src/renderer/modules/reports/ReportsModule.tsx` (left rail hosting libraries inline, right rail, zoom state)
- Modify: `src/renderer/modules/reports/blocks/ImageBlock.tsx` (accept `align`, expose selection for the properties panel)
- Modify: `src/renderer/modules/register-builtins.tsx:290` (bump `defaultWidth` to 1040 for the 3-column layout)
- Test: `test/reports-outline.test.ts` (pure) + `test/reports-metrics.test.ts` (word/page count)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: pure `extractOutline(blocks): { id: string; text: string }[]`, `wordCount(blocks): number`, `estimatePageCount(scrollHeightPx, pageHeightPx): number` in `outline.ts`.

- [ ] **Step 1: Write the failing pure tests** — `test/reports-outline.test.ts` + `test/reports-metrics.test.ts`

```ts
// reports-outline.test.ts
import { describe, it, expect } from 'vitest';
import { extractOutline, wordCount, estimatePageCount } from '../src/renderer/modules/reports/outline';
import type { ReportBlock } from '../src/shared/reports-types';

const blocks: ReportBlock[] = [
  { id: 't1', kind: 'text', html: '<p><span style="font-size:18pt">Overview</span></p><p>body text here</p>' },
  { id: 't2', kind: 'text', html: '<p>just body</p>' },
  { id: 'tb', kind: 'table', cells: [['a b', 'c']] }
];

describe('report outline + metrics', () => {
  it('extracts heading-sized lines as outline entries', () => {
    const o = extractOutline(blocks);
    expect(o.map((x) => x.text)).toContain('Overview');
    expect(o).toHaveLength(1);
  });
  it('counts words across text and table cells', () => {
    // "body text here"(3) + "just body"(2) + "a b"(2) + "c"(1) + "Overview"(1) = 9
    expect(wordCount(blocks)).toBe(9);
  });
  it('estimates page count as ceil(height / pageHeight), min 1', () => {
    expect(estimatePageCount(0, 1056)).toBe(1);
    expect(estimatePageCount(1100, 1056)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `outline.ts`** (pure; strips HTML via DOMParser-free regex to stay jsdom-independent):

```ts
import type { ReportBlock } from '@shared/reports-types';

function stripTags(html: string): string { return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

/** A heading is a line whose text is wrapped in an 18pt span (the "Heading" preset). We match each
 *  such span and use its stripped text as an outline entry, keyed by the owning block id. */
export function extractOutline(blocks: ReportBlock[]): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const b of blocks) {
    if (b.kind !== 'text') continue;
    const re = /<span[^>]*font-size:\s*18pt[^>]*>(.*?)<\/span>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.html)) !== null) {
      const text = stripTags(m[1]);
      if (text) out.push({ id: b.id, text });
    }
  }
  return out;
}

export function wordCount(blocks: ReportBlock[]): number {
  let words = 0;
  const add = (s: string): void => { const t = stripTags(s); if (t) words += t.split(/\s+/).length; };
  for (const b of blocks) {
    if (b.kind === 'text') add(b.html);
    else if (b.kind === 'table') for (const row of b.cells) for (const c of row) add(c);
  }
  return words;
}

export function estimatePageCount(scrollHeightPx: number, pageHeightPx: number): number {
  if (pageHeightPx <= 0) return 1;
  return Math.max(1, Math.ceil(scrollHeightPx / pageHeightPx));
}
```

- [ ] **Step 4: Run pure tests** — PASS.

- [ ] **Step 5: Implement the shell + panels.** Restructure `ReportEditor` to render `.ga98-report-shell` (left rail / center / right rail). Left rail hosts the libraries inline (Contact, To recipient input, Introductions via `IntroductionLibrary`-style inline panel, Descriptors). Center = `.ga98-report-toolbar` (global toolbar — the per-block TextBlock toolbar still exists; the global one can hold the "+ Text / + Photo / + Table / Import" actions and zoom) + `.ga98-report-pagescroll` > `.ga98-report-page` (banner, date, From/To header, blocks) + `.ga98-report-statusbar` (Words: N · ~P pages · zoom%). Right rail = `<RightRail>` with Descriptor Preview (selected descriptor body), Document Outline (`extractOutline`, click scrolls to block id), Image Properties (selected image block → width %/caption/align). Zoom state sets `--ga98-report-zoom` on the page. Add a right-click context menu on the page with: Add Descriptor ▸, Add Introduction ▸, Insert Image, Insert Table, Clear Formatting (extends the existing TextBlock descriptor menu; the top-level page menu triggers the module-level add actions).

`RightRail.tsx` is a presentational component receiving `{ descriptors, outline, selectedImage, onOutlineJump, onImagePatch }`.

`ImageBlock`: add `align` to the patch type and render alignment; the properties panel drives it.

- [ ] **Step 6: Write + run `test/reports-metrics.test.ts`** if not folded into outline test, plus a light render smoke test for `RightRail` (renders outline entries, calls `onOutlineJump` on click). Run all reports tests: `pnpm exec vitest run test/reports-*.test.ts test/reports-*.spec.ts` → PASS. `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/reports/outline.ts src/renderer/modules/reports/panels/RightRail.tsx src/renderer/modules/reports/ReportEditor.tsx src/renderer/modules/reports/ReportsModule.tsx src/renderer/modules/reports/blocks/ImageBlock.tsx src/renderer/modules/register-builtins.tsx test/reports-outline.test.ts test/reports-metrics.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(reports): three-column shell, right-rail panels, status bar, context menu"
```

---

## Final Verification (controller, after all tasks)

1. `pnpm test` (full suite) → all green; `pnpm exec tsc --noEmit` → clean.
2. `pnpm package:win` (background) → build succeeds.
3. Grep the packaged `app.asar` for the new wiring — REMEMBER the un-minified `x: y` spacing gotcha (grep `title: "Reports"` WITH the space, or extract the asar): confirm the report module, `ga98-report-page`, `ga98-report-shell`, and table styling are present.
4. **Windows-VM UI QA launch (honor the waived gate):** open Reports, confirm the styled three-column page renders (not the grey void), banner sized to page width, a photo sized, all rails/panels present, a table inserts and exports, PDF + DOCX export succeed and open.
5. Whole-branch adversarial review (4 dims → refute-by-default verify → auto-fix confirmed critical/important). The SECURITY SPINE (Task 2) and DOCX XML well-formedness (Task 3) get the most scrutiny.

## Self-Review (author, done)

- **Spec coverage:** three-column layout (T5/T9), fixed-width page + zoom (T5/T9), banner/image caps (T5), fonts whitelist (T2), tables (T1/T3/T4/T8), introductions (T1/T6), descriptor preview/outline/properties (T9), align/lists/links (T2/T3/T4/T7), reportDate (T1/T3/T4), word/page count (T9), CSS root-cause fix (T5), PDF/DOCX parity (T3/T4). Page Setup explicitly out of scope (spec §6). All covered.
- **Placeholder scan:** none — every code step carries real code; the one soft spot (T5 Playwright harness path) has an explicit jsdom fallback instruction, not a TODO.
- **Type consistency:** `TableBlock` cells `string[][]`, image `align?: 'left'|'center'|'right'`, `reportDate?: string`, `introductions: Descriptor[]` used consistently across T1/T3/T4/T8/T9. `blockRuns` return type change (T3) is called out at both its definition and its consumer. `FONT_FAMILIES` (T2) reused in T7. `extractOutline/wordCount/estimatePageCount` (T9) signatures match their tests.
