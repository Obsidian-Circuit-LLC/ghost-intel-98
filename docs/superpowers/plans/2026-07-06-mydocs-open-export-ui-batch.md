# My Documents Open/Export + UI batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give My Documents an in-app Open (decrypt→launch→session-shred) and Export decrypted copy, switch its view to a Win98 large-icons grid, reorder its context menu, default the Jukebox to compact, and surface a clearnet checkbox + Fallback/First mode in Q.

**Architecture:** Five workstreams over the existing DCS98 Electron/React/TS app. The security-load-bearing piece is a new `src/main/documents/open-temp.ts` that stages decrypted bytes into an app-dedicated temp dir, tracks them, shreds them on quit, and sweeps the dir on startup; `store.ts` gains `openEntry`/`exportEntry` on top of it. The renderer, Jukebox, and Q changes are thin wiring over settings and existing components (the Jukebox compact/expand UI already exists — only its default + persistence are new).

**Tech Stack:** Electron main (`node:fs/promises`, `electron` `app`/`shell`/`dialog`), React 18 renderer, Vitest (jsdom for renderer, `vi.mock('electron', …)` for main), `secure-fs` at-rest encryption layer.

## Global Constraints

- **Encrypt-at-rest is not weakened.** The vault store keeps ciphertext; the only new plaintext is (a) a session-scoped Open temp under `app.getPath('temp')/ga98-docopen`, shredded on quit and swept on startup, and (b) a copy the user explicitly Exports.
- **No new network egress** beyond the already-existing clearnet DuckDuckGo path, which stays behind an off-by-default toggle. Clearnet remains DDG-only; no new clearnet engines.
- **Win98 visual fidelity** — new surfaces use existing 98.css/inline-style idioms, not modern chrome.
- Commits authored `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, **no AI-identity trailers**, explicit-path `git add` only (never `-A`/`.`).
- Path confinement unchanged: every relPath crossing IPC is fenced by `ensureDocRelPath` and re-confined in the store via `confineExisting`. Traversal fails closed.
- Both new settings fields live in already-deep-merged groups (`ai`, `media`) — no new `mergeSettings` line needed, but each gets a merge-survival test (the v3.24.0 dataloss lesson).
- Run the FULL `pnpm test` + `pnpm typecheck` (both configs) after the workflow — per-file green is not suite green.

---

### Task 1: `open-temp.ts` + `openEntry`/`exportEntry` (main store)

**Files:**
- Create: `src/main/documents/open-temp.ts`
- Modify: `src/main/documents/store.ts` (imports at :8–:13; append two exports after `importDropped` at :177)
- Test: `test/documents-open-export.test.ts`

**Interfaces:**
- Consumes: `confineExisting(rel) → Promise<string>`, `resolveWithin` (store.ts); `isEncryptedFile(path) → Promise<boolean>`, `secureReadFile(path) → Promise<Buffer>` (secure-fs.ts).
- Produces:
  - `open-temp.ts`: `docOpenTempDir(): string`, `sweepDocOpenTemp(): Promise<void>`, `stageDecryptedTemp(bytes: Buffer, origName: string): Promise<string>`, `shredDocOpenTemps(): Promise<void>`.
  - `store.ts`: `openEntry(relPath: string): Promise<void>`, `exportEntry(relPath: string, destPath: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/documents-open-export.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let ROOT: string;      // fake dataRoot
let OSTMP: string;     // fake app temp
const openPath = vi.fn(async () => '');
const showItemInFolder = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'temp' ? OSTMP : ROOT) },
  shell: { openPath: (p: string) => openPath(p), showItemInFolder: (p: string) => showItemInFolder(p) },
}));
// secure-fs: encrypted iff first byte is 0x01 (test convention); decrypt = drop first byte.
vi.mock('../src/main/storage/secure-fs', () => ({
  isEncryptedFile: async (p: string) => (await readFile(p))[0] === 0x01,
  secureReadFile: async (p: string) => { const b = await readFile(p); return b[0] === 0x01 ? b.subarray(1) : b; },
  secureWriteFile: async (p: string, b: Buffer) => writeFile(p, b),
}));
vi.mock('../src/main/documents/paths', async () => {
  const { join: j } = await import('node:path');
  return {
    documentsRoot: () => j(ROOT, 'documents'),
    resolveWithin: (rel: string) => j(ROOT, 'documents', rel),
    ensureDocumentsRoot: async () => { await mkdir(j(ROOT, 'documents'), { recursive: true }); },
  };
});

beforeEach(async () => {
  ROOT = await mkdtemp(join(tmpdir(), 'ga98-docs-'));
  OSTMP = await mkdtemp(join(tmpdir(), 'ga98-tmp-'));
  await mkdir(join(ROOT, 'documents'), { recursive: true });
  openPath.mockClear();
});
afterEach(async () => { await rm(ROOT, { recursive: true, force: true }); await rm(OSTMP, { recursive: true, force: true }); });

describe('openEntry', () => {
  it('decrypts an encrypted file into a temp with the real extension and opens the temp', async () => {
    const store = await import('../src/main/documents/store');
    const { docOpenTempDir } = await import('../src/main/documents/open-temp');
    await writeFile(join(ROOT, 'documents', 'report.pdf'), Buffer.from([0x01, 0x50, 0x44, 0x46])); // "encrypted" %PDF
    await store.openEntry('report.pdf');
    const opened = openPath.mock.calls[0][0] as string;
    expect(opened.startsWith(docOpenTempDir())).toBe(true);
    expect(opened.endsWith('.pdf')).toBe(true);
    expect([...(await readFile(opened))]).toEqual([0x50, 0x44, 0x46]); // decrypted bytes
  });
  it('opens a plaintext file directly, without a temp', async () => {
    const store = await import('../src/main/documents/store');
    const { docOpenTempDir } = await import('../src/main/documents/open-temp');
    const real = join(ROOT, 'documents', 'notes.txt');
    await writeFile(real, Buffer.from('hi'));
    await store.openEntry('notes.txt');
    expect(openPath).toHaveBeenCalledWith(real);
    expect(await readdir(docOpenTempDir()).catch(() => [])).toEqual([]);
  });
  it('refuses to open a folder', async () => {
    const store = await import('../src/main/documents/store');
    await mkdir(join(ROOT, 'documents', 'sub'));
    await expect(store.openEntry('sub')).rejects.toThrow(/folder/i);
  });
});

describe('exportEntry', () => {
  it('writes decrypted bytes to the chosen destination', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'a.docx'), Buffer.from([0x01, 0x41, 0x42]));
    const dest = join(OSTMP, 'out.docx');
    await store.exportEntry('a.docx', dest);
    expect([...(await readFile(dest))]).toEqual([0x41, 0x42]);
  });
  it('refuses to export onto a symlink destination', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'a.docx'), Buffer.from([0x41]));
    const victim = join(OSTMP, 'victim'); await writeFile(victim, 'keep');
    const link = join(OSTMP, 'link'); await symlink(victim, link);
    await expect(store.exportEntry('a.docx', link)).rejects.toThrow(/symlink/i);
  });
});

describe('temp lifecycle', () => {
  it('sweep clears the dir; shred overwrites+unlinks tracked temps', async () => {
    const t = await import('../src/main/documents/open-temp');
    const p = await t.stageDecryptedTemp(Buffer.from('secret'), 'x.pdf');
    expect((await readFile(p)).toString()).toBe('secret');
    await t.shredDocOpenTemps();
    expect(await readFile(p).catch(() => 'GONE')).toBe('GONE');
    await t.sweepDocOpenTemp();
    expect(await readdir(t.docOpenTempDir())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/documents-open-export.test.ts`
Expected: FAIL — `open-temp` module and `openEntry`/`exportEntry` do not exist.

- [ ] **Step 3: Create `open-temp.ts`**

```ts
// src/main/documents/open-temp.ts
/**
 * Session-scoped plaintext staging for My Documents "Open". Decrypted bytes are written to an
 * app-dedicated temp dir so the OS default app can read them; every staged temp is tracked and
 * shredded (overwrite-then-unlink) on quit, and the whole dir is swept on startup — so a crash
 * bounds plaintext exposure to "until next launch", never indefinitely. Distinct from the Shred
 * recycle-bin store (shredStore), which is soft-delete/restore for case data.
 */
import { app } from 'electron';
import { join, extname } from 'node:path';
import { writeFile, rm, mkdir, stat, open as fsOpen } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

const tracked = new Set<string>();

export function docOpenTempDir(): string {
  return join(app.getPath('temp'), 'ga98-docopen');
}

/** Startup: wipe any stragglers a prior crash left, then recreate an empty dir. */
export async function sweepDocOpenTemp(): Promise<void> {
  await rm(docOpenTempDir(), { recursive: true, force: true });
  await mkdir(docOpenTempDir(), { recursive: true });
  tracked.clear();
}

/** Write decrypted bytes to a random-named temp preserving origName's extension; track for shred. */
export async function stageDecryptedTemp(bytes: Buffer, origName: string): Promise<string> {
  await mkdir(docOpenTempDir(), { recursive: true });
  const temp = join(docOpenTempDir(), `${randomUUID()}${extname(origName)}`);
  await writeFile(temp, bytes);
  tracked.add(temp);
  return temp;
}

async function shredOne(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (s.size > 0) {
      const fh = await fsOpen(path, 'r+');
      try { await fh.write(randomBytes(s.size), 0, s.size, 0); await fh.sync(); } finally { await fh.close(); }
    }
  } catch { /* gone or locked — startup sweep is the backstop */ }
  try { await rm(path, { force: true }); } catch { /* locked — swept next launch */ }
}

/** before-quit: shred every tracked temp, then remove the dir. Best-effort; sweep is the guarantee. */
export async function shredDocOpenTemps(): Promise<void> {
  for (const p of tracked) await shredOne(p);
  tracked.clear();
  try { await rm(docOpenTempDir(), { recursive: true, force: true }); } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Add `openEntry`/`exportEntry` to `store.ts`**

Change the imports at the top of `src/main/documents/store.ts`:

```ts
// line 8 — add writeFile, lstat
import { readdir, stat, lstat, rename as fsRename, rm, realpath, mkdir as fsMkdir, cp, readFile, writeFile } from 'node:fs/promises';
// line 13 — add isEncryptedFile, secureReadFile
import { secureWriteFile, isEncryptedFile, secureReadFile } from '../storage/secure-fs';
// new import
import { stageDecryptedTemp } from './open-temp';
```

Append after `importDropped` (after line 177):

```ts
/** Open a FILE in the OS default app. Encrypted-at-rest files are decrypted into a session-scoped
 *  temp (shredded on quit); plaintext files (vault off) are opened in place. Folders are refused. */
export async function openEntry(relPath: string): Promise<void> {
  const real = await confineExisting(relPath);
  if ((await stat(real)).isDirectory()) throw new Error('Refusing to open a folder.');
  let target = real;
  if (await isEncryptedFile(real)) {
    target = await stageDecryptedTemp(await secureReadFile(real), basename(real));
  }
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
}

/** Export one decrypted copy of a FILE to a user-chosen destination (outside the confinement root,
 *  by design). Refuses a folder and a symlink destination (can't be redirected to clobber a file). */
export async function exportEntry(relPath: string, destPath: string): Promise<void> {
  const real = await confineExisting(relPath);
  if ((await stat(real)).isDirectory()) throw new Error('Refusing to export a folder.');
  const existing = await lstat(destPath).catch(() => null);
  if (existing?.isSymbolicLink()) throw new Error('Refusing to export onto a symlink.');
  await writeFile(destPath, await secureReadFile(real));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/documents-open-export.test.ts`
Expected: PASS (all 6).

- [ ] **Step 6: Commit**

```bash
git add src/main/documents/open-temp.ts src/main/documents/store.ts test/documents-open-export.test.ts
git -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' commit --no-verify -m "feat(documents): openEntry/exportEntry + session-scoped decrypt-temp staging"
```

---

### Task 2: IPC surface + bootstrap wiring

**Files:**
- Modify: `src/shared/ipc-contracts.ts:266-274` (documents group)
- Modify: `src/main/ipc/register.ts:678` (after the `reveal` handler)
- Modify: `src/preload/index.ts:58-67` (documents block)
- Modify: `src/preload/api.d.ts:175-184` (documents block)
- Modify: `src/main/index.ts` (sweep on `whenReady` :273; shred in `before-quit` :404)
- Test: `test/documents-ipc-surface.test.ts` (extend existing)

**Interfaces:**
- Consumes: `store.openEntry`, `store.exportEntry` (Task 1); `sweepDocOpenTemp`, `shredDocOpenTemps` (Task 1); `ensureDocRelPath` (validate.ts); `dialog` (already imported in register.ts:17).
- Produces: IPC channels `documents.open`, `documents.export`; preload `window.api.documents.open(relPath)`, `.export(relPath)`.

- [ ] **Step 1: Write the failing test**

Add to `test/documents-ipc-surface.test.ts` (matching its existing mock style — it already asserts each documents channel routes through `ensureDocRelPath`):

```ts
it('documents.open validates relPath and calls openEntry', async () => {
  await invoke('documents:open', '../escape');
  expect(ensureDocRelPath).toHaveBeenCalledWith('../escape', 'relPath');
  expect(store.openEntry).toHaveBeenCalled();
});
it('documents.export opens a save dialog and no-ops on cancel', async () => {
  showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
  await invoke('documents:export', 'a.pdf');
  expect(store.exportEntry).not.toHaveBeenCalled();
  showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/a.pdf' });
  await invoke('documents:export', 'a.pdf');
  expect(store.exportEntry).toHaveBeenCalledWith('a.pdf', '/out/a.pdf');
});
```

If the existing test file lacks `showSaveDialog`/`store` mocks, add to its `vi.mock('electron', …)` a `dialog: { showSaveDialog }` where `const showSaveDialog = vi.fn()`, and to the documents-store mock `openEntry: vi.fn()`, `exportEntry: vi.fn()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/documents-ipc-surface.test.ts`
Expected: FAIL — `documents:open` / `documents:export` channels are not registered.

- [ ] **Step 3: Add the channels** (`src/shared/ipc-contracts.ts`, inside the `documents:` object at :266)

```ts
    reveal: 'documents:reveal',
    open: 'documents:open',
    export: 'documents:export'
```

- [ ] **Step 4: Add the handlers** (`src/main/ipc/register.ts`, immediately after the `reveal` handler at :678-679)

```ts
  safeHandle(channels.documents.open, (...args) =>
    documentsStore.openEntry(ensureDocRelPath(args[0], 'relPath')));
  safeHandle(channels.documents.export, async (...args) => {
    const rel = ensureDocRelPath(args[0], 'relPath');
    const name = rel.split('/').pop() || 'file'; // rel uses '/'; avoid platform basename ambiguity
    const res = await dialog.showSaveDialog({ defaultPath: name });
    if (res.canceled || !res.filePath) return;
    await documentsStore.exportEntry(rel, res.filePath);
  });
```

- [ ] **Step 5: Add preload bindings**

`src/preload/index.ts` (inside the documents block, after `reveal` at :67 — add a comma after reveal):

```ts
    reveal: (relPath: string) => ipcRenderer.invoke(channels.documents.reveal, relPath),
    open: (relPath: string) => ipcRenderer.invoke(channels.documents.open, relPath),
    export: (relPath: string) => ipcRenderer.invoke(channels.documents.export, relPath)
```

`src/preload/api.d.ts` (inside the documents block, after `reveal` at :183):

```ts
    reveal(relPath: string): Promise<void>;
    open(relPath: string): Promise<void>;
    export(relPath: string): Promise<void>;
```

- [ ] **Step 6: Wire bootstrap** (`src/main/index.ts`)

Add the import near the other main imports:

```ts
import { sweepDocOpenTemp, shredDocOpenTemps } from './documents/open-temp';
```

Inside the `app.whenReady().then(async () => { … })` body (starts :273), add near the other startup singletons (a failure here must not abort the rest — wrap it):

```ts
  try { await sweepDocOpenTemp(); } catch { /* non-fatal — Open re-creates the dir on demand */ }
```

Inside the existing async `before-quit` cleanup block (:404, the branch that runs when `quitCleanupDone` is still false, alongside the SSH-drain / AI-stream-cancel cleanup), add:

```ts
    await shredDocOpenTemps(); // shred decrypted Open temps before the process exits
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run test/documents-ipc-surface.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts src/main/index.ts test/documents-ipc-surface.test.ts
git -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' commit --no-verify -m "feat(documents): open/export IPC + startup-sweep/quit-shred bootstrap wiring"
```

---

### Task 3: Renderer — Open/Export, large-icons grid, context-menu reorder

**Files:**
- Modify: `src/renderer/modules/my-documents/useDocuments.ts` (add `open`, `exportFile`; return them)
- Modify: `src/renderer/modules/my-documents/DocumentsContextMenu.tsx` (reorder; add Open/Export)
- Modify: `src/renderer/modules/my-documents/MyDocumentsModule.tsx` (grid view; double-click file → open; wire new menu props)
- Test: `test/my-documents-module.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `window.api.documents.open`, `.export` (Task 2).
- Produces: `useDocuments()` return gains `open(rel): Promise<void>` and `exportFile(rel): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Add to `test/my-documents-module.test.tsx` (jsdom, createRoot/act; the file already stubs `window.api.documents`). Extend the `documents` stub with `open: vi.fn(async () => {})` and `export: vi.fn(async () => {})`, then:

```ts
it('double-clicking a file calls documents.open', async () => {
  api.documents.list.mockResolvedValue([{ name: 'a.pdf', kind: 'file', size: 3, modifiedAt: 'x' }]);
  await mountModule();
  const tile = document.querySelector('.ga98-mydocs-tile') as HTMLElement;
  await act(async () => { tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(api.documents.open).toHaveBeenCalledWith('a.pdf');
});

it('context menu lists New Folder first, Paste under Cut, Open/Export files-only', async () => {
  api.documents.list.mockResolvedValue([{ name: 'a.pdf', kind: 'file', size: 3, modifiedAt: 'x' }]);
  await mountModule();
  const tile = document.querySelector('.ga98-mydocs-tile') as HTMLElement;
  await act(async () => { tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); });
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent);
  expect(labels[0]).toBe('New Folder');
  expect(labels).toEqual(['New Folder', 'Open', 'Rename', 'Delete', 'Copy', 'Cut', 'Paste', 'Export…']);
});
```

(`mountModule`/`api` follow the file's existing harness; reuse them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/my-documents-module.test.tsx`
Expected: FAIL — no `.ga98-mydocs-tile`, menu order differs, `open` not called.

- [ ] **Step 3: Add `open`/`exportFile` to `useDocuments.ts`**

Insert after `reveal` (:85) and add both to the returned object (:87):

```ts
  const open = useCallback(async (rel: string) => {
    try { await window.api.documents.open(rel); }
    catch (e) { setError((e as Error).message); }
  }, []);
  const exportFile = useCallback(async (rel: string) => {
    try { await window.api.documents.export(rel); }
    catch (e) { setError((e as Error).message); }
  }, []);
```

```ts
  return { dir, entries, error, clipboard, enter, up, goRoot, refresh, newFolder, rename, remove, paste, importFiles, reveal, open, exportFile };
```

- [ ] **Step 4: Reorder + extend `DocumentsContextMenu.tsx`**

Add two props to the `Props` interface:

```ts
  onOpen(e: DocEntry): void;
  onExport(e: DocEntry): void;
```

Replace the menu body (the JSX between the opening `<div role="menu" …>` and its close) item list with:

```tsx
      {item('New Folder', p.onNewFolder)}
      <div className="ga98-access-separator" />
      {e && e.kind === 'file' && item('Open', () => p.onOpen(e))}
      {e && item('Rename', () => p.onRename(e))}
      {e && item('Delete', () => p.onDelete(e))}
      {e && item('Copy', () => p.onCopy(e))}
      {e && item('Cut', () => p.onCut(e))}
      {item('Paste', p.onPaste, !p.canPaste)}
      {e && e.kind === 'file' && item('Export…', () => p.onExport(e))}
```

- [ ] **Step 5: Grid view + wiring in `MyDocumentsModule.tsx`**

Replace the entries render block (:75-86 — the `{doc.entries.length === 0 …}` line and the `{doc.entries.map(…)}` block) with a large-icons grid:

```tsx
        {doc.entries.length === 0 && <div style={{ opacity: 0.6 }}>This folder is empty.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
          {doc.entries.map((e) => (
            <div
              key={e.name}
              className="ga98-mydocs-tile"
              style={{ width: 88, textAlign: 'center', cursor: 'pointer', userSelect: 'none', padding: 4 }}
              title={e.name}
              onDoubleClick={() => (e.kind === 'folder' ? doc.enter(e.name) : void doc.open(joinRel(doc.dir, e.name)))}
              onContextMenu={(ev) => openMenu(ev, e)}
            >
              <div style={{ fontSize: 40, lineHeight: 1 }}>{e.kind === 'folder' ? '📁' : '📄'}</div>
              <div style={{ fontSize: 11, wordBreak: 'break-word' }}>{e.name}</div>
            </div>
          ))}
        </div>
```

Add the two new props to the `<DocumentsContextMenu … />` element (:88-99):

```tsx
          onOpen={(e) => void doc.open(joinRel(doc.dir, e.name))}
          onExport={(e) => void doc.exportFile(joinRel(doc.dir, e.name))}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run test/my-documents-module.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/my-documents/useDocuments.ts src/renderer/modules/my-documents/DocumentsContextMenu.tsx src/renderer/modules/my-documents/MyDocumentsModule.tsx test/my-documents-module.test.tsx
git -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' commit --no-verify -m "feat(documents): large-icons grid, Open on double-click, context-menu reorder + Open/Export"
```

---

### Task 4: Jukebox — compact by default + persisted

**Files:**
- Modify: `src/shared/types.ts` (media settings type :439-ish; default at :679)
- Modify: `src/renderer/modules/media/MediaPlayerModule.tsx` (:82-97 init; caret onClick :362)
- Test: `test/jukebox-compact.test.ts` (new — settings default + merge survival)

**Interfaces:**
- Consumes: `useSettings` store `settings`/`patch` (already used in MediaPlayerModule); `mergeSettings` (json-fs.ts).
- Produces: `AppSettings.media.jukeboxExpanded: boolean` (default `false`).

- [ ] **Step 1: Write the failing test**

```ts
// test/jukebox-compact.test.ts
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
import { mergeSettings } from '../src/main/storage/json-fs';

describe('jukeboxExpanded setting', () => {
  it('defaults to false (compact)', () => {
    expect(defaultSettings.media.jukeboxExpanded).toBe(false);
  });
  it('survives an upgrade from a settings file that predates it', () => {
    const legacy = { ...defaultSettings, media: { streamingEnabled: true, visualizer: false } } as any;
    const merged = mergeSettings(defaultSettings, legacy);
    expect(merged.media.jukeboxExpanded).toBe(false);      // default filled in
    expect(merged.media.streamingEnabled).toBe(true);      // legacy value preserved
  });
});
```

(`defaultSettings` is exported from `src/shared/types.ts`; `mergeSettings` from `src/main/storage/json-fs.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/jukebox-compact.test.ts`
Expected: FAIL — `media.jukeboxExpanded` is `undefined`.

- [ ] **Step 3: Add the setting** (`src/shared/types.ts`)

In the `media:` type block (after `visualizer: boolean;`):

```ts
    /** Jukebox opens in the compact (deck-only) view by default; the caret expands it to the file
     *  toolbar + Library/Stations. Persists the user's last choice. Default false = compact. */
    jukeboxExpanded: boolean;
```

In the default settings (`media: { streamingEnabled: false, visualizer: true }` at :679):

```ts
  media: { streamingEnabled: false, visualizer: true, jukeboxExpanded: false },
```

- [ ] **Step 4: Default compact + persist in `MediaPlayerModule.tsx`**

Replace the collapsed state init (:97) with a settings-seeded version. After the `visualizer` line (:85) add:

```ts
  const jukeboxExpanded = settings?.media.jukeboxExpanded ?? false;
```

Change :97 to seed from the setting and sync once the store hydrates (settings may be null on first render):

```ts
  const [collapsed, setCollapsed] = useState(!jukeboxExpanded);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current && settings) { hydratedRef.current = true; setCollapsed(!settings.media.jukeboxExpanded); }
  }, [settings]);
```

Change the caret button `onClick` (:362) to persist the new state (expanded = !collapsed):

```tsx
        <button onClick={() => setCollapsed((c) => { const next = !c; void patch({ media: { streamingEnabled, visualizer, jukeboxExpanded: !next } }); return next; })}
          style={{ marginLeft: 8, minWidth: 0, padding: '0 6px' }}
          title={collapsed ? 'Expand library & stations' : 'Collapse to the compact player'}
          aria-pressed={collapsed} aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▼' : '▲'}</button>
```

(`useEffect`/`useRef`/`useState` are already imported in this file at line 11 — no import change needed.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/jukebox-compact.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/modules/media/MediaPlayerModule.tsx test/jukebox-compact.test.ts
git -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' commit --no-verify -m "feat(jukebox): open compact by default, persist expand/collapse choice"
```

---

### Task 5: Q — clearnet checkbox + Fallback/First mode

**Files:**
- Modify: `src/main/services/web-search/directive.ts` (add `clearnetFirst`)
- Modify: `src/main/services/ai.ts` (:27 import; :151-157 clearnet-first branch)
- Modify: `src/shared/types.ts` (ai type after `webSearchClearnet` :416; ai default :653-block)
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx` (:657 after the engine `<select>`)
- Test: `test/web-search-directive.test.ts` (extend) + reuse `test/jukebox-compact.test.ts` pattern for the merge (add a case, or a small `test/q-clearnet-mode.test.ts`)

**Interfaces:**
- Consumes: `searchWebClearnet`, `formatWebResults`, `getEngine`, `engineDisplayName` (ai.ts already imports these).
- Produces: `clearnetFirst(opts): boolean` (directive.ts); `AppSettings.ai.webSearchClearnetMode: 'fallback' | 'first'` (default `'fallback'`).

- [ ] **Step 1: Write the failing test**

Add to `test/web-search-directive.test.ts`:

```ts
import { clearnetFirst } from '../src/main/services/web-search/directive';

describe('clearnetFirst', () => {
  it('is true only when clearnet on, engine eligible, and mode "first"', () => {
    expect(clearnetFirst({ clearnetOn: true, clearnetEligible: true, mode: 'first' })).toBe(true);
  });
  it('is false in fallback mode', () => {
    expect(clearnetFirst({ clearnetOn: true, clearnetEligible: true, mode: 'fallback' })).toBe(false);
  });
  it('is false for an ineligible engine even in "first" (SearXNG has no clearnet path)', () => {
    expect(clearnetFirst({ clearnetOn: true, clearnetEligible: false, mode: 'first' })).toBe(false);
  });
  it('is false when clearnet is disabled', () => {
    expect(clearnetFirst({ clearnetOn: false, clearnetEligible: true, mode: 'first' })).toBe(false);
  });
});
```

And a merge/default case (append to `test/jukebox-compact.test.ts` or a new file):

```ts
it('ai.webSearchClearnetMode defaults to "fallback" and survives merge', () => {
  expect(defaultSettings.ai.webSearchClearnetMode).toBe('fallback');
  const legacy = { ...defaultSettings, ai: { ...defaultSettings.ai } } as any;
  delete legacy.ai.webSearchClearnetMode;
  expect(mergeSettings(defaultSettings, legacy).ai.webSearchClearnetMode).toBe('fallback');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/web-search-directive.test.ts test/jukebox-compact.test.ts`
Expected: FAIL — `clearnetFirst` undefined; `webSearchClearnetMode` undefined.

- [ ] **Step 3: Add `clearnetFirst`** (`src/main/services/web-search/directive.ts`, after `planWebSearch` at :50)

```ts
/** Pre-Tor decision: should this search SKIP Tor and go straight to clearnet? True only when clearnet
 *  is enabled, the selected engine has a clearnet path (DDG), AND the user chose 'first' mode. In every
 *  other case the Tor path runs first and `planWebSearch` governs the post-Tor fallback. Pure/testable. */
export function clearnetFirst(opts: { clearnetOn: boolean; clearnetEligible?: boolean; mode: 'fallback' | 'first' }): boolean {
  return opts.clearnetOn && opts.clearnetEligible !== false && opts.mode === 'first';
}
```

- [ ] **Step 4: Add the setting** (`src/shared/types.ts`)

After `webSearchClearnet: boolean;` (:416):

```ts
    /** When clearnet is enabled, whether it runs as a FALLBACK (Tor first; clearnet only on an empty
     *  Tor result — the default, safer) or FIRST (skip Tor; query clearnet DDG directly — faster but
     *  exposes the real IP on every search). Meaningful only when webSearchClearnet is true and the
     *  selected engine has a clearnet path (DDG). Default 'fallback'. */
    webSearchClearnetMode: 'fallback' | 'first';
```

In the `ai:` default block (starts :653), after the `webSearchClearnet: false,` line:

```ts
    webSearchClearnetMode: 'fallback',
```

- [ ] **Step 5: Wire the clearnet-first branch in `ai.ts`**

Extend the directive import (:27) to add `clearnetFirst`:

```ts
import { extractSearchDirective, formatWebResults, planWebSearch, clearnetFirst, decideSearchAction, torFailureMessage, formatSearchAnnounce, WEB_SEARCH_SYSTEM, MAX_WEB_SEARCHES } from './web-search/directive';
```

Replace lines :151-158 (from `const engine = getEngine(...)` through `messages.push({ role: 'assistant', content: full });`) with — note `fence` moves up so the new branch can use it, and the later `const fence = …` at :157 is removed:

```ts
      const engine = getEngine(s.ai.searchEngine);
      const fence = randomBytes(8).toString('hex');
      // Clearnet-FIRST: user opted to skip Tor for DDG. Announce the IP exposure, query clearnet,
      // and continue — the normal Tor path below is not run for this iteration.
      if (clearnetFirst({ clearnetOn: s.ai.webSearchClearnet, clearnetEligible: engine.id === 'ddg', mode: s.ai.webSearchClearnetMode })) {
        messages.push({ role: 'assistant', content: full });
        emit(getWindow, streamId, { chunk: `\n\n⚠ Clearnet-first is ON — querying DuckDuckGo over CLEARNET for “${q}” (skipping Tor); your real IP is exposed to these results and their hosts.\n\n` });
        const cn = await searchWebClearnet(q);
        emit(getWindow, streamId, { chunk: `\n(${cn.length} result(s) over CLEARNET)\n` });
        messages.push({ role: 'user', content: formatWebResults(q, cn, fence) });
        continue;
      }
      emit(getWindow, streamId, { chunk: formatSearchAnnounce(engineDisplayName(engine), q) });
      const { results, reason: searchReason } = await engine.run(q, {
        caseId: req.caseId,
        endpoint: endpointForEngine(engine, s.ai.searxngOnion),
      });
      messages.push({ role: 'assistant', content: full });
```

(The `planWebSearch` block that follows at :162-182 is unchanged — it still governs Fallback mode.)

- [ ] **Step 6: Add the UI controls** (`src/renderer/modules/ai-assistant/AiAssistantModule.tsx`, immediately after the engine `<select>` closes at :657)

```tsx
        <label style={{ fontSize: 11 }} title="Allow Q to use clearnet DuckDuckGo. Off = Tor-only (IP hidden).">
          <input
            type="checkbox"
            checked={settings?.ai.webSearchClearnet ?? false}
            onChange={(e) => { if (settings) void patchSettings({ ai: { ...settings.ai, webSearchClearnet: e.target.checked } }); }}
          />
          &nbsp;Clearnet
        </label>
        {settings?.ai.webSearchClearnet && (
          <select
            className="ga98-text"
            style={{ maxWidth: 120, fontSize: 11 }}
            value={settings?.ai.webSearchClearnetMode ?? 'fallback'}
            onChange={(e) => { if (settings) void patchSettings({ ai: { ...settings.ai, webSearchClearnetMode: e.target.value as 'fallback' | 'first' } }); }}
            title={(settings?.ai.webSearchClearnetMode ?? 'fallback') === 'first'
              ? 'Clearnet-first: skips Tor and queries DuckDuckGo directly — exposes your real IP on every search.'
              : 'Fallback: Tor first; clearnet only if Tor returns nothing.'}
          >
            <option value="fallback">Fallback</option>
            <option value="first">First (no Tor)</option>
          </select>
        )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run test/web-search-directive.test.ts test/jukebox-compact.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/web-search/directive.ts src/main/services/ai.ts src/shared/types.ts src/renderer/modules/ai-assistant/AiAssistantModule.tsx test/web-search-directive.test.ts test/jukebox-compact.test.ts
git -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' commit --no-verify -m "feat(q): clearnet enable checkbox + Fallback/First mode (off by default)"
```

---

## Final verification (controller, after all tasks)

- [ ] `pnpm typecheck` clean across both project configs.
- [ ] Full `pnpm test` green (not just the touched files — the v3.32.0 stale-snapshot lesson).
- [ ] Manual smoke (operator, Windows VM): import a PDF + docx into My Documents with the vault on →
      right-click → **Open** launches them readable (not "unreadable content"); **Export…** writes a
      readable copy to a chosen path; the on-disk file in Explorer is still ciphertext. Jukebox opens
      compact; caret expands; choice survives a reopen. Q: Clearnet unchecked = Tor-only; checked +
      Fallback = today's behavior; checked + First = direct DDG with the IP-exposure warning; the mode
      control is inert (Tor-only) when the SearXNG engine is selected.

## Self-review notes

- **Spec coverage:** WS1 → Tasks 1-3; WS2 → Task 3 (grid); WS3 → Task 3 (menu); WS4 → Task 4; WS5 → Task 5.
  Both settings fields land in already-merged groups (`media`, `ai`) with a merge-survival test each.
- **Type consistency:** `openEntry(relPath)`, `exportEntry(relPath, destPath)`, `stageDecryptedTemp(bytes,
  origName)`, `clearnetFirst({clearnetOn, clearnetEligible?, mode})`, `webSearchClearnetMode:
  'fallback'|'first'`, `media.jukeboxExpanded: boolean` — used identically in every task that references them.
- **Discovery folded in:** the Jukebox compact/expand UI already exists (`collapsed` state + caret +
  `{!collapsed && …}`); Task 4 only changes its default and persists it, rather than rebuilding it.
