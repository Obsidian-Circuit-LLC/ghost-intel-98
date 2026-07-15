# Whiteboard Export / Import — Design

**Date:** 2026-07-15
**Origin:** GhostExodus request — export a per-case Whiteboard to PDF/DOCX and move boards around as a file.
**Repo:** `/dcs98` (core). Target a release after / alongside the report generator (shares export infra).

## What it is

Three actions on the per-case Whiteboard: **Export → PDF**, **Export → DOCX**, and a round-trippable **board file** (export + import). The board is a spatial canvas of nodes (text/link/image/file, with names + colors from v3.45.0) and connecting edges; export produces a **visual snapshot** of the board **plus a structured text appendix** of every node and connection.

## Operator decisions (2026-07-15)

- **Export = snapshot + appendix** (both): the visual board image first, then a structured node/edge list behind it.
- **Import = portable board file**: export/import the board itself as a self-contained file, so a board can move between cases/machines, be shared, or backed up.

## The shared piece: board → PNG raster

A board doesn't map to a page directly, so we rasterize it once and reuse the PNG in **both** exports.

- `board-raster.ts` (renderer): given `nodes`, `edges`, and the decrypted image bytes for image/file nodes, draw the board onto an off-screen `<canvas>` — compute the bounding box of all nodes, fill a background, draw edges as lines between node centers, draw each node (a header bar tinted via the existing `resolveNodeColor(node.color)`, the node `name`/type, and either wrapped body text or the drawn image), then scale to a max dimension. Returns PNG bytes. No new dependency (native canvas). Pure-ish (canvas context injectable) → the draw logic is unit-tested against a mock 2D context.
- Images come from `loadAttachmentBytes(caseId, fileName)` → `Image` → `drawImage` (same source the board already renders from).

## Export → PDF

`board-export.ts` builds one **sanitized** HTML doc: the board PNG (`<img>`, fit-to-page width) + a structured appendix — each node as `Name (type): text` and a Connections list (`A → B`). Node text is DOMPurify-sanitized. Then `htmlToPdf(html)` (existing `services/export.ts`) → `saveBufferWithDialog`.

## Export → DOCX

`board-docx.ts` (mirror `invoices/docx.ts`): a section with the board PNG as a `word/media` part + inline DrawingML figure, then the same structured appendix as OOXML paragraphs (node names bold, body text, a Connections list). adm-zip, already a dependency.

## Board file (portable, round-trippable)

- **Export:** bundle `{ version, nodes, edges, assets: { [fileName]: base64 } }` — the board graph **plus the referenced image bytes embedded**, so the file is self-contained. Save via dialog as `<caseTitle>-board.gboard` (JSON). Refuse a destination inside the encrypted store (mirror the docs-export guard) — an export is plaintext by design.
- **Import:** pick a `.gboard` into a case → re-import each embedded asset as a case attachment (reuse `importDropped`-style bytes write) → remap the node `fileName` refs to the new attachment names → merge/replace the case's `whiteboard.json`. Validated through `ensureWhiteboard` (bounded counts, sanitized strings) on write.

## UI

- Whiteboard toolbar gains: **Export ▾** (PDF · DOCX · Board file…) and **Import board…**. Small additions to the existing `WhiteboardModule` toolbar; the heavy lifting is in the main-side builders + the renderer raster helper.

## Architecture / files

- **Main:** `src/main/whiteboard/board-export.ts` (board → sanitized appendix HTML; orchestrates PDF), `src/main/whiteboard/board-docx.ts` (OOXML), board-file read/write (reuse the whiteboard store + attachment import). IPC: `whiteboard:exportPdf`, `whiteboard:exportDocx`, `whiteboard:exportFile`, `whiteboard:importFile`. (The PNG is produced renderer-side and handed to main for embedding, or main renders HTML with the PNG data-URI for PDF.)
- **Renderer:** `src/renderer/modules/whiteboard/board-raster.ts` (board → PNG) + toolbar wiring in `WhiteboardModule.tsx`.
- **Shared:** `src/shared/board-file.ts` (the `.gboard` shape + version).

## Security / charter

- Node text sanitized (DOMPurify) into the appendix HTML/OOXML — no injection into PDF/DOCX.
- Board-file **assets bounded** (count + per-image size) and validated through `ensureWhiteboard`; import re-writes attachments through the vault (encrypt-at-rest preserved); export refuses a destination inside the encrypted store.
- No new dependency (canvas native; adm-zip / printToPDF / DOMPurify existing). No egress.

## Testing

- **Pure/unit:** `board-raster` draw logic (mock 2D context — asserts edges/nodes/images/text drawn, bounding-box + scale math), appendix HTML builder (deterministic + sanitized), `board-docx` OOXML structure, board-file **round-trip** (export→import preserves nodes/edges and remaps assets), the export-into-vault refusal.
- **Live-verified:** the visual snapshot fidelity (fonts/scale/overlap) and big-board fit — jsdom can't render canvas/layout; GhostExodus confirms, consistent with this session.

## Phasing (~4–5 TDD tasks)

1. `board-file` type + export/import (portable `.gboard`, asset embed + remap, vault-safe).
2. `board-raster` (board → PNG) renderer helper.
3. Appendix HTML builder + **PDF** export.
4. `board-docx` **DOCX** export (PNG figure + appendix).
5. Whiteboard toolbar wiring (Export ▾ / Import board) + IPC.

## Out of scope (YAGNI)

- Editable/vector PDF of the board (raster snapshot only for the visual).
- Multi-page tiling of huge boards beyond a single fit-to-page image (a very large board scales down; revisit tiling only if it's unreadable in practice).
- Re-flowing the board layout on import (positions preserved verbatim).
