# GhostExodus UX Batch (v3.34.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six GhostExodus field-feedback items in one release — per-file-type Win98 icons, drag-and-drop (in-folder + cross-module notes), Notepad "Save to My Documents", Investigation-window readability, News-mirrors-GeoINT, and a Jukebox WMP re-skin.

**Architecture:** Renderer-heavy (React/TS + 98.css). Two new secure-fs IPC channels (`documents:writeText`/`documents:readText`) underpin the note-movement features; everything else is presentational or refactor. The News and Notepad asks reuse existing stores rather than duplicating them.

**Tech Stack:** Electron 33 + React 18 + TypeScript, zustand store, 98.css, hls.js, vitest, jsdom, electron-builder (NSIS).

## Global Constraints

- **No new network egress, no telemetry.** News reuses the existing `NewsStreamView` player (egress already gated by `settings.geoint.networkEnabled`). Everything else is local.
- **Encrypt-at-rest preserved.** All doc content I/O goes through `secureWriteFile`/`secureReadFile` + `confineExisting`. No plaintext leaves the vault.
- **Win98 pixel-SVG icons** in the style of `src/renderer/shell/Icon.tsx` glyphs (small viewBox, `shapeRendering="crispEdges"`). No Microsoft .ico assets sourced/bundled.
- **Deterministic** extension→icon and seek mapping (pure functions, no clock/RNG).
- **Version → 3.34.0.** Update README, `RELEASE_NOTES_v3.34.0.md`, profile README (6 spots).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; NO AI-identity trailers; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; explicit-path `git add` only; NEVER stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- **Test commands:** `pnpm test` (vitest), `pnpm typecheck` (both tsconfig.node + tsconfig.web).

---

## File Structure

**New files:**
- `src/renderer/modules/my-documents/file-icons.tsx` — extension→kind map + pixel-SVG glyphs (Task 1)
- `src/renderer/modules/geoint/NewsFeedControls.tsx` — shared feed dropdown+add-form (Task 7)
- `src/renderer/modules/media/seek.ts` — `clampSeek` pure helper (Task 8)
- `src/renderer/modules/investigation-graph/investigation.css` — the missing stylesheet (Task 6)
- Tests: `test/file-icons.test.ts`, `test/documents-text-io.test.ts`, `test/my-documents-dnd.test.tsx`, `test/briefcase-dnd.test.tsx`, `test/notepad-mydocs-target.test.tsx`, `test/investigation-contrast.test.ts`, `test/news-feed-shared.test.tsx`, `test/jukebox-seek.test.ts`

**Modified:**
- `src/main/documents/store.ts`, `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts` (Task 2)
- `src/renderer/modules/my-documents/MyDocumentsModule.tsx` (Tasks 1, 3, 4)
- `src/renderer/modules/briefcase/BriefcaseModule.tsx` (Task 4)
- `src/renderer/modules/notepad/NotepadModule.tsx` (Task 5)
- `src/renderer/modules/investigation-graph/{InvestigationGraphModule,GraphPane}.tsx` (Task 6)
- `src/renderer/modules/geoint/{LiveNewsPanel,NewsViewModule}.tsx` (Task 7)
- `src/renderer/modules/media/MediaPlayerModule.tsx`, `src/renderer/modules/media/jukebox-window.ts`, `src/renderer/modules/register-builtins.tsx`, `src/renderer/styles/theme.css` (Tasks 8, 9)

**Sequencing:** Task 2 must land before Tasks 4 and 5 (they use `writeText`/`readText`). Otherwise tasks are independent; recommended order is 1→9.

---

### Task 1: Per-file-type Win98 icons

**Files:**
- Create: `src/renderer/modules/my-documents/file-icons.tsx`
- Modify: `src/renderer/modules/my-documents/MyDocumentsModule.tsx:86`
- Test: `test/file-icons.test.ts`

**Interfaces:**
- Produces: `fileIconKind(name: string): FileIconKind`, `fileGlyphNode(entry: DocEntry): JSX.Element`, `type FileIconKind = 'text'|'document'|'spreadsheet'|'data'|'image'|'audio'|'video'|'archive'|'code'|'generic'`.

- [ ] **Step 1: Write the failing test** — `test/file-icons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileIconKind } from '../src/renderer/modules/my-documents/file-icons';

describe('fileIconKind', () => {
  const cases: [string, string][] = [
    ['notes.txt', 'text'], ['README.md', 'text'], ['a.LOG', 'text'],
    ['Tribunal.pdf', 'document'], ['brief.docx', 'document'], ['x.DOC', 'document'],
    ['ledger.csv', 'spreadsheet'], ['book.xlsx', 'spreadsheet'],
    ['manifest.json', 'data'], ['feed.xml', 'data'], ['c.yaml', 'data'],
    ['photo.JPG', 'image'], ['scan.png', 'image'], ['logo.svg', 'image'],
    ['song.mp3', 'audio'], ['clip.wav', 'audio'],
    ['movie.mp4', 'video'], ['reel.mpeg', 'video'], ['v.MKV', 'video'],
    ['bundle.zip', 'archive'], ['x.tar', 'archive'], ['y.gz', 'archive'],
    ['app.ts', 'code'], ['index.html', 'code'], ['s.py', 'code'],
    ['unknown.xyz', 'generic'], ['noext', 'generic'], ['', 'generic'], ['.gitignore', 'generic'],
  ];
  it.each(cases)('%s → %s', (name, kind) => {
    expect(fileIconKind(name)).toBe(kind);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test file-icons` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/renderer/modules/my-documents/file-icons.tsx`. Write `fileIconKind` as a deterministic extension→kind map; a pixel-SVG component per kind matching `Icon.tsx` house style (small `viewBox`, `shapeRendering="crispEdges"`, a shared document-page silhouette + per-kind accent color and a small type mark); and `fileGlyphNode`. Extension parse: lowercase, take substring after the LAST `.`, but treat a leading-dot dotfile (`.gitignore`) and no-dot names as `generic`.

```tsx
import type { DocEntry } from '../../../shared/documents-types';

export type FileIconKind =
  | 'text' | 'document' | 'spreadsheet' | 'data' | 'image'
  | 'audio' | 'video' | 'archive' | 'code' | 'generic';

const EXT: Record<string, FileIconKind> = {
  txt: 'text', md: 'text', log: 'text', rtf: 'text',
  pdf: 'document', doc: 'document', docx: 'document', odt: 'document',
  csv: 'spreadsheet', xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
  json: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
  webp: 'image', svg: 'image', tif: 'image', tiff: 'image', ico: 'image',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  mp4: 'video', mpeg: 'video', mpg: 'video', mov: 'video', avi: 'video',
  mkv: 'video', webm: 'video', m4v: 'video',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
  js: 'code', ts: 'code', tsx: 'code', py: 'code', html: 'code', css: 'code',
  sh: 'code', rs: 'code', c: 'code', cpp: 'code',
};

export function fileIconKind(name: string): FileIconKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'generic'; // no dot, or leading-dot dotfile
  return EXT[name.slice(dot + 1).toLowerCase()] ?? 'generic';
}
```

Then the per-kind SVG components + a `KIND_ACCENT: Record<FileIconKind,string>` table (text `#3b6ea5`, document `#b23b3b`, spreadsheet `#2e8b57`, data `#8a6d3b`, image `#7a3ba5`, audio `#c07a1f`, video `#31708f`, archive `#6b6b6b`, code `#2f4f4f`, generic `#5a5a5a`), and:

```tsx
export function fileGlyphNode(entry: DocEntry): JSX.Element {
  if (entry.kind === 'folder') return <FolderGlyph />;
  return <FileGlyph kind={fileIconKind(entry.name)} />;
}
```

`FolderGlyph` reuses the existing folder look; `FileGlyph` renders the page silhouette + `KIND_ACCENT[kind]` corner-fold/label + a small mark. Keep the drawn footprint ≈40px to match the old emoji.

- [ ] **Step 4: Wire into the grid** — `MyDocumentsModule.tsx`: add `import { fileGlyphNode } from './file-icons';` and replace line 86:

```tsx
<div style={{ fontSize: 40, lineHeight: 1 }}>{e.kind === 'folder' ? '📁' : '📄'}</div>
```
with
```tsx
<div style={{ width: 40, height: 40, margin: '0 auto', lineHeight: 0 }}>{fileGlyphNode(e)}</div>
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm test file-icons` PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit** — `git add src/renderer/modules/my-documents/file-icons.tsx src/renderer/modules/my-documents/MyDocumentsModule.tsx test/file-icons.test.ts` then commit `feat(my-documents): per-file-type Win98 icons in the grid`.

---

### Task 2: `documents:writeText` + `documents:readText` channels

**Files:**
- Modify: `src/main/documents/store.ts` (add `writeText`, `readText`), `src/shared/ipc-contracts.ts:266-277`, `src/main/ipc/register.ts:651-688`, `src/preload/index.ts:58-70`, `src/preload/api.d.ts` (documents block)
- Test: `test/documents-text-io.test.ts`

**Interfaces:**
- Produces: `store.writeText(relDir: string, name: string, body: string): Promise<DocEntry>`, `store.readText(relPath: string): Promise<string>`; channels `documents:writeText`, `documents:readText`; `window.api.documents.writeText(relDir,name,body)`, `window.api.documents.readText(relPath)`.
- Consumes: existing `confineExisting`, `uniqueLeaf`, `secureWriteFile`, `secureReadFile`, `isEncryptedFile`, `ensureDocRelPath`, `ensureDocName`.

**Text-kind guard (readText):** allow only extensions whose `fileIconKind` ∈ {`text`,`data`,`code`} — but the main process can't import the renderer file-icons module, so replicate a minimal allowlist set in the store. Size cap 1 MiB.

- [ ] **Step 1: Write the failing test** — `test/documents-text-io.test.ts`. Mock secure-fs + the paths module the way `test/documents-open-export.test.ts` does (follow that file's existing mock harness for `confineExisting`/`secureReadFile`/`secureWriteFile`). Assert: `writeText` writes via `secureWriteFile` to a `uniqueLeaf` under the confined dir and returns a `DocEntry` with `kind:'file'` and the deduped `name`; `readText` returns the decoded string for a `.txt`; `readText` rejects a `.png` with a text-kind error; `readText` rejects an oversize file (>1 MiB) with a size error. (Match the mock style already used in `documents-open-export.test.ts` — read that test first to reuse its fixtures.)

- [ ] **Step 2: Run test → FAIL** (`writeText`/`readText` not exported).

- [ ] **Step 3: Implement in `store.ts`** (append after `exportEntry`):

```ts
const TEXT_EXTS = new Set([
  'txt','md','log','rtf','json','xml','yaml','yml','toml',
  'js','ts','tsx','py','html','css','sh','rs','c','cpp','csv',
]);
const MAX_TEXT_BYTES = 1024 * 1024; // 1 MiB

/** Write a UTF-8 note into My Documents (encrypted at rest iff the vault is unlocked). */
export async function writeText(relDir: string, name: string, body: string): Promise<DocEntry> {
  const realDir = await confineExisting(relDir);
  const leaf = await uniqueLeaf(realDir, name);
  const dest = join(realDir, leaf);
  const bytes = Buffer.from(body, 'utf8');
  await secureWriteFile(dest, bytes);
  const s = await stat(dest);
  return { name: leaf, kind: 'file', size: bytes.length, modifiedAt: s.mtime.toISOString() };
}

/** Read a TEXT file's decrypted content. Rejects non-text extensions and oversize files. */
export async function readText(relPath: string): Promise<string> {
  const real = await confineExisting(relPath);
  if ((await stat(real)).isDirectory()) throw new Error('Refusing to read a folder as text.');
  const ext = extname(real).slice(1).toLowerCase();
  if (!TEXT_EXTS.has(ext)) throw new Error('Only text notes can be moved this way.');
  const bytes = await (isEncryptedFile(real) ? secureReadFile(real) : readFile(real));
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('File is too large to read as text.');
  return bytes.toString('utf8');
}
```

- [ ] **Step 4: Wire IPC** — add to `ipc-contracts.ts` documents block: `writeText: 'documents:writeText', readText: 'documents:readText'`. Add handlers in `register.ts` after line 688 (validate a body string — add/reuse an `ensureText`-style check; mirror the `ensureDocName`/`ensureDocRelPath` validators in the same module):

```ts
safeHandle(channels.documents.writeText, (...args) =>
  documentsStore.writeText(ensureDocRelPath(args[0], 'relDir'), ensureDocName(args[1], 'name'), ensureNoteBody(args[2], 'body')));
safeHandle(channels.documents.readText, (...args) =>
  documentsStore.readText(ensureDocRelPath(args[0], 'relPath')));
```

Add `ensureNoteBody(v, field)` next to the other `ensure*` validators (string; reject non-string; cap length at ~1 MiB chars) — locate the existing validators file the other `ensureDoc*` live in and follow that pattern. Add preload bindings in `index.ts` documents block:

```ts
writeText: (relDir: string, name: string, body: string) => ipcRenderer.invoke(channels.documents.writeText, relDir, name, body),
readText: (relPath: string) => ipcRenderer.invoke(channels.documents.readText, relPath),
```

Add the matching two signatures to the `documents` interface in `api.d.ts`.

- [ ] **Step 5: Run tests + typecheck** — `pnpm test documents-text-io` PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit** — explicit-path add the 6 files + test; `feat(documents): secure writeText/readText IPC channels for note movement`.

---

### Task 3: In-folder move via drag-and-drop

**Files:**
- Modify: `src/renderer/modules/my-documents/MyDocumentsModule.tsx`
- Test: `test/my-documents-dnd.test.tsx`

**Interfaces:**
- Produces: the shared drag payload MIME `application/x-ga98-item` carrying `JSON.stringify({src:'docs',relPath,name,kind})`; folder tiles accept a `docs` payload → `doc.move(relPath, folderDir)`.
- Consumes: `window.api.documents.move` (already bridged); add a `move` wrapper to `useDocuments` if not present (there is `paste` using move, but add a direct `move(rel,destDir)` for DnD).

- [ ] **Step 1: Add a `move` action to `useDocuments.ts`** (after `paste`):

```ts
const move = useCallback(async (rel: string, destDir: string) => {
  try { await window.api.documents.move(rel, destDir); await refresh(); }
  catch (e) { setError((e as Error).message); }
}, [refresh]);
```
Return it in the hook's object.

- [ ] **Step 2: Write the failing test** — `test/my-documents-dnd.test.tsx` (jsdom + @testing-library/react, following an existing renderer test's render harness). Render `MyDocumentsModule` with a mocked `window.api.documents` (`list` returns one file + one folder). Assert: a file tile has `draggable=true`; firing `dragStart` on it sets `dataTransfer` `application/x-ga98-item` to the docs payload; firing `drop` on the folder tile calls `window.api.documents.move(fileRel, folderDir)`. (Reuse the `window.api` mock pattern from `test/my-documents-module.test.tsx`.)

- [ ] **Step 3: Run test → FAIL** (tiles not draggable).

- [ ] **Step 4: Implement** — in `MyDocumentsModule.tsx`:
  - Add a payload constant `const GA98_ITEM = 'application/x-ga98-item';` (module scope) and a helper `readItemPayload(dt: DataTransfer)`.
  - Make each tile `draggable` with `onDragStart` setting `ev.dataTransfer.setData(GA98_ITEM, JSON.stringify({ src:'docs', relPath: joinRel(doc.dir, e.name), name: e.name, kind: e.kind }))`.
  - Folder tiles get `onDragOver` (preventDefault + a per-tile hover highlight) and `onDrop` that parses the payload; if `src==='docs'` and it's not the same folder, call `doc.move(payload.relPath, joinRel(doc.dir, e.name))`; `stopPropagation` so it doesn't bubble to the container's OS-import `onDrop`.
  - The container `onDrop` (lines 32-39) must ignore drags that carry the `GA98_ITEM` type (only handle real OS files): early-return if `ev.dataTransfer.types.includes(GA98_ITEM)`.

- [ ] **Step 5: Run tests + typecheck** — PASS/clean.

- [ ] **Step 6: Commit** — `feat(my-documents): drag a file onto a folder to move it`.

---

### Task 4: Cross-module note dragging (My Documents ↔ Briefcase)

**Files:**
- Modify: `src/renderer/modules/my-documents/MyDocumentsModule.tsx`, `src/renderer/modules/briefcase/BriefcaseModule.tsx`
- Test: `test/briefcase-dnd.test.tsx` (+ extend `test/my-documents-dnd.test.tsx`)

**Interfaces:**
- Consumes: `documents.writeText`/`documents.readText` (Task 2), `window.api.briefcase.save`/`.read` (existing).
- Payload extended: a Briefcase note drag carries `{src:'briefcase', id, name}`.

- [ ] **Step 1: Write the failing tests.**
  - `test/briefcase-dnd.test.tsx`: render `BriefcaseModule` (mock `window.api.briefcase.list/read/save` + `documents.readText`). Assert a note tile is `draggable` and sets the `briefcase` payload; firing `drop` of a `docs`-text payload on the Briefcase drop zone calls `documents.readText(relPath)` then `briefcase.save({name, body})`; a `docs` payload whose `readText` rejects (binary) surfaces a warn toast and does NOT call `briefcase.save`.
  - Extend `my-documents-dnd`: dropping a `briefcase` payload on the My Documents view calls `briefcase.read(id)` then `documents.writeText(doc.dir, name+'.txt', body)`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement My Documents side** — extend the container `onDrop` in `MyDocumentsModule.tsx`: when the payload `src==='briefcase'`, `const note = await window.api.briefcase.read(payload.id); await window.api.documents.writeText(doc.dir, `${payload.name}.txt`, note.body); await doc.refresh();` (guard the OS-file branch behind "no GA98_ITEM payload", already added in Task 3). Add a `writeTextNote` helper to `useDocuments` mirroring `move` for testability + refresh + error capture.

- [ ] **Step 4: Implement Briefcase side** — in `BriefcaseModule.tsx`: make note rows `draggable` with the `briefcase` payload; add a drop zone (the list container) with `onDragOver`/`onDrop`; on a `docs` payload, `try { const body = await window.api.documents.readText(payload.relPath); await window.api.briefcase.save({ id: crypto.randomUUID(), name: payload.name, body }); refresh(); } catch (e) { toast.warn((e as Error).message); }`. Ignore payloads with no `GA98_ITEM` type.

- [ ] **Step 5: Run tests + typecheck** — PASS/clean.

- [ ] **Step 6: Commit** — `feat(documents,briefcase): drag notes between My Documents and the Briefcase`.

---

### Task 5: Notepad "Save to My Documents" target

**Files:**
- Modify: `src/renderer/modules/notepad/NotepadModule.tsx`
- Test: `test/notepad-mydocs-target.test.tsx`

**Interfaces:**
- Consumes: `window.api.documents.writeText` (Task 2).

- [ ] **Step 1: Write the failing test** — render `NotepadModule` (mock `cases.list`, `documents.writeText`, `briefcase`, `notes`). Set body text, select the `My Documents` option (value `__mydocs__`), click Save → assert `window.api.documents.writeText('', 'untitled.txt', body)` called. Selecting `(no case)` (`''`) and saving → asserts a warn and NO `writeText`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — in `NotepadModule.tsx`:
  - Add `const MYDOCS = '__mydocs__';` next to `BRIEFCASE` (line 21).
  - Add `const isMyDocs = target === MYDOCS;`.
  - Add the option in the `<select>` (after the Briefcase option, ~line 169): `<option value={MYDOCS}>📂 My Documents</option>`.
  - In `save()` add a branch before the case branch: `if (isMyDocs) { await window.api.documents.writeText('', `${noteName}.txt`, body); toast.info('Saved to My Documents.'); setSavedAt(new Date().toISOString()); setDirty(false); return; }`. (Match the surrounding save-UX: the existing Briefcase/case branches show how `savedAt`/`dirty` are set — mirror them; avoid `Date.now()` only where the file forbids it, otherwise follow the file's existing timestamp idiom.)
  - `refreshNotes`/"Open existing…" are unchanged (My Documents is save-only in v1 — do NOT add it to the open-existing list).

- [ ] **Step 4: Run tests + typecheck** — PASS/clean.

- [ ] **Step 5: Commit** — `feat(notepad): save a note straight into My Documents`.

---

### Task 6: Investigation window readability (Win98-grey controls)

**Files:**
- Create: `src/renderer/modules/investigation-graph/investigation.css`
- Modify: `src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx` (import the css; add subtitle copy), `src/renderer/modules/investigation-graph/GraphPane.tsx:122-123` (toolbar strip → grey)
- Test: `test/investigation-contrast.test.ts`

**Interfaces:** none exported; CSS + one import + inline-style change.

- [ ] **Step 1: Write the failing test** — `test/investigation-contrast.test.ts` (node, no DOM). Read `investigation.css` as text and assert it defines rules for the previously-unstyled classes with a light-on-grey/legible foreground: assert the file contains selectors `.investigation-side-panel`, `.run-panel`, `.run-panel__title`, `.investigation-side-panel__tab`, and that `.investigation-side-panel`/`.run-panel` set `background: var(--ga98-grey)` (or the app grey token) and a non-`#000`-on-`#000` color. Assert `InvestigationGraphModule.tsx` imports `./investigation.css`. (This is the pragmatic bar per the plan; a Playwright computed-style check is optional polish, not required — do NOT add a Playwright dependency for it.)

- [ ] **Step 2: Run → FAIL** (file/import absent).

- [ ] **Step 3: Implement** — create `investigation.css` with grey-surface rules scoped under the investigation classnames (every selector prefixed with `.investigation-side-panel`/`.run-panel`/`.graph-pane-toolbar` — NO bare element selectors, to avoid cascade bleed). Give the side panel `background: var(--ga98-grey); color:#000;`, style `__tab`/`__tab--on` with the Win98 raised/pressed look, and space the run-panel text. Import it at the top of `InvestigationGraphModule.tsx`. In `GraphPane.tsx:122-123` change the toolbar container's inline `background:'#111820'`/`color:'#dfe6ec'` to the grey token + `#000` (give it a class `graph-pane-toolbar` so the css can own it); **leave the graph-canvas/node area dark**. Add a one-line readable subtitle near the cockpit header: "An entity graph you grow with transforms — seed a node, pivot outward; autonomous fan-out needs the reasoning pack."

- [ ] **Step 4: Run tests + typecheck** — PASS/clean. Manually confirm (dev) the "Autonomous runs need the reasoning pack" card is now legible.

- [ ] **Step 5: Commit** — `fix(investigation): readable Win98-grey control panel (missing stylesheet)`.

---

### Task 7: News module mirrors GeoINT Live News

**Files:**
- Create: `src/renderer/modules/geoint/NewsFeedControls.tsx`
- Modify: `src/renderer/modules/geoint/LiveNewsPanel.tsx` (render the shared component), `src/renderer/modules/geoint/NewsViewModule.tsx` (read the store)
- Test: `test/news-feed-shared.test.tsx`

**Interfaces:**
- Produces: `NewsFeedControls` — a component owning the Stream dropdown + Label/kind/m3u8 add-form + `addStream`/`removeStream`/`selectStream`, backed by `settings.geoint.newsStreams`/`newsStreamIndex` via `useSettings().patch`, PRESERVING the full-`geoint`-block re-send (mirror `LiveNewsPanel.patchNews`).

- [ ] **Step 1: Write the failing test** — `test/news-feed-shared.test.tsx`. Mock the settings store (`useSettings` returning `geoint.newsStreams` seeded with Bloomberg + a `patch` spy). Render `NewsFeedControls`: filling label+url and clicking "Add stream" calls `patch` with a payload whose `geoint.newsStreams` includes the new entry AND still carries the rest of the `geoint` block (assert `patch.mock.calls[0][0].geoint` has both `newsStreams` and a pre-existing geoint key). Render `NewsViewModule` with the store holding a non-Bloomberg active stream → assert it renders that stream's label (not the hardcoded Bloomberg). Empty store → Bloomberg fallback. `removeStream` clamps `newsStreamIndex` to a valid range.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — extract the dropdown (LiveNewsPanel.tsx:145-167) + add-form (182-211) + `addStream`/`removeStream`/`selectStream`/`patchNews` into `NewsFeedControls.tsx` as a self-contained component reading/writing `settings.geoint`. Re-point `LiveNewsPanel` to render `<NewsFeedControls />` above its `<NewsStreamView active={...} />` — behavior must stay pixel-identical. Change `NewsViewModule.tsx`: read `settings.geoint.newsStreams`/`newsStreamIndex` via `useSettings()`, compute `active = streams[index] ?? DEFAULT_NEWS_STREAM`, render `<NewsFeedControls />` + `<NewsStreamView active={active} />`. Keep `DEFAULT_NEWS_STREAM` as the empty-store fallback only.

- [ ] **Step 4: Run tests + typecheck** — PASS/clean.

- [ ] **Step 5: Commit** — `feat(news): mirror GeoINT Live News feeds — shared dropdown + add-feed`.

---

### Task 8: Jukebox seek helper + rewind/FF icons

**Files:**
- Create: `src/renderer/modules/media/seek.ts`
- Modify: `src/renderer/modules/media/MediaPlayerModule.tsx` (add `IcoRewind`/`IcoFForward` SVGs + handlers)
- Test: `test/jukebox-seek.test.ts`

**Interfaces:**
- Produces: `clampSeek(cur: number, delta: number, dur: number): number`, `SEEK_STEP` (=10).

- [ ] **Step 1: Write the failing test** — `test/jukebox-seek.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampSeek } from '../src/renderer/modules/media/seek';

describe('clampSeek', () => {
  it('advances within range', () => expect(clampSeek(30, 10, 100)).toBe(40));
  it('clamps at 0', () => expect(clampSeek(5, -10, 100)).toBe(0));
  it('clamps at duration', () => expect(clampSeek(95, 10, 100)).toBe(100));
  it('handles NaN duration safely', () => expect(clampSeek(10, 10, NaN)).toBe(10));
  it('handles 0 duration', () => expect(clampSeek(0, 10, 0)).toBe(0));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `seek.ts`:**

```ts
export const SEEK_STEP = 10;

/** Clamp a seek to [0, dur]. NaN/≤0 duration → return the unchanged current time (nothing to seek). */
export function clampSeek(cur: number, delta: number, dur: number): number {
  if (!Number.isFinite(dur) || dur <= 0) return cur;
  return Math.max(0, Math.min(dur, cur + delta));
}
```

- [ ] **Step 4: Add icons + handlers** — in `MediaPlayerModule.tsx` add `IcoRewind`/`IcoFForward` SVGs alongside the existing `Ico*` set (lines 38-76; double-triangle seek glyphs, `currentColor`). Add handlers that seek the `<audio>` ref: `const seek = (d:number) => { const a = audioRef.current; if (a) a.currentTime = clampSeek(a.currentTime, d, a.duration); };` and bind rewind→`seek(-SEEK_STEP)`, FF→`seek(+SEEK_STEP)`. (Locate the existing audio element ref in the component.)

- [ ] **Step 5: Run tests + typecheck** — PASS/clean.

- [ ] **Step 6: Commit** — `feat(jukebox): seek helper + rewind/fast-forward controls`.

---

### Task 9: Jukebox WMP re-skin + smaller default

**Files:**
- Modify: `src/renderer/modules/media/MediaPlayerModule.tsx` (restructure compact deck lines 314-381), `src/renderer/modules/media/jukebox-window.ts` (`JUKEBOX_COMPACT_H`), `src/renderer/modules/register-builtins.tsx:243` (`defaultWidth`/`defaultHeight`), `src/renderer/styles/theme.css` (add `.ga98-wmp` rules; remove dead `.ga98-jukebox-lcd/-transport` 714-733)
- Test: `test/jukebox-window.test.ts` (update), plus a jsdom smoke in an existing media test

**Interfaces:**
- Consumes: `IcoRewind`/`IcoFForward`/`clampSeek` (Task 8), `logoUrl` from `../../assets/logo.png`.

- [ ] **Step 1: Update the height test** — set the expected `JUKEBOX_COMPACT_H` to the new value (210) in `test/jukebox-window.test.ts`; assert `jukeboxWindowHeight(true) === 210`, `jukeboxWindowHeight(false) === 840`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Shrink constants** — `jukebox-window.ts`: `JUKEBOX_COMPACT_H = 210`. `register-builtins.tsx:243`: `defaultHeight: 210` (keep in sync — the comment at 241-242 warns) and `defaultWidth: 380`.

- [ ] **Step 4: Re-skin the compact deck** — restructure `MediaPlayerModule.tsx` lines 314-381 into a `.ga98-wmp` player:
  - `import logoUrl from '../../assets/logo.png';`
  - A bordered "screen" `<div className="ga98-wmp-screen">` wrapping `<Visualizer/>` as the art area, with the logo bottom-right: `<img src={logoUrl} className="ga98-wmp-logo" alt="" style={{ imageRendering: 'pixelated' }} />`.
  - A transport row `<div className="ga98-wmp-transport">` with rewind / play / pause / stop / fast-forward (the classic five).
  - Keep the seek scrubber + volume + viz toggle in a slim status strip; keep the caret button (377-380) VERBATIM.
  - Move Prev/Next/Shuffle/Repeat into the expanded view (or a secondary strip in the status row) so the compact row stays the five WMP buttons.

- [ ] **Step 5: CSS** — in `theme.css` remove the dead `.ga98-jukebox-lcd/-transport` block (714-733); add `.ga98-wmp` (flex column), `.ga98-wmp-screen` (inset border, dark art bg, `position:relative`), `.ga98-wmp-logo` (`position:absolute; right:4px; bottom:4px; width:22px; height:22px; opacity:.9`), `.ga98-wmp-transport` (button row, Win98 raised buttons).

- [ ] **Step 6: jsdom smoke** — in an existing/new media test, render the collapsed player and assert: the five transport buttons render, the logo `img` is present, clicking the caret toggles `collapsed` (drives the resize effect). Keep it light.

- [ ] **Step 7: Run full suite + typecheck** — `pnpm test` all green; `pnpm typecheck` clean.

- [ ] **Step 8: Commit** — `feat(jukebox): Windows Media Player re-skin with GI98 logo + smaller default`.

---

## Post-tasks (controller, after all 9 green + whole-branch review)

- [ ] Bump `package.json` version → `3.34.0`.
- [ ] Write `RELEASE_NOTES_v3.34.0.md` (six features, install SHA/size filled after build).
- [ ] Update `README.md` (status line, changelog, version strings, test count).
- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-runs the whole suite — workflow green is per-covering-file only).
- [ ] `pnpm package:win`; grep packaged `app.asar` for `fileIconKind`, `documents:writeText`, `NewsFeedControls`, `clampSeek`, `ga98-wmp` (identifiers, not comments).
- [ ] Merge to main; GitHub release (gh-api + curl workaround); profile README 6-spot update.
- [ ] Confirm on the Windows smoke: icons, both DnD paths, Notepad→Docs, Investigation legibility, News mirror both directions, Jukebox WMP fit at 210px (nudge → v3.34.1 if off).

## Self-Review

- **Spec coverage:** WS1→T1, WS2→T2+T3+T4, WS3→T5, WS4→T6, WS5→T7, WS6→T8+T9. All six covered.
- **Type consistency:** `writeText(relDir,name,body)`/`readText(relPath)` signatures match across store/contract/preload/api.d.ts/consumers (T2↔T4↔T5); `clampSeek(cur,delta,dur)` and `SEEK_STEP` match T8↔T9; `FileIconKind`/`fileGlyphNode` match T1's producer/consumer.
- **Placeholder scan:** icon SVG bodies are described by contract + accent table + house-style reference (not fabricated pixel art) so the implementer matches `Icon.tsx`; the `ensureNoteBody` validator points to the existing `ensure*` module to mirror. No TODO/TBD.
- **Sequencing:** T2 before T4/T5 is stated in Global/Task headers.
