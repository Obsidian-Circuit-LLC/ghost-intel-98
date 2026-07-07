# Ghost Intel 98 — GhostExodus UX batch (v3.34.0) — Design

**Date:** 2026-07-07
**Status:** Approved for planning
**Author:** Obsidian Circuit (relaying GhostExodus field feedback)

## Overview

GhostExodus dogfooded v3.33.1 and confirmed the prior batch landed (My Documents
Open/Export works, Jukebox compact height "perfect"). This batch is six new asks
from the same field session. Each is scoped below with its current-state root
cause (from a four-agent code survey) and the chosen approach. All six ship in a
single release, **v3.34.0**, via the ultracode workflow.

The unifying theme across the two highest-value asks (News, Notepad→Documents) is
**back a surface with an existing store instead of duplicating it** — the substrate
already exists in both cases; only the wiring is missing.

## Global Constraints

- **No new network egress, no telemetry.** The News unification reuses the existing
  `NewsStreamView` player, whose egress is already gated by
  `settings.geoint.networkEnabled` — this batch adds no new outbound path. Every
  other workstream is local-only.
- **Encrypt-at-rest is not weakened.** Notes written to My Documents and any file
  content read for cross-module dragging go through `secureReadFile`/`secureWriteFile`
  with the existing `confineExisting` path-confinement. No plaintext escapes the vault.
- **Win98 aesthetic.** New icons are hand-drawn pixel-SVG in the style of the app's
  existing `glyphNodeFor` glyphs — no Microsoft-copyrighted .ico assets are sourced or
  bundled (same posture as the Jarvis-voice decision: build the mechanism, don't
  source the copyrighted art).
- **ADHD-friendly UX** (standing constraint): low-friction, immediate feedback,
  one clear action. Drag-and-drop and one-dropdown-entry saves serve this directly.
- **Determinism / house style:** no `Math.random()`/`time.time()` in correctness paths;
  extension→icon mapping is a pure deterministic function.
- **Version → 3.34.0.** Update README (status/changelog/version/test-count),
  `RELEASE_NOTES_v3.34.0.md`, and the profile README (6 spots).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`;
  no AI-identity trailers; `--no-verify` with `-c user.name/-c user.email` overrides;
  explicit-path `git add` only; never stage the known-dirty files (`pnpm-lock.yaml`,
  `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`,
  `docs/superpowers/ideation/**`, `resources/local-ai/**`).

---

## Workstream 1 — File-type icon pack (Win98 pixel-SVG)

**Goal.** Replace the single `📄` glyph in the My Documents grid with per-file-type
retro icons.

**Current state.** `MyDocumentsModule.tsx:86` renders one hard-coded ternary:
`{e.kind === 'folder' ? '📁' : '📄'}`. `DocEntry` carries `name` (extension derivable);
no data-model change needed. The app already has hand-drawn pixel-SVG glyphs
(`MyDocumentsGlyph`, `NotepadGlyph`, …) dispatched by `glyphNodeFor(m)` in
`src/renderer/shell/Icon.tsx` — the pattern to mirror.

**Design.**
- New module `src/renderer/modules/my-documents/file-icons.tsx`:
  - `fileIconKind(name: string): FileIconKind` — pure, deterministic, case-insensitive
    extension→category map. Categories: `text` (txt/md/log/rtf), `document`
    (pdf/doc/docx/odt), `spreadsheet` (csv/xls/xlsx/ods), `data` (json/xml/yaml/yml/toml),
    `image` (jpg/jpeg/png/gif/bmp/webp/svg/tif/tiff/ico), `audio`
    (mp3/wav/flac/ogg/m4a/aac), `video` (mp4/mpeg/mpg/mov/avi/mkv/webm/m4v),
    `archive` (zip/rar/7z/tar/gz/bz2), `code` (js/ts/tsx/py/html/css/sh/rs/c/cpp),
    `generic` (fallback, including no-extension).
  - A pixel-SVG component per category, built on a shared document-page silhouette
    with a category accent color + a small type mark (crisp-edges, small viewBox,
    matching existing glyph style). `folder` reuses the existing folder glyph look.
  - `fileGlyphNode(entry: DocEntry): JSX.Element` — folder → folder glyph; file →
    icon for `fileIconKind(entry.name)`.
- `MyDocumentsModule.tsx:86` swaps the ternary for `fileGlyphNode(e)`.

**Tests.** `test/file-icons.test.ts` — mapping table (each extension → expected kind,
case-insensitive, unknown → `generic`, empty/no-extension → `generic`, dotfile handling);
`fileGlyphNode` returns folder glyph for `kind:'folder'`.

**Risk.** None functional; purely presentational. Verify the grid still lays out with
the SVG nodes (sizes match the old 40px emoji footprint).

---

## Workstream 2 — Drag-and-drop (full: in-folder moves + cross-module notes)

**Goal.** (a) Drag a file tile onto a folder tile to move it. (b) Drag notes/text
between My Documents and the Briefcase, both directions.

**Current state.** No intra-app tile dragging — tiles at `MyDocumentsModule.tsx:78–88`
aren't `draggable`; moves go through cut/paste → `documents:move`
(`store.ts:148–156`, with confinement + descendant-loop guards). OS→app import drops
already exist (`onDrop` at lines 32–39). The canonical intra-app HTML5-DnD pattern is
`BookmarksModule.tsx:155–181` (`draggable` + `onDragStart/onDragEnd/onDrop` + a
`drag.current` ref). Briefcase notes live in a standalone JSON store
(`src/main/storage/briefcase.ts`, `briefcase.json` via secure-fs); Briefcase browser
UI is `BriefcaseModule.tsx`.

**Design.**
- **Shared drag payload.** A custom MIME `application/x-ga98-item` carrying a JSON
  descriptor, so drops can be validated by origin:
  - doc file: `{ src:'docs', relPath, name, kind:'file' }`
  - briefcase note: `{ src:'briefcase', id, name }`
- **Tier 1 — in-folder move.** My Documents file tiles become `draggable`; folder
  tiles accept drops of a `docs`-file payload → `window.api.documents.move(relPath, folderDir)`.
  Reject dropping a folder into its own descendant (already guarded in `store.move`).
  Visual: reuse the existing `dropHot` highlight, applied per-folder-tile on dragover.
- **Tier 2 — cross-module notes.** Two new IPC channels, both secure-fs + confined:
  - `documents:writeText(relDir, name, body)` → `store.writeText`: writes `body` to a
    unique leaf (`uniqueLeaf`) under the confined `relDir`, via `secureWriteFile`
    (encrypted at rest). Returns the written `DocEntry`.
  - `documents:readText(relPath)` → `store.readText`: reads a **text** file
    (extension-guarded to the `text`/`data`/`code` kinds + size cap, e.g. 1 MiB) via
    `secureReadFile`, returns a UTF-8 string; rejects binary/oversize with a typed error.
  - Briefcase window (`BriefcaseModule`) gains a drop zone: dropping a `docs` payload
    reads the doc text (`documents:readText`) → `briefcase.save({ name, body })`;
    binary/oversize → `toast.warn`.
  - My Documents view drop handler is extended: a `briefcase` payload →
    `briefcase.read(id)` → `documents:writeText(currentDir, name + '.txt', body)`.
    (The existing OS-file `onDrop` branch is preserved — dispatch on payload presence.)
  - Briefcase note tiles in `BriefcaseModule` become `draggable` with the `briefcase`
    payload.

**Tests.**
- `test/documents-text-io.test.ts` (node) — `writeText` round-trips through a mock
  secure-fs and honors confinement + `uniqueLeaf`; `readText` returns text for allowed
  kinds, rejects binary extension and oversize; both reject path traversal.
- `test/my-documents-dnd.test.ts` (jsdom) — file tile is `draggable` and sets the
  `docs` payload; folder tile drop calls `documents.move(relPath, folderDir)`; a
  `briefcase` payload drop calls `documents.writeText`; an OS-file drop still imports.
- `test/briefcase-dnd.test.ts` (jsdom) — Briefcase note tile is `draggable`; dropping a
  `docs`-text payload calls `briefcase.save` with the read body; binary payload warns.

**Risk.** Cross-window HTML5 DnD in the single-renderer window metaphor works at DOM
level but can feel janky (drop targets, drag images). Flag for the Windows smoke pass;
the dropdown save-target (Workstream 3) is the reliable fallback path for notes→Documents.

---

## Workstream 3 — Notepad "Save to My Documents" target

**Goal.** Add "My Documents" to the existing Notepad save-target dropdown; the rest of
the save flow is unchanged (GhostExodus: "this function doesn't have to change at all").

**Current state.** Save-target `<select>` at `NotepadModule.tsx:163–173` lists
`(no case)` (`''`), `💼 Briefcase` (`BRIEFCASE = '__briefcase__'`, line 21), and one
option per case. `save()` (lines 83–107) branches Briefcase vs case. No documents
text-write path existed before Workstream 2.

**Design.**
- New sentinel `MYDOCS = '__mydocs__'`; a `📂 My Documents` option in the select.
- `save()` gains a branch: when `target === MYDOCS`, call
  `window.api.documents.writeText('', noteName + '.txt', body)` (root of My Documents;
  `uniqueLeaf` de-dupes). Toast success, mirror the Briefcase branch's UX.
- v1 is **save-only** (consistent with GhostExodus's "saved directly to My Documents").
  Reopening a note saved there is via the My Documents module's Open action. The
  "Open existing…" dropdown continues to list case/Briefcase notes only — noted as a
  possible fast-follow, not in this batch (YAGNI).

**Tests.** `test/notepad-mydocs-target.test.ts` (jsdom) — selecting My Documents and
saving calls `documents.writeText('', 'name.txt', body)`; `(no case)` still warns and
does not write.

**Risk.** Low. Reuses Workstream 2's `writeText` channel — Workstream 2 must land first
(sequencing note for the plan).

---

## Workstream 4 — Investigation window readability (Win98-grey controls)

**Goal.** Fix the "wonky" low-contrast text/buttons in the Investigation cockpit; keep
the graph canvas dark.

**Current state (root cause).** The BEM classnames in `InvestigationSidePanel.tsx`
(`investigation-side-panel__tab`, `__header`, `__switch`) and `RunPanel.tsx`
(`run-panel__title`, `__muted`, `__status`, `__question`, `__seed`) have **zero matching
CSS anywhere** — the module imports no stylesheet. So their text falls through to the
global `theme.css:19` `color:#000` on the near-black `#111820` side panel
(`InvestigationGraphModule.tsx:63`) → black-on-black. GraphPane's toolbar reads only
because it hard-codes `color:'#dfe6ec'` inline (`GraphPane.tsx:123`), but its 98.css
controls sit bare on dark. The graph canvas (`.inv-node` node area) is legitimately dark.

**Design.**
- New scoped stylesheet `src/renderer/modules/investigation-graph/investigation.css`,
  imported once by `InvestigationGraphModule.tsx`.
- **Side panel → Win98-grey surface.** `.investigation-side-panel` and `.run-panel`
  get `background: var(--ga98-grey)` + `color:#000`, so the native 98.css controls
  (Run/Report tabs, seed buttons, inputs) render normally and read correctly. Style the
  tab active/inactive state (`.investigation-side-panel__tab`, `--on`) with the standard
  Win98 pressed/raised look; give `.run-panel__title`/`__muted`/`__status`/`__question`
  sensible spacing + black-on-grey text. The `UnavailableCard` ("Autonomous runs need
  the reasoning pack") becomes readable.
- **GraphPane toolbar strip → Win98-grey.** Change the toolbar container's inline
  `background:'#111820'`/`color:'#dfe6ec'` (`GraphPane.tsx:122–123`) to
  `var(--ga98-grey)` + `#000` so its controls (Search / Min score / Type / Cluster /
  Add node) read as native Win98 chrome. **Keep the graph-canvas node area dark** — only
  the toolbar strip changes, not `GraphCanvas`.
- No component logic changes.

**Tests.** `test/investigation-contrast.spec.ts` — a headless computed-style check
(Playwright, per the 98.css-cascade lesson) asserting `.run-panel__title` and
`.investigation-side-panel` do **not** resolve to a near-black foreground on a near-black
background (contrast floor), and that the toolbar strip background is the grey token.
If Playwright wiring is heavier than warranted, a jsdom assertion that `investigation.css`
is imported + a snapshot of the resolved custom-property fallback is the minimum bar.

**Also (copy/answer).** Add a one-line readable subtitle in the cockpit confirming what
the module is ("An entity graph you grow with transforms — seed a node, pivot outward;
autonomous fan-out needs the reasoning pack"), answering GhostExodus's "is this like
Maltego?" in-product. Keep it factual — the autonomous run genuinely requires the
bundled reasoning pack.

**Risk.** CSS cascade regressions elsewhere are avoided by scoping every selector under
the investigation classnames (no bare element rules). Verify headlessly.

---

## Workstream 5 — News module mirrors GeoINT Live News

**Goal.** The standalone News tool (OSINT Toolkit) shares GeoINT Live News's saved feed
list: a dropdown to pick any saved stream + an add-feed form; adds in either surface
appear in both.

**Current state.** Both surfaces **already share** the player (`NewsStreamView` +
hls.js) and the `NewsStream` type (`{label,url,kind:'hls'|'youtube'}`,
`NewsStreamView.tsx:19–24`). The feed list **already persists** at
`settings.geoint.newsStreams` + `newsStreamIndex` (`types.ts:464–469`, seed 689–698),
read/written by `LiveNewsPanel.tsx` via `useSettings().patch`. The **only** gap: the
standalone `NewsViewModule.tsx:14` ignores the store and uses the hardcoded
`DEFAULT_NEWS_STREAM` (Bloomberg, `NewsStreamView.tsx:30–34`).

**Design.**
- Extract the feed-list management UI out of `LiveNewsPanel` into a shared component
  `src/renderer/modules/geoint/NewsFeedControls.tsx`: the Stream dropdown + Label/kind/
  m3u8 add-form + `addStream`/`removeStream`/`selectStream`, all backed by
  `settings.geoint.newsStreams` through `useSettings().patch`. **Preserve the
  full-`geoint`-block re-send** (the `patchNews` pattern), because `mergeSettings`
  shallow-merges the `geoint` block (`json-fs.ts:935`).
- `LiveNewsPanel` renders `NewsFeedControls` + `NewsStreamView(active)` — no behavior
  change, just refactored.
- `NewsViewModule` renders `NewsFeedControls` + `NewsStreamView(active)` reading the
  same store instead of the hardcoded default; when the store is empty, seed/fall back to
  the Bloomberg default so the tool is never blank.
- Keep `NewsStreamView`'s `networkEnabled` offline gate intact (no new egress).

**Tests.** `test/news-feed-shared.test.ts` (jsdom) — `addStream` appends to
`settings.geoint.newsStreams` and the patch carries the full `geoint` block;
`NewsViewModule` renders the store's active stream (not the hardcoded Bloomberg when the
store has entries); `removeStream` clamps `newsStreamIndex`; empty store → Bloomberg
fallback.

**Risk.** Low. The refactor must keep `LiveNewsPanel` pixel-identical; guard with the
shared-component extraction test.

---

## Workstream 6 — Jukebox WMP re-skin

**Goal.** Re-skin the compact deck into a classic Windows Media Player look — a bordered
screen (visualizer as art) with a transport row (rewind/play/pause/stop/fast-forward),
the GI98 logo in the bottom-right corner (not the Windows flag), a smaller default size,
and the expand caret preserved to reveal track info/library.

**Current state.** `MediaPlayerModule.tsx` — compact deck at lines 314–381 (green LCD +
two-row button deck + fields + `Visualizer` + seek + status strip with the caret at
377–380). Transport icons are inline SVGs (lines 38–76): Prev/Next/Play/Pause/Stop/
Shuffle/Repeat — **no rewind/fast-forward seek** glyphs exist (Prev/Next are track-skip).
Height constants in `jukebox-window.ts` (`JUKEBOX_COMPACT_H=270`, `EXPANDED_H=840`);
`register-builtins.tsx:243` `defaultWidth:720, defaultHeight:270` (height must stay in
sync with `JUKEBOX_COMPACT_H`). CSS in `theme.css` `.ga98-cdp-*` (737–763); the old
`.ga98-jukebox-lcd/-transport` rules (714–733) are dead. Logo asset at
`src/renderer/assets/logo.png`, referenced via Vite import (pattern:
`SettingsModule.tsx` `imageRendering:'pixelated'`).

**Design.**
- **New seek helper** `src/renderer/modules/media/seek.ts`: `clampSeek(cur, delta, dur)`
  → `Math.max(0, Math.min(dur, cur + delta))` (pure, testable). Handlers wire
  `audio.currentTime = clampSeek(audio.currentTime, ±SEEK_STEP, audio.duration)`
  (e.g. `SEEK_STEP = 10`).
- **New icons** `IcoRewind`, `IcoFForward` (double-triangle seek glyphs) added to the
  SVG set (lines 38–76).
- **Re-skinned compact deck.** Restructure lines 314–381 into a `.ga98-wmp` player:
  - a bordered "screen" panel wrapping `<Visualizer>` as the art/spectrum area, with the
    GI98 logo absolutely positioned bottom-right (`import logoUrl from '../../assets/logo.png'`,
    pixelated, small);
  - a transport row beneath the screen: rewind / play / pause / stop / fast-forward;
  - the seek scrubber + volume + viz toggle remain in a slim status strip;
  - the expand/collapse caret (377–380) is kept **verbatim** — it still drives
    `collapsed → height` and persists `jukeboxExpanded`.
  - Prev/Next/Shuffle/Repeat move into the expanded view (or a secondary strip) so the
    compact WMP row stays the classic five buttons.
- **Smaller default.** Lower `JUKEBOX_COMPACT_H` (target ~210, a smoke-pass tuning
  constant — biased slightly tall to avoid clipping the transport row/caret) **and**
  `register-builtins.tsx` `defaultHeight` together; set `defaultWidth` to a squarer WMP
  frame (target ~380). Note: width only affects newly-opened windows.
- **Expanded view unchanged** except for receiving the moved Prev/Next/Shuffle/Repeat;
  library/stations panes stay.
- **Cleanup.** Remove the dead `.ga98-jukebox-lcd/-transport` CSS (714–733); add
  `.ga98-wmp` screen/border/logo/transport-row rules.

**Tests.** `test/jukebox-seek.test.ts` (node) — `clampSeek` clamps at 0 and `dur`,
monotonic within range, handles `NaN`/0 duration safely. `test/jukebox-window.test.ts`
(existing) updated for the new `JUKEBOX_COMPACT_H`. jsdom smoke: the compact deck renders
the five transport buttons + the logo img; caret still toggles `collapsed`.

**Risk.** The exact compact height/width are estimates off the reference image (tenth
image not measured) — same class of tuning constant as v3.33.1's 270px. Confirm on the
Windows smoke; a single-constant nudge → v3.34.1 if off.

---

## Cross-cutting

- **Sequencing.** Workstream 2's `documents:writeText`/`readText` channels underpin
  Workstream 3 and the cross-module half of 2 — land the channels first. Otherwise the
  six workstreams are independent.
- **IPC surface added:** `documents:writeText`, `documents:readText` (contracts +
  preload + `api.d.ts` + handlers). Both confined + secure-fs. No other new channels.
- **Settings.** No new settings group — News stays under `settings.geoint.newsStreams`
  (zero migration). No `mergeSettings` change required; preserve the full-block re-send.
- **Module registration.** No new top-level modules. `file-icons.tsx`,
  `NewsFeedControls.tsx`, `seek.ts`, `investigation.css` are internal to existing modules.

## Verification

- `pnpm typecheck` (both configs) + full `pnpm test` green, including the new suites
  (`file-icons`, `documents-text-io`, `my-documents-dnd`, `briefcase-dnd`,
  `notepad-mydocs-target`, `investigation-contrast`, `news-feed-shared`, `jukebox-seek`).
- Build the Windows installer; grep the packaged `app.asar` for code identifiers
  (`fileIconKind`, `documents:writeText`, `NewsFeedControls`, `clampSeek`, `ga98-wmp`) —
  comments are stripped, so grep identifiers not comment strings.
- Charter: re-confirm no new egress (News reuses the gated player; writeText/readText are
  local secure-fs); encrypt-at-rest holds for notes saved to My Documents.
- Windows smoke (real-Windows-only, operator-gated): per-type icons render; drag a file
  into a folder; drag a note ↔ Briefcase both ways; Notepad → Save to My Documents;
  Investigation cockpit readable; add a news feed in GeoINT and see it in the News tool
  (and vice versa); Jukebox WMP deck fits at the new compact size, caret expands to track
  info.

## Out of scope (YAGNI / fast-follow)

- Notepad "Open existing…" listing My Documents files (save-only in v1).
- Non-text file cross-module dragging (text/data/code only; binaries warn).
- A neutral top-level `news` settings group (staying under `geoint` is sufficient).
