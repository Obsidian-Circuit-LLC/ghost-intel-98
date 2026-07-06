# My Documents — Design Spec

**Date:** 2026-07-06
**Status:** Approved (design) — pending implementation plan
**Origin:** GhostExodus field feedback (screenshot: classic Win98 "My Documents" desktop icon + folder window). Relayed by operator.

## Summary

Add a **My Documents** module to Ghost Intel 98: a global, personal file manager reached from a
new desktop icon placed directly below **My Cases**. It supports nested folders, a right-click
context menu (New Folder / Rename / Delete / Copy / Cut / Paste), inline rename of files and
folders, drag-and-drop import of files from the host PC, and "Reveal in Explorer" on the storage
directory. As a companion decluttering change, **Calendar**, **Reminders**, and **Chat** move off
the desktop into the Access menu.

My Documents is a single **global** store (a peer of My Cases), not per-case.

## Decisions (operator-set)

1. **Storage model — vault-consistent, real names.** Files live under `dataRoot` and route through
   `secure-fs`: encrypted at rest when login/vault is enabled, plaintext when it is not — the same
   rule as every other data store in the app. Files keep their **original names** on disk (folder
   tree stays legible; "Reveal in Explorer" is meaningful). `secure-fs` encrypts file **contents
   only**, never names, so real names cost nothing and no `originalName` sidecar is required.
   - **Honest edge:** when the vault is enabled, on-disk bytes are AES-GCM ciphertext. A file
     revealed in Windows Explorer shows its real name but cannot be opened outside Ghost Intel 98.
     The UI states this plainly (see §UI, encryption banner). This is the accepted consequence of
     the charter's encrypt-at-rest invariant, which My Documents does **not** weaken.
2. **Scope — one global store.** A single personal file tree, independent of any case.

## Non-goals (YAGNI)

- Dragging files *out* of My Documents onto the host PC.
- Routing deletes through the Shred module (plain delete with a UI confirm instead).
- Any network egress, telemetry, or phone-home. My Documents is purely local file IO.

## Architecture

Three layers, mirroring existing module conventions:

```
Renderer  src/renderer/modules/my-documents/   (UI: folder window, context menu, drag-drop)
   │  window.api.documents.*  (preload bridge)
IPC       channels.documents.* + safeHandle wrappers (validation boundary)
   │
Main      src/main/documents/{paths,store}.ts   (confined file IO through secure-fs)
          on disk: dataRoot/documents/…         (real folder tree, encrypted-at-rest content)
```

### Storage layout

```
dataRoot()/documents/                 ← documentsRoot()
  <folder>/<subfolder>/<file>         ← real nested dirs, real filenames
```

`dataRoot()` is `app.getPath('userData')/GhostAccess98/` (see `src/main/storage/paths.ts`).

## Main process

### `src/main/documents/paths.ts`

- `documentsRoot(): string` → `join(dataRoot(), 'documents')`.
- `resolveWithin(rel: string): string` — join `documentsRoot()` with a **pre-validated** relative
  path. Never accepts an absolute path.
- `ensureDocumentsRoot(): Promise<void>` — `mkdir(documentsRoot(), { recursive: true })`.

### `src/main/documents/store.ts`

All operations are confinement-checked (see §Security) and route file content through
`secureReadFile` / `secureWriteFile` from `src/main/storage/secure-fs.ts`.

| Method | Signature | Behaviour |
|---|---|---|
| `list` | `(relDir: string) => Promise<DocEntry[]>` | Directory listing of `relDir` (`''` = root). ENOENT → `[]`. Each entry: `{ name, kind: 'file' \| 'folder', size, modifiedAt }`. Sorted folders-first, then name (locale-independent `localeCompare` with a fixed locale, or codepoint sort — deterministic). |
| `mkdir` | `(relDir: string, name: string) => Promise<void>` | Create `relDir/name`. Fails if it exists. |
| `rename` | `(relPath: string, newName: string) => Promise<void>` | Rename the leaf of `relPath` to `newName` in the same parent. Rejects if target exists. |
| `remove` | `(relPath: string) => Promise<void>` | Delete file, or folder recursively (`rm(..., { recursive: true })`). |
| `copy` | `(srcRel: string, destDir: string) => Promise<string>` | Copy file or folder (recursive) into `destDir`; on name collision append ` (n)` before the extension until unique. Returns the final relative path. Content re-encrypts under the current DEK (read-decrypt then write-encrypt), so copies are valid ciphertext, not double-encrypted blobs. |
| `move` | `(srcRel: string, destDir: string) => Promise<string>` | Move into `destDir` (rename within `documentsRoot`); collision-uniqued like `copy`. Returns final relative path. Reject moving a folder into its own descendant. |
| `importDropped` | `(destDir: string, files: {sourcePath: string; originalName: string}[]) => Promise<ImportResult>` | For each dropped host file: read source (plaintext, outside dataRoot), `secureWriteFile` into `destDir` under a collision-uniqued real name. Returns `{ imported: DocEntry[]; failures: {originalName, error}[] }`. Mirrors `fileStore.importDropped`. |
| `reveal` | `(relPath: string) => void` | `shell.showItemInFolder(resolved)`. `relPath === ''` reveals `documentsRoot` itself. |

Shared types (in `src/shared/` so preload/renderer/main agree):

```ts
export interface DocEntry { name: string; kind: 'file' | 'folder'; size: number; modifiedAt: string; }
export interface DocImportResult { imported: DocEntry[]; failures: { originalName: string; error: string }[]; }
```

## Security (the load-bearing surface)

Every path segment originates in the renderer and is therefore untrusted. Two independent defences,
both required:

1. **Segment validation at the IPC boundary.** A new validator `ensureDocRelPath(value, ctx)` in
   `src/main/security/validate.ts`:
   - Rejects non-strings, absolute paths, and anything containing a path separator that is not an
     internal `/` between valid segments.
   - Splits on `/`; each segment must be non-empty, not `.` or `..`, ≤ 255 chars, contain no
     `NUL`/control chars and none of `\\ / : * ? " < > |`, and must not be a reserved Win32 device
     name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, case-insensitive, with or
     without extension). Total path length bounded.
   - `newName` / single folder names go through a single-segment variant `ensureDocName`.
   - Returns the normalized relative path (POSIX-joined) for the store to consume.

2. **realpath confinement inside every store op.** Before acting, `realpath` the resolved candidate
   (and, for create/rename/copy/move destinations, the parent dir) and assert the result equals
   `documentsRoot` or is prefixed by `documentsRoot + sep`. This closes symlink-escape and
   TOCTOU-adjacent gaps that pure string validation cannot. Mirrors the confinement check in the
   `files.mediaUrl` handler (`src/main/ipc/register.ts`).

A traversal attempt fails **closed** — the op throws and touches nothing outside the root.

## IPC & preload

- `src/shared/ipc-contracts.ts` (or the channels module): add a `documents` channel group —
  `list`, `mkdir`, `rename`, `remove`, `copy`, `move`, `importDropped`, `reveal`.
- `src/main/ipc/register.ts`: `safeHandle` for each, applying `ensureDocRelPath` / `ensureDocName`
  to every path argument before delegating to `store`.
- `src/preload/index.ts` + `src/preload/api.d.ts`: `window.api.documents.*` typed bridge.

## Renderer

`src/renderer/modules/my-documents/` — global module, registered with **no props**.

Suggested split (each file one clear responsibility):
- `MyDocumentsModule.tsx` — window shell: toolbar, breadcrumb, current-folder view, wiring.
- `useDocuments.ts` — hook holding current relative dir, entry list, load/refresh, and the mutation
  calls (mkdir/rename/remove/copy/move/import) against `window.api.documents`.
- `DocumentsContextMenu.tsx` — the right-click menu (New Folder / Rename / Delete / Copy / Cut /
  Paste), Win98-styled.

UI behaviour:
- **Toolbar:** New Folder · Up (disabled at root) · Reveal in Explorer.
- **Breadcrumb:** clickable path segments back to root.
- **Folder view:** icon/detail list; double-click a folder to enter it. Double-click a **file**
  reveals it in Explorer (`reveal`); when the vault is off it is then openable there. (The existing
  doc-viewer is bound to *case* attachments — `caseId`/`fileName` — so wiring it to serve a global
  documents file is deliberately out of scope for this pass; note it as a possible follow-up.)
- **Context menu:** on an item (Rename / Delete / Copy / Cut) and on empty space (New Folder /
  Paste). Cut/Copy set a module-level clipboard `{ op: 'copy'|'cut', relPath }`; Paste calls
  `copy`/`move` into the current dir, then refreshes.
- **Inline rename:** the selected item's label becomes a text field; Enter commits via `rename`,
  Escape cancels.
- **Drag-drop import:** an `onDrop` over the folder view reads `e.dataTransfer.files[i].path`
  (Electron exposes the absolute host path) and calls `importDropped(currentDir, files)`. A drag
  overlay indicates the drop target. Failures surface in a small toast/list.
- **Internal drag:** dragging an entry onto a folder in the same view calls `move`.
- **Delete confirm:** `confirmDialog` before `remove` (recursive for folders).
- **Encryption banner:** when login/vault is enabled, a persistent one-line note: *"Files are
  encrypted at rest — open them here, not in Explorer."* Hidden when the vault is off.

GhostExodus has ADHD (standing UI constraint): one-click actions, immediate feedback after every
mutation (list refreshes, brief confirmation), plain language, one clear next action, visible
progress on multi-file imports.

## Desktop / Access menu / icon wiring (5-point module pattern)

1. **`ModuleKey` union** (`src/renderer/state/store.ts`): add `'my-documents'`.
2. **register-builtins** (`src/renderer/modules/register-builtins.tsx`): `MyDocumentsAdapter`
   (no props) + `registerModule({ key: 'my-documents', title: 'My Documents', glyph: '📂',
   component: MyDocumentsAdapter, builtin: true, defaultWidth: 720, defaultHeight: 520 })`.
3. **Desktop** (`src/renderer/shell/Desktop.tsx`): insert `{ module: 'my-documents', label: 'My
   Documents' }` into `desktopShortcutDefaults` immediately after `cases`; **remove** the
   `calendar`, `reminders`, and `chat` entries from that list.
4. **Icon** (`src/renderer/shell/Icon.tsx`): add `MyDocumentsGlyph` — a hand-drawn crisp-edges SVG
   of the classic Win98 My Documents icon (manila/tan folder with a white ruled document sheet
   peeking out over the top), matching the existing `MyComputerGlyph`/`NotepadGlyph` style; wire
   `if (m === 'my-documents') return <MyDocumentsGlyph />;` into `glyphNodeFor`.
5. **Access menu reachability for the three moved tools** (`src/shared/types.ts`): Calendar and
   Reminders are already in `defaultShortcuts`, so they remain in the Access menu after leaving the
   desktop. **Chat** is not — add `{ id: 'chat', label: 'Chat (beta)', kind: 'module', target:
   'chat', icon: 'chat' }` to both `defaultShortcuts` and `REQUIRED_MODULE_SHORTCUTS` so the
   settings reconciler seeds it into existing installs (append-only; a user who later deletes it
   stays deleted).
6. **ModuleHost** (`src/renderer/modules/ModuleHost.tsx`): if it still routes via a compile-time
   switch, add a `my-documents` arm; if it is already registry-driven, no change. (Verify during
   implementation.)

## Testing

**Main — `test/documents-store.test.ts`** (node), against a temp `dataRoot` with a mocked vault:
- Round-trip: `mkdir` → `list` shows it; write a file via `importDropped` → `list` shows it with
  real name and correct size; `rename`, `move`, `copy`, `remove` each reflected in a fresh `list`.
- Nested folders: create `a/b/c`, list each level.
- `copy` / `move` collision → ` (n)` uniquing; returned relative path is correct.
- `move` a folder into its own descendant → rejected.
- **Encrypted round-trip:** with the vault mock reporting unlocked+enabled, a written file's on-disk
  bytes are ciphertext (magic-prefixed) while `secureReadFile` returns the original plaintext.
- **Path-traversal rejection on every op:** `../`, absolute paths, embedded separators in a name,
  and a reserved Win32 name are all rejected and touch nothing outside `documentsRoot`.

**Validator — `test/document-path-validation.test.ts`** (node): `ensureDocRelPath` /
`ensureDocName` accept valid inputs and reject each traversal/illegal-char/reserved-name/over-length
class.

**Renderer — `test/my-documents-module.test.tsx`** (jsdom, React 18 `createRoot`/`act`, no
@testing-library): with `window.api.documents` mocked — initial `list` renders entries; New Folder
calls `mkdir` then refreshes; Rename commits via `rename`; Delete (after confirm) calls `remove`;
Copy+Paste calls `copy` into the current dir. Encryption banner shows only when the vault is
enabled.

**Wiring — `test/my-documents-wiring.test.ts(x)`**: `desktopShortcutDefaults` no longer contains
`calendar`/`reminders`/`chat` and does contain `my-documents` positioned after `cases`;
`defaultShortcuts` and `REQUIRED_MODULE_SHORTCUTS` contain `chat`; the module registry resolves
`my-documents` with title `My Documents`.

## Release

Rides the next version bump (currently accumulating with the SearXNG instance editor on `main`).
At cut time: version bump in `package.json`, README Status + changelog, release notes, test-count
refresh, and the standard pre-ship reachability audit (this feature adds a desktop launcher and a
menu reachability change — exactly the class the audit exists to catch).

## Charter alignment

- **Encrypt-at-rest preserved:** My Documents routes through `secure-fs`; it does not weaken the
  invariant. The only visible consequence (ciphertext bytes under Explorer when the vault is on) is
  surfaced honestly in the UI.
- **No new egress / no telemetry:** local file IO only.
- **Untrusted input fenced:** dual-layer path confinement (segment validation + realpath prefix)
  at the trust boundary; traversal fails closed.
- **Determinism:** listing order is a pure function of entry names/kinds (no clock, no iteration
  order dependence).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, no AI
  identity trailers.
