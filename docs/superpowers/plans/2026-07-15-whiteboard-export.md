# Whiteboard Export / Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Export a per-case Whiteboard to PDF and DOCX (visual snapshot + structured appendix) and round-trip the board as a portable `.gboard` file.

**Architecture:** The board rasterizes to a PNG **renderer-side** (a `<canvas>` draw from the existing node/edge coords); the PNG + board graph go to **main**, which builds the PDF (via the shared `htmlToPdf`) and DOCX (mirroring `invoices/docx.ts`), and reads/writes the portable `.gboard`. The appendix is plain node text → HTML-escaped in main (no DOMPurify needed; that's the report generator's concern).

**Tech Stack:** Electron 33 + React + TS; existing `htmlToPdf` (printToPDF), `adm-zip` (DOCX), the case attachment store; native canvas. vitest.

## Global Constraints

- No new dependency; no egress. Board-file assets are bounded (count + per-image size); import re-writes attachments through the vault (encrypt-at-rest preserved); export refuses a destination inside the encrypted store (mirror the docs-export guard). Node/edge counts validated by the existing `ensureWhiteboard`.
- Reuse: `htmlToPdf(html: string): Promise<Buffer>` (`src/main/services/export.ts`); `saveBufferWithDialog(win, defaultName, data): Promise<string|null>` (`src/main/ipc/register.ts:168`); `renderInvoiceDocx(invoice, assets): Buffer` pattern (`src/main/invoices/docx.ts` — media parts + DrawingML); `whiteboard.read/write` IPC; `fileStore.importDropped`/`readAttachmentBytes` (`src/main/storage/json-fs.ts`); `resolveNodeColor` (`src/renderer/modules/whiteboard/node-visual.ts`).
- Commit author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=… -c user.email=… commit --no-verify`; NO AI trailers; explicit-path adds; never stage pnpm-lock.yaml / resources/satellites/active-snapshot.tle / native/dcs98-confine/Cargo.lock / docs/superpowers/ideation/** / resources/local-ai/**.
- Branch `feat/whiteboard-export`. Commit ONLY here; the controller merges. Commands: `pnpm test`, `pnpm typecheck`.

## File Structure

- New: `src/shared/board-file.ts` (the `.gboard` type), `src/main/whiteboard/board-file.ts` (build/parse/validate), `src/main/whiteboard/board-export.ts` (appendix + PDF HTML), `src/main/whiteboard/board-docx.ts` (OOXML), `src/renderer/modules/whiteboard/board-raster.ts` (board → PNG). Tests under `test/`.
- Modify: `src/renderer/modules/whiteboard/WhiteboardModule.tsx` (toolbar), `src/main/ipc/register.ts` + `src/shared/ipc-contracts.ts` + `src/preload/*` (IPC), `src/main/security/validate.ts` (`ensureBoardFile`).

**Sequencing:** T1 board-file → T2 board-raster → T3 appendix+PDF → T4 DOCX → T5 toolbar+IPC wiring. Each leaves the suite green.

---

### Task 1: Portable board file (`.gboard`) — build / parse / validate

**Files:** Create `src/shared/board-file.ts`, `src/main/whiteboard/board-file.ts`; Modify `src/main/security/validate.ts`; Test `test/board-file.test.ts`.

**Interfaces:**
- Consumes: `WhiteboardNode`, `WhiteboardEdge`, `Whiteboard` (`@shared/types`); `ensureWhiteboard` (`../security/validate`).
- Produces: `BoardFile = { version: 1; nodes: WhiteboardNode[]; edges: WhiteboardEdge[]; assets: Record<string, string> }` (assets: on-disk `fileName` → base64 bytes). `buildBoardFile(board: Whiteboard, assets: Record<string,string>): BoardFile`. `ensureBoardFile(raw: unknown): BoardFile` (validate.ts — bounded: ≤2000 nodes via ensureWhiteboard, ≤2000 assets, each base64 ≤ 25 MB decoded; drops assets not referenced by any node fileName).

- [ ] **Step 1: Failing test** `test/board-file.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildBoardFile } from '../src/main/whiteboard/board-file';
import { ensureBoardFile } from '../src/main/security/validate';
const board = { nodes: [{ id: 'n1', type: 'image' as const, x: 0, y: 0, w: 200, h: 120, fileName: 'a.png', name: 'Photo' }], edges: [] };
describe('board file', () => {
  it('buildBoardFile embeds only referenced assets + version', () => {
    const f = buildBoardFile(board, { 'a.png': 'QUJD', 'orphan.png': 'ZZZ' });
    expect(f.version).toBe(1);
    expect(f.nodes).toHaveLength(1);
    expect(f.assets).toEqual({ 'a.png': 'QUJD' }); // orphan dropped
  });
  it('ensureBoardFile validates + bounds + round-trips a built file', () => {
    const f = ensureBoardFile(buildBoardFile(board, { 'a.png': 'QUJD' }));
    expect(f.nodes[0].name).toBe('Photo');
    expect(f.assets['a.png']).toBe('QUJD');
  });
  it('ensureBoardFile drops a giant asset + a non-string asset', () => {
    const big = 'A'.repeat(40 * 1024 * 1024); // ~30MB decoded > cap
    const f = ensureBoardFile({ version: 1, nodes: board.nodes, edges: [], assets: { 'a.png': big, 'b.png': 123 } });
    expect(f.assets['a.png']).toBeUndefined();
    expect(f.assets['b.png']).toBeUndefined();
  });
});
```
- [ ] **Step 2:** Run → FAIL (`pnpm test board-file`).
- [ ] **Step 3:** Implement.
  - `src/shared/board-file.ts`:
```ts
import type { WhiteboardNode, WhiteboardEdge } from './types';
export interface BoardFile {
  version: 1;
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
  /** on-disk attachment fileName → base64 of the (decrypted) image bytes, so the board is self-contained. */
  assets: Record<string, string>;
}
```
  - `src/main/whiteboard/board-file.ts`:
```ts
import type { Whiteboard } from '../../shared/types';
import type { BoardFile } from '../../shared/board-file';
/** Bundle a board + ONLY the assets its image/file nodes reference (drop orphans). Pure. */
export function buildBoardFile(board: Whiteboard, assets: Record<string, string>): BoardFile {
  const refs = new Set(board.nodes.map((n) => n.fileName).filter((f): f is string => !!f));
  const kept: Record<string, string> = {};
  for (const [name, b64] of Object.entries(assets)) if (refs.has(name)) kept[name] = b64;
  return { version: 1, nodes: board.nodes, edges: board.edges, assets: kept };
}
```
  - `validate.ts` — add near `ensureWhiteboard`:
```ts
const MAX_BOARD_ASSETS = 2000;
const MAX_ASSET_B64 = 34 * 1024 * 1024; // ~25 MB decoded
export function ensureBoardFile(raw: unknown): import('@shared/board-file').BoardFile {
  const o = (raw ?? {}) as { nodes?: unknown; edges?: unknown; assets?: unknown };
  const wb = ensureWhiteboard({ nodes: o.nodes, edges: o.edges }); // reuse node/edge validation
  const refs = new Set(wb.nodes.map((n) => n.fileName).filter((f): f is string => !!f));
  const assetsIn = (o.assets && typeof o.assets === 'object') ? o.assets as Record<string, unknown> : {};
  const assets: Record<string, string> = {};
  let n = 0;
  for (const [name, v] of Object.entries(assetsIn)) {
    if (n >= MAX_BOARD_ASSETS) break;
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ASSET_B64) continue;
    if (!refs.has(name)) continue; // only referenced assets
    assets[name] = v; n++;
  }
  return { version: 1, nodes: wb.nodes, edges: wb.edges, assets };
}
```
- [ ] **Step 4:** Run → PASS + `pnpm typecheck`.
- [ ] **Step 5:** Commit — `feat(whiteboard): portable .gboard file build + validate`.

---

### Task 2: `board-raster` — board → PNG (renderer)

**Files:** Create `src/renderer/modules/whiteboard/board-raster.ts`; Test `test/board-raster.test.ts`.

**Interfaces:**
- Consumes: `WhiteboardNode`, `WhiteboardEdge`; `resolveNodeColor`, `headerLabel` (`./node-visual`).
- Produces: `boardBounds(nodes): { minX, minY, maxX, maxY }` (empty → 0,0,400,300). `fitScale(w, h, max): number` (≤1). `drawBoard(ctx: CanvasRenderingContext2D, nodes, edges, images: Record<string, HTMLImageElement | undefined>, pad?: number): { width: number; height: number }` — pure draw. `boardToPng(nodes, edges, caseId): Promise<string>` (thin glue: load images, make a canvas, `drawBoard`, `canvas.toDataURL('image/png')`).

- [ ] **Step 1: Failing test** `test/board-raster.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { boardBounds, fitScale, drawBoard } from '../src/renderer/modules/whiteboard/board-raster';
const nodes = [
  { id: 'a', type: 'text' as const, x: 0, y: 0, w: 100, h: 60, text: 'hi', name: 'A' },
  { id: 'b', type: 'image' as const, x: 200, y: 100, w: 120, h: 90, fileName: 'p.png', name: 'B' }
];
const edges = [{ id: 'e', from: 'a', to: 'b' }];
describe('board raster', () => {
  it('boardBounds spans all nodes', () => {
    expect(boardBounds(nodes)).toEqual({ minX: 0, minY: 0, maxX: 320, maxY: 190 });
  });
  it('boardBounds defaults for an empty board', () => {
    expect(boardBounds([])).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
  });
  it('fitScale never upscales + caps to max', () => {
    expect(fitScale(4000, 100, 2000)).toBeCloseTo(0.5);
    expect(fitScale(100, 100, 2000)).toBe(1);
  });
  it('drawBoard strokes an edge line, fills node bodies + a header, draws text and an image', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, p: string) => {
      if (p === 'canvas') return { width: 0, height: 0 };
      return (...a: unknown[]) => { calls.push(p + (p === 'fillText' ? ':' + a[0] : '')); };
    } }) as unknown as CanvasRenderingContext2D;
    const img = { width: 10, height: 10 } as unknown as HTMLImageElement;
    drawBoard(ctx, nodes, edges, { 'p.png': img });
    expect(calls).toContain('moveTo'); expect(calls).toContain('lineTo'); expect(calls).toContain('stroke'); // edge
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThanOrEqual(2);                          // node bodies + headers
    expect(calls).toContain('fillText:A');                                                                   // node A label
    expect(calls).toContain('drawImage');                                                                    // image node
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `board-raster.ts`. `boardBounds` = min/max over `x,y,x+w,y+h` (empty → `{0,0,400,300}`). `fitScale(w,h,max)=Math.min(1, max/Math.max(w,h))`. `drawBoard(ctx, nodes, edges, images, pad=24)`:
  - Translate so `minX-pad,minY-pad` maps to 0; fill background (`#cfd8dc`) over the bounds+pad.
  - Edges: for each edge with both endpoints, `beginPath/moveTo(centerA)/lineTo(centerB)/stroke` (stroke `#37474f`).
  - Nodes: `fillRect` the body (`resolveNodeColor(n.color).body`), `fillRect` an 18px header (`.head`), `fillText(headerLabel(n))` in the header, then: text node → wrapped `fillText(n.text)`; image/file node → `drawImage(images[n.fileName], …)` if present, else `fillText('[image]')`; link → `fillText(n.url)`.
  - Return `{ width, height }` = scaled bounds (caller sizes the canvas). `boardToPng` loads each referenced image via `loadAttachmentBytes(caseId, fileName)` → `Blob` → `HTMLImageElement` (await decode), creates a canvas sized to `boardBounds`×`fitScale`, applies scale, `drawBoard`, returns `canvas.toDataURL('image/png')`.
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** Commit — `feat(whiteboard): board→PNG raster (renderer canvas)`.

---

### Task 3: Appendix HTML + PDF export

**Files:** Create `src/main/whiteboard/board-export.ts`; Test `test/board-export.test.ts`.

**Interfaces:**
- Consumes: `WhiteboardNode`, `WhiteboardEdge`; `htmlToPdf` (`../services/export`).
- Produces: `escapeHtml(s: string): string`; `boardAppendixHtml(nodes, edges): string`; `boardPdfHtml(pngDataUrl: string, nodes, edges): string`; `boardToPdf(pngDataUrl, nodes, edges): Promise<Buffer>` (= `htmlToPdf(boardPdfHtml(...))`).

- [ ] **Step 1: Failing test** `test/board-export.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { boardAppendixHtml, boardPdfHtml } from '../src/main/whiteboard/board-export';
const nodes = [
  { id: 'a', type: 'text' as const, x: 0, y: 0, w: 1, h: 1, name: 'Suspect', text: '<script>x</script> notes' },
  { id: 'b', type: 'file' as const, x: 0, y: 0, w: 1, h: 1, text: 'rap.pdf' }
];
const edges = [{ id: 'e', from: 'a', to: 'b' }];
describe('board export', () => {
  it('appendix escapes node text + lists connections by label', () => {
    const h = boardAppendixHtml(nodes, edges);
    expect(h).toContain('Suspect');
    expect(h).not.toContain('<script>');            // escaped
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('Suspect'); expect(h).toContain('rap.pdf');
    expect(h).toMatch(/Suspect.*(→|-&gt;).*rap\.pdf/s); // connection A → B by label
  });
  it('boardPdfHtml embeds the snapshot png then the appendix', () => {
    const h = boardPdfHtml('data:image/png;base64,AAAA', nodes, edges);
    expect(h).toContain('data:image/png;base64,AAAA');
    expect(h.indexOf('AAAA')).toBeLessThan(h.indexOf('Suspect')); // snapshot first
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `escapeHtml` (`& < > " '`). `boardAppendixHtml`: an `<h2>Nodes</h2>` list — each node `<p><b>{escape(name||type)}</b> ({type}): {escape(text||url||'')}</p>`; then `<h2>Connections</h2>` list — for each edge, the from/to nodes' `name||type`, `<p>{escape(fromLabel)} → {escape(toLabel)}</p>` (skip dangling). `boardPdfHtml(png, nodes, edges)` = a full `<html>` doc: `<img src="${png}" style="max-width:100%">` then `boardAppendixHtml(...)`. `boardToPdf` = `htmlToPdf(boardPdfHtml(...))`.
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** Commit — `feat(whiteboard): board appendix HTML + PDF export`.

---

### Task 4: DOCX export (`board-docx`)

**Files:** Create `src/main/whiteboard/board-docx.ts`; Test `test/board-docx.test.ts`.

**Interfaces:**
- Consumes: `WhiteboardNode`, `WhiteboardEdge`; the `adm-zip` + DrawingML pattern from `src/main/invoices/docx.ts` (READ it first).
- Produces: `renderBoardDocx(pngDataUrl: string, nodes, edges): Buffer`.

- [ ] **Step 1: Failing test** `test/board-docx.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { renderBoardDocx } from '../src/main/whiteboard/board-docx';
// a 1x1 png
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const nodes = [{ id: 'a', type: 'text' as const, x: 0, y: 0, w: 1, h: 1, name: 'Suspect', text: 'notes' }];
describe('board docx', () => {
  it('produces a valid docx zip with the snapshot media part + the appendix text', () => {
    const buf = renderBoardDocx(PNG, nodes, []);
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('word/document.xml');
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true); // the board snapshot image
    const doc = zip.getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('Suspect'); // appendix node
    expect(doc).toContain('<w:drawing'); // the inline image
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `renderBoardDocx` mirroring `invoices/docx.ts`: decode the PNG data URL → a `word/media/image1.png` part + a rId; a `word/document.xml` with an inline DrawingML run for the image, then appendix paragraphs (node names bold via `<w:b/>`, text runs, a Connections list) — XML-escape all text; assemble the standard `[Content_Types].xml` / `_rels` / `word/_rels/document.xml.rels` via `adm-zip` exactly as the invoice builder does. Reuse the invoice builder's `imageSize`/`decodeDataUrl`/EMU-scaling helpers (copy the small pure ones into board-docx or import if exported).
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** Commit — `feat(whiteboard): DOCX export (snapshot figure + appendix)`.

---

### Task 5: Toolbar + IPC wiring (export/import)

**Files:** Modify `src/renderer/modules/whiteboard/WhiteboardModule.tsx`, `src/main/ipc/register.ts`, `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`; Test: extend `test/documents-ipc-surface.test.ts`-style channel test → `test/whiteboard-export-ipc.test.ts`.

**Interfaces:**
- Consumes: `buildBoardFile`/`ensureBoardFile` (T1), `boardToPng` (T2), `boardToPdf`/`boardPdfHtml` (T3), `renderBoardDocx` (T4); `saveBufferWithDialog`, `fileStore.importDropped`/`readAttachmentBytes`, `whiteboard.read/write`.

- [ ] **Step 1:** IPC channels in `ipc-contracts.ts` `whiteboard`: `exportPdf: 'whiteboard:exportPdf'`, `exportDocx`, `exportFile`, `importFile`. Preload bindings + `api.d.ts` types: `exportPdf(caseId, { png, nodes, edges }): Promise<string|null>`, `exportDocx(...)`, `exportFile(caseId): Promise<string|null>`, `importFile(caseId): Promise<Whiteboard|null>`.
- [ ] **Step 2: register.ts handlers.**
  - `exportPdf`: `saveBufferWithDialog(getWindow(), 'board.pdf', await boardToPdf(png, nodes, edges))` (validate caseId via ensureUuid; nodes/edges via ensureWhiteboard).
  - `exportDocx`: same with `renderBoardDocx(...)` → `'board.docx'`.
  - `exportFile`: read the board (`whiteboard.read(caseId)`); for each referenced fileName, page `readAttachmentBytes` → base64 → assets map; `buildBoardFile(board, assets)`; `saveBufferWithDialog(getWindow(), 'board.gboard', Buffer.from(JSON.stringify(file)))`. (saveBufferWithDialog already writes outside the vault via the OS dialog — no in-store leak.)
  - `importFile`: open dialog to read a `.gboard`; `ensureBoardFile(JSON.parse(...))`; for each asset, `fileStore.importDropped`-style write into the case (bytes from base64) → get the new fileName; remap node.fileName → new name; `whiteboard.write(caseId, ensureWhiteboard({ nodes: remapped, edges }))`; return the board.
- [ ] **Step 3:** `WhiteboardModule` toolbar — after "Reset view": an **Export ▾** control (buttons: PDF, DOCX, Board file) and **Import board**. PDF/DOCX: `const png = await boardToPng(nodes, edges, caseId); await window.api.whiteboard.exportPdf(caseId, { png, nodes, edges });` (toast on save/cancel). Board file: `window.api.whiteboard.exportFile(caseId)`. Import: `const b = await window.api.whiteboard.importFile(caseId); if (b) { setNodes(b.nodes); setEdges(b.edges); }`.
- [ ] **Step 4: Test** `test/whiteboard-export-ipc.test.ts` — the four channels are declared; and a store-level `ensureBoardFile` import remaps a node's fileName + drops an unreferenced asset (unit, no electron). Assert export refuses nothing extra (saveBufferWithDialog is the boundary).
- [ ] **Step 5:** Run `pnpm test` + `pnpm typecheck`; commit — `feat(whiteboard): Export ▾ (PDF/DOCX/board file) + Import board wiring`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`. Grep packaged asar for `whiteboard:exportPdf`, `board-raster`, `renderBoardDocx`.
- [ ] Whole-branch adversarial review (focus: appendix HTML escapes all node text — no injection into PDF/DOCX; `ensureBoardFile` bounds assets + drops orphans/oversize; import remap can't collide/overwrite unrelated attachments or escape the case; export writes only via the OS dialog, never inside the vault; a dangling edge is skipped in the appendix).
- [ ] Merge `feat/whiteboard-export` → main (`--no-ff`); ship v3.46.0.

## Self-Review

- **Spec coverage:** portable .gboard (T1) ✓; board→PNG (T2) ✓; snapshot+appendix PDF (T3) ✓; DOCX (T4) ✓; toolbar Export▾/Import + IPC + import remap (T5) ✓; bounded assets + vault-safe (T1 validator + T5 dialog) ✓.
- **Placeholder scan:** pure units carry full code; T3/T4/T5 wiring reuses named existing fns (htmlToPdf/renderInvoiceDocx pattern/saveBufferWithDialog/importDropped).
- **Type consistency:** `BoardFile` shape stable T1→T5; `boardToPng`/`boardToPdf`/`renderBoardDocx` names stable; `ensureBoardFile` reused in import.
