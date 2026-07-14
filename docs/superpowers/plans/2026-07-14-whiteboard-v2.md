# Whiteboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Selectable/copyable file views (incl. PDF), resizable whiteboard nodes, and a node color picker (presets + custom hex) with editable per-node names.

**Architecture:** Additive to the existing `WhiteboardModule` + `DocViewerModule`. Pure helpers (`resolveNodeColor`, `clampNodeSize`, `headerLabel`) carry the testable logic; DOM/pdf.js glue stays thin. Board schema gains one field (`name?`).

**Tech Stack:** Electron 33 + React + TS, bundled `pdfjs-dist@5.7.x`, vitest.

## Global Constraints

- No new dependency; no egress; encrypt-at-rest unchanged. Board autosaves through `ensureWhiteboard`.
- `WhiteboardNode.color` may be a preset key OR a CSS hex, both ≤16 chars (already validated). Node size is validator-clamped `w:[40,4000] h:[30,4000]`.
- The app is globally `user-select: none`; `.ga98-selectable` (theme.css) opts an element's text back into selection.
- Commit author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage pnpm-lock.yaml / resources/satellites/active-snapshot.tle / native/dcs98-confine/Cargo.lock / docs/superpowers/ideation/** / resources/local-ai/**.
- Branch `feat/whiteboard-v2`. Commit ONLY here; the controller merges.
- Commands: `pnpm test`, `pnpm typecheck`.

## File Structure

- Modify `src/shared/types.ts`, `src/main/security/validate.ts`, `src/renderer/modules/whiteboard/WhiteboardModule.tsx`, `src/renderer/modules/doc-viewer/DocViewerModule.tsx`, `src/renderer/styles/theme.css`.
- New pure helper module `src/renderer/modules/whiteboard/node-visual.ts` (`resolveNodeColor`, `clampNodeSize`, `headerLabel`, `NODE_COLORS`) so it's unit-tested and shared.
- New tests under `test/`.

**Sequencing:** T1 schema/validator → T2 node-visual helpers → T3 whiteboard resize + color-picker + naming (uses T2) → T4 doc-viewer selectable HTML/text → T5 PDF text layer. Each leaves the suite green.

---

### Task 1: Schema + validator — `name`

**Files:** Modify `src/shared/types.ts`, `src/main/security/validate.ts`; Test: extend `test/whiteboard-validate.test.ts` (create if absent, mirroring existing validate tests).

- [ ] **Step 1: Failing test** — `ensureWhiteboard` keeps a `name` (capped 120), preserves a hex `color`, clamps oversize `w/h`:
```ts
import { describe, it, expect } from 'vitest';
import { ensureWhiteboard } from '../src/main/security/validate';
it('keeps a bounded node name + hex color and clamps size', () => {
  const wb = ensureWhiteboard({ nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, w: 99999, h: 5, name: 'x'.repeat(500), color: '#ff8800' }], edges: [] });
  expect(wb.nodes[0].name).toHaveLength(120);
  expect(wb.nodes[0].color).toBe('#ff8800');
  expect(wb.nodes[0].w).toBe(4000);   // clamped max
  expect(wb.nodes[0].h).toBe(30);     // clamped min
});
```
- [ ] **Step 2:** Run → FAIL (`pnpm test whiteboard-validate`).
- [ ] **Step 3:** `types.ts` — add to `WhiteboardNode`: `/** Optional user-given label shown in the node header; falls back to the type. */ name?: string;`. `validate.ts` `ensureWhiteboard`, after the `color` line: `const name = wbStr(n['name'], 120); if (name !== undefined) node.name = name;`.
- [ ] **Step 4:** Run → PASS + `pnpm typecheck`.
- [ ] **Step 5:** Commit — `feat(whiteboard): node name field (schema + validator)`.

---

### Task 2: `node-visual.ts` pure helpers

**Files:** Create `src/renderer/modules/whiteboard/node-visual.ts`; Test: `test/whiteboard-node-visual.test.ts`.

**Produces:** `NODE_COLORS` (moved from WhiteboardModule), `resolveNodeColor(color?: string): { body: string; head: string }`, `clampNodeSize(w: number, h: number): { w: number; h: number }` (min 120×64), `headerLabel(node: { name?: string; type: string }): string`.

- [ ] **Step 1: Failing test**:
```ts
import { describe, it, expect } from 'vitest';
import { resolveNodeColor, clampNodeSize, headerLabel } from '../src/renderer/modules/whiteboard/node-visual';
it('resolveNodeColor: preset key, custom hex, fallback', () => {
  expect(resolveNodeColor('yellow')).toEqual({ body: '#fff9c4', head: '#f9a825' });
  expect(resolveNodeColor('#123abc')).toEqual({ body: '#ffffff', head: '#123abc' });
  expect(resolveNodeColor(undefined)).toEqual({ body: '#ffffff', head: '#607d8b' }); // default preset
  expect(resolveNodeColor('not-a-color')).toEqual({ body: '#ffffff', head: '#607d8b' });
});
it('clampNodeSize enforces a minimum', () => {
  expect(clampNodeSize(10, 10)).toEqual({ w: 120, h: 64 });
  expect(clampNodeSize(300, 200)).toEqual({ w: 300, h: 200 });
});
it('headerLabel prefers the name, else the type', () => {
  expect(headerLabel({ name: 'Finn photo', type: 'image' })).toBe('Finn photo');
  expect(headerLabel({ type: 'file' })).toBe('file');
  expect(headerLabel({ name: '  ', type: 'text' })).toBe('text'); // blank name → type
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:
```ts
export const NODE_COLORS: { key: string; body: string; head: string }[] = [
  { key: 'default', body: '#ffffff', head: '#607d8b' },
  { key: 'yellow', body: '#fff9c4', head: '#f9a825' },
  { key: 'green', body: '#e8f5e9', head: '#43a047' },
  { key: 'blue', body: '#e3f2fd', head: '#1e88e5' },
  { key: 'pink', body: '#fce4ec', head: '#d81b60' },
  { key: 'orange', body: '#ffe0b2', head: '#fb8c00' },
  { key: 'grey', body: '#cfd8dc', head: '#455a64' }
];
const HEX = /^#[0-9a-fA-F]{3,8}$/;
export function resolveNodeColor(color?: string): { body: string; head: string } {
  const preset = NODE_COLORS.find((c) => c.key === color);
  if (preset) return { body: preset.body, head: preset.head };
  if (color && HEX.test(color)) return { body: '#ffffff', head: color };
  return { body: NODE_COLORS[0].body, head: NODE_COLORS[0].head };
}
export function clampNodeSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(120, w), h: Math.max(64, h) };
}
export function headerLabel(node: { name?: string; type: string }): string {
  return node.name && node.name.trim() !== '' ? node.name : node.type;
}
```
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** Commit — `feat(whiteboard): pure node-visual helpers (color/size/label)`.

---

### Task 3: Whiteboard — resize handle + color picker + naming

**Files:** Modify `src/renderer/modules/whiteboard/WhiteboardModule.tsx`, `src/renderer/styles/theme.css`; Test: `test/whiteboard-node-visual.test.ts` already covers the helpers; add a small `test/whiteboard-module.test.tsx` render smoke if feasible (else rely on helper tests + live).

- [ ] **Step 1:** Import the helpers from `./node-visual`; DELETE the local `NODE_COLORS`/`nodeColor`/`nextColorKey` (now in node-visual; keep `center`). Use `resolveNodeColor(node.color)` in `NodeView`.
- [ ] **Step 2: Resize.** Extend the `drag` ref: `{ kind: 'pan' | 'node' | 'resize'; id?: string; startX: number; startY: number; orig: { x: number; y: number }; origSize?: { w: number; h: number } }`. Add a resize-handle `<div>` at the node's bottom-right (`onMouseDown`: `e.stopPropagation(); drag.current = { kind: 'resize', id: n.id, startX: e.clientX, startY: e.clientY, orig: { x: n.x, y: n.y }, origSize: { w: n.w, h: n.h } };`). In the global `onMove`, add: `else if (d.kind === 'resize' && d.id && d.origSize) { const s = clampNodeSize(d.origSize.w + dx / view.scale, d.origSize.h + dy / view.scale); setNodes((ns) => ns.map((n) => n.id === d.id ? { ...n, w: s.w, h: s.h } : n)); }`. Handle styled `.ga98-wb-resize` (absolute bottom-right, 14×14, `cursor: nwse-resize`).
- [ ] **Step 3: Color picker.** Replace the cycle swatch. Add per-node popover state (`const [colorMenu, setColorMenu] = useState<string | null>(null)` = node id). The header swatch `onMouseDown` (stopPropagation) opens the popover; render a small floating palette: the 7 `NODE_COLORS` swatches (click → `setNodeColor(n.id, key)`) + `<input type="color" onChange={(e) => setNodeColor(n.id, e.target.value)} />`. `setNodeColor(id, color)` = `setNodes((ns) => ns.map((x) => x.id === id ? { ...x, color } : x)); setColorMenu(null);`. Close on outside click (a fixed backdrop like the msgMenu pattern, or on blur).
- [ ] **Step 4: Naming.** Header shows `headerLabel(n)` instead of `n.type`. Double-click the header label → `const nm = await promptDialog('Name this item:', n.name ?? '', 'Rename'); if (nm !== null) setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, name: nm } : x));`. (Keep the existing text-node body double-click-to-edit-`text` separate.)
- [ ] **Step 5:** `theme.css` — `.ga98-wb-resize { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.35) 50%); }` and a `.ga98-wb-colormenu` popover style (small grid of swatches).
- [ ] **Step 6:** Run `pnpm test` + `pnpm typecheck`; commit — `feat(whiteboard): resizable nodes + color picker + per-node naming`.

---

### Task 4: Doc-viewer — selectable HTML/text bodies

**Files:** Modify `src/renderer/modules/doc-viewer/DocViewerModule.tsx`; Test: `test/doc-viewer-selectable.test.tsx` (render a text/html body, assert it carries `ga98-selectable`) + a computed-style guard in `test/css-layout-fixes.test.ts` (`.ga98-selectable` computes `user-select: text`).

- [ ] **Step 1: Failing test** — the `<pre>` from `TextBody` (or the SanitizedHtml div) has class `ga98-selectable`. (Render `ByteBody`/`TextBody` with a small byte buffer; jsdom is fine for structure.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `className="ga98-selectable"` to: `TextBody`'s `<pre>`, `JsonBody`'s `<pre>`, `CsvBody`'s table wrapper `<div style={{ overflow: 'auto' }}>`, and `SanitizedHtml`'s rendered `<div>` (covers html/docx/eml). Keep existing inline styles.
- [ ] **Step 4:** Run → PASS + typecheck.
- [ ] **Step 5:** Commit — `feat(doc-viewer): make text/HTML/CSV/DOCX bodies selectable + copyable`.

---

### Task 5: PDF text layer (selectable PDF)

**Files:** Modify `src/renderer/modules/doc-viewer/DocViewerModule.tsx`, `src/renderer/styles/theme.css`.

**PRE-FLIGHT:** verify the `pdfjs-dist@5.7.x` text-layer API before coding — `node -e "import('pdfjs-dist').then(m => console.log(Object.keys(m).filter(k => /text/i.test(k))))"`. In 5.x it is the `TextLayer` class: `new TextLayer({ textContentSource, container, viewport }).render()`. If the installed build exposes a different shape, adapt (do NOT invent an API).

- [ ] **Step 1:** In `PdfBody`'s render loop, wrap each page's `canvas` in a `pageWrap` div (`position: relative; margin: 8px auto; width/height = viewport`). Append the canvas to `pageWrap`.
- [ ] **Step 2:** After `await page.render({ canvas, viewport }).promise;`, build the text layer:
```ts
const textDiv = document.createElement('div');
textDiv.className = 'ga98-selectable ga98-pdf-textlayer';
pageWrap.appendChild(textDiv);
const textLayer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
await textLayer.render();
```
  (Set `textDiv` size to the viewport; the CSS positions it over the canvas.) Guard with try/catch so a text-layer failure never blanks the page render.
- [ ] **Step 3:** `theme.css` — the text-layer styles (pdf.js convention, inlined so no CSS import):
```css
.ga98-pdf-textlayer { position: absolute; inset: 0; overflow: hidden; line-height: 1; opacity: 1; }
.ga98-pdf-textlayer span { color: transparent; position: absolute; white-space: pre; transform-origin: 0 0; cursor: text; }
.ga98-pdf-textlayer ::selection { background: rgba(0, 90, 200, 0.35); }
```
- [ ] **Step 4:** `pnpm typecheck` (the `TextLayer` types come from pdfjs-dist). `pnpm test` (no new unit test — jsdom can't render pdf.js/canvas; the text-layer is verified live + typecheck). If a smoke test is feasible mocking pdfjsLib, add it; otherwise note the reliance.
- [ ] **Step 5:** Commit — `feat(doc-viewer): selectable PDF text layer (pdf.js TextLayer over the canvas)`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`. Grep packaged asar for `ga98-pdf-textlayer`, `ga98-wb-resize`, `resolveNodeColor`.
- [ ] Whole-branch adversarial review (focus: `resolveNodeColor` can't emit an unsanitized/injected color into a style; the PDF text layer can't break page rendering on failure; resize clamps + is scale-aware; `name` is bounded end-to-end; no `user-select: text` leaks onto draggable chrome).
- [ ] Merge `feat/whiteboard-v2` → main (`--no-ff`); ship v3.45.0.

## Self-Review

- **Spec coverage:** selectable HTML/text (T4) ✓ + PDF text layer (T5) ✓; resize (T3) ✓; color picker presets+hex (T2/T3) ✓; naming (T1/T3) ✓.
- **Placeholder scan:** pure helpers carry full code; the pdf.js API is pre-flight-verified, not assumed.
- **Type consistency:** `resolveNodeColor`/`clampNodeSize`/`headerLabel` signatures stable T2→T3; `name?` on `WhiteboardNode` used identically in validator + module.
