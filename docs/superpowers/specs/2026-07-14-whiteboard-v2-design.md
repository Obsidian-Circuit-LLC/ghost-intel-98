# Whiteboard v2 — selectable file views, resizable nodes, color picker + naming — Design

**Date:** 2026-07-14
**Origin:** GhostExodus field request ("big ask") on the per-case Whiteboard (`WhiteboardModule`).
**Repo:** `/dcs98` (core). Target **v3.45.0**.

## The three features (operator-approved)

1. **Copy/highlight text in file views** — including PDF.
2. **Resizable nodes** on the board.
3. **Node color picker (7 presets + custom hex) + editable per-node name** in the header.

## Current state (grounding)

- `WhiteboardModule.tsx` — per-case pan/zoom canvas; nodes (`text/link/image/file`) with fixed `w/h`, edges, custom drag (no `react-rnd`). A `file` node double-click opens the **doc-viewer in a separate window**.
- Nodes already have a `color` field (typed "CSS hex", ≤16 chars in the validator) and a header **swatch that only cycles** the 7-preset palette. Header shows the node **type**, not a name.
- `WhiteboardNode` (`shared/types.ts`): `id/type/x/y/w/h/text?/url?/fileName?/color?`. Validator (`ensureWhiteboard`) clamps `w:[40,4000] h:[30,4000]`, `color`≤16.
- **Root cause of #1:** the app sets `user-select: none` globally (Win98 chrome feel); only `input/textarea/[contenteditable]/.ga98-selectable` opt back in (theme.css:21–31). The doc-viewer bodies don't, so their text can't be selected. PDF additionally renders to `<canvas>` with **no text layer**, so it's never selectable.

## Charter

- No new dependency (pdf.js text layer uses the already-bundled `pdfjs-dist` 5.x). No egress. Encrypt-at-rest unchanged (viewer reads decrypted bytes in-process as today). Board still autosaves to `caseDir/whiteboard.json` through `ensureWhiteboard`.

## Feature 1 — Selectable file views (doc-viewer)

- **HTML/text types** (`text/json/csv/html/docx/eml`): add `ga98-selectable` to the rendered body containers (`TextBody`/`JsonBody` `<pre>`, `CsvBody` table wrapper, `SanitizedHtml` div used by html/docx/eml). That flips `user-select: text` on, matching the Q / Mail read-pane pattern. Highlight + Ctrl+C + right-click Copy then work.
- **PDF**: render a **pdf.js text-layer overlay** over each page canvas. Wrap the canvas in a `position:relative` container; after `page.render(...)`, build a transparent selectable text layer from `page.streamTextContent()` positioned `inset:0` over the canvas (class `ga98-selectable ga98-pdf-textlayer`). Add the text-layer CSS (transparent absolutely-positioned spans) to `theme.css`. Result: PDF text selects/copies like a normal document.
- pdf.js 5.x API: use the `TextLayer` class (`new TextLayer({ textContentSource, container, viewport }).render()`). The implementer MUST verify the exact export/signature against the installed `pdfjs-dist@5.7.x` and adapt.

## Feature 2 — Resizable nodes

- Add a **bottom-right resize handle** (~14×14, `cursor: nwse-resize`) to each `NodeView`. `onMouseDown` on it starts a `resize` drag (new drag kind), `stopPropagation` so it doesn't pan/move.
- Global move handler: for `resize`, `w = clamp(origW + dx/scale)`, `h = clamp(origH + dy/scale)` (scale-aware). Min size `120×64`; the validator already caps the max.
- Extend the `drag` ref to carry the original size. Pure `clampNodeSize(w, h)` helper (unit-tested). Autosave already covers `w/h`.

## Feature 3 — Color picker + node naming

- **Color picker**: replace the cycle-on-click swatch with a **popover** opened from the header swatch — the 7 preset swatches to click **plus** an `<input type="color">` for a custom hex. Selecting sets `node.color` (a preset key OR a hex; both ≤16 chars, already validated).
  - `resolveNodeColor(color)` (pure): a known preset key → `{body, head}` from the palette; a hex (`/^#[0-9a-fA-F]{3,8}$/`) → `{ body: '#ffffff', head: hex }` (white body, custom accent); else default. Unit-tested.
- **Naming**: add `name?: string` to `WhiteboardNode` + validator (`wbStr(n['name'], 120)`). The header shows `node.name || node.type`; **double-click the header** to rename via the app `promptDialog` (electron-safe, not `window.prompt`). Pure `headerLabel(node)` helper.

## Files

- **Modify:** `src/shared/types.ts` (`name?`), `src/main/security/validate.ts` (sanitize `name`), `src/renderer/modules/whiteboard/WhiteboardModule.tsx` (resize + color picker + naming + `resolveNodeColor`/`clampNodeSize`/`headerLabel` helpers), `src/renderer/modules/doc-viewer/DocViewerModule.tsx` (selectable bodies + PDF text layer), `src/renderer/styles/theme.css` (PDF text-layer + resize-handle styles).
- **New tests:** validator `name`; `resolveNodeColor`/`clampNodeSize`/`headerLabel` (pure); doc-viewer body carries `ga98-selectable`.

## Testing / verification

- Pure helpers (`resolveNodeColor`, `clampNodeSize`, `headerLabel`) + the validator change are unit-tested.
- The `.ga98-selectable` opt-in is verified by a computed-style guard (the class computes `user-select: text`) + structural assertion that the doc-viewer bodies carry it.
- The **PDF text layer** and the **resize/color-picker UI interactions** are hard to exercise in jsdom (no real layout / pdf.js canvas) — verified structurally + by GhostExodus live, consistent with prior UI/visual fixes this session. `pnpm test` + `pnpm typecheck` green; grep the packaged asar for `ga98-pdf-textlayer` / the resize handle.

## Out of scope (YAGNI)

- Inline file preview *inside* a node (files still open in the doc-viewer window).
- Making the whiteboard node's own text-node content selectable while dragging (mousedown drags the node — separate interaction; not requested).
- Rich-text / annotation on the PDF (selection + copy only).
- Per-node font/size options beyond color + name.
