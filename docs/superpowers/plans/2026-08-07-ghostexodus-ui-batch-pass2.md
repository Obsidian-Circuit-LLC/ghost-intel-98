# GhostExodus UI Batch — Pass 2 (Journal Jots Block Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Journal Jots from a plain-textarea entry to a Reports-style block editor — rich text (bold/italic/underline + hyperlinks) via Reports' `TextBlock`, and upload+resizable photos via Reports' `ImageBlock` backed by a new journal-scoped encrypted asset store — preserving every existing entry and all PIN/encryption/honesty invariants.

**Architecture:** Reuse Reports' proven pieces unchanged: `TextBlock` (contentEditable + B/I/U + createLink, sanitizes its own output via `sanitizeReportHtml`), `ImageBlock` (%-width drag-resize), and the `putAsset`/`getAsset` encrypted-asset pattern. The Journal entry body migrates from `body: string` to `blocks: JournalBlock[]` (structurally = Reports' text|image blocks), with legacy string bodies synthesized into a single text block on read. A new `journal:putAsset/getAsset` IPC + `journal-assets/` secure-fs store mirrors the reports asset store exactly. Sanitization stays renderer-side (main has no DOM); main validates block *structure* and gates image refs against path traversal.

**Tech Stack:** React 18 (`createRoot`+`act`), TypeScript, Vitest (jsdom for renderer, node + `vi.mock('electron')` for main), secure-fs encryption, DOMPurify (already a dep, via `sanitizeReportHtml`). No new dependencies.

## Global Constraints

- **No new dependencies, no new network egress, no telemetry.** Reuse in-tree infra only.
- **Encrypt-at-rest.** Journal photos ride a new `journal-assets/` store written via `secureWriteFile`/`secureReadFile` (same vault DEK as journal entries). The entry stores only an `assetRef` — never bytes, never a remote URL.
- **Sanitize rich text** via `sanitizeReportHtml` (`src/renderer/modules/reports/rich-text.ts`) — on **write** (TextBlock already does) **and on read** (before injecting stored HTML for display), defense-in-depth against a tampered `journal.json`. Main process performs **structural** validation only (it cannot DOM-sanitize).
- **Path-traversal gate.** Every image `assetRef` reaching main (getAsset, and inside `ensureJournalEntry` block validation) goes through `ensureFileName(ref, 'assetRef')`.
- **Hyperlinks** open only through the app's existing guarded opener `window.api.system.openExternal` (main validates http/https/mailto via `validateExternalUrl`); anchor clicks in the editor are intercepted and routed there, never allowed to navigate the Electron window. Mirror `ai-assistant/useClearnetLinkOpener.ts` for the clearnet acknowledgement.
- **Backward compatibility (SACRED).** Every existing entry (plain-text `body`) must open unchanged, rendered as a single text block. Never mis-parse a legacy plain-text body as HTML — HTML-escape it when synthesizing the text block.
- **PIN gate / encryption / honesty copy unchanged.** This pass changes the editor body only.
- **Theme-aware.** Any new chrome uses `--ga98-*` tokens; legible under Classic and QUIET AMETHYST.
- **Asset caps (mirror reports):** png/jpeg only, 25 MB/image. Entry serialized-blocks bound mirrors `MAX_BODY` (2 MB of block JSON, excluding asset bytes which live in the asset store).
- **Commit persona:** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify -c`, explicit-path `git add`, **no AI trailers**.

**Reference implementations (read these first):** Reports asset store `src/main/reports/store.ts` (putAsset/getAsset), validator `src/main/security/validate.ts:1216-1235` (`ensureReportAssetInput`), block mapping `src/renderer/modules/reports/ReportEditor.tsx:399-435`, photo flow `src/renderer/modules/reports/ReportsModule.tsx:288-293` + asset cache `102-112`, block types `src/shared/reports-types.ts:20-23`, journal store `src/main/storage/journal.ts`, journal types `src/shared/types.ts:332-348`.

---

### Task 1: Journal-scoped encrypted asset store + IPC

**Files:**
- Create: `src/main/storage/journal-assets.ts` (mirror `src/main/reports/store.ts` putAsset/getAsset)
- Modify: `src/main/security/validate.ts` (add `ensureJournalAssetInput`, clone of `ensureReportAssetInput` @1225-1235)
- Modify: `src/shared/ipc-contracts.ts` (add `journal.putAsset`/`journal.getAsset` channels @~195-203 + type-map entries @~890-897)
- Modify: `src/preload/index.ts` + `src/preload/api.d.ts` (add the two journal asset methods, mirror reports @index.ts:338-339 / api.d.ts:409-413)
- Modify: `src/main/ipc/register.ts` (register the two handlers near the journal block @1225-1232, mirror reports @1502-1509 with the `{mime,dataUrl}` conversion + `ensureFileName` gate)
- Test: `test/journal-assets.test.ts` (new)

**Interfaces:**
- Produces: `journalAssets.putAsset(bytes: Buffer, mime: string): Promise<string>` (ref = `<uuid>.<png|jpg>`), `journalAssets.getAsset(ref: string): Promise<{ bytes: Buffer; mime: string } | null>`; renderer-facing `window.api.journal.putAsset(bytes: number[], mime: string): Promise<string>` and `getAsset(ref: string): Promise<{ mime: string; dataUrl: string } | null>`. Consumed by Task 3.

- [ ] **Step 1: Write the failing test** — `test/journal-assets.test.ts` (node env, mock electron + secure-fs data root to a tmp dir, mirror an existing `test/*asset*` or `test/reports*` store test):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { putAsset, getAsset } from '../src/main/storage/journal-assets';
import { ensureJournalAssetInput } from '../src/main/security/validate';

describe('journal asset store', () => {
  it('round-trips png bytes encrypted, ref is uuid.png', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const ref = await putAsset(bytes, 'image/png');
    expect(ref).toMatch(/^[0-9a-f-]{36}\.png$/);
    const got = await getAsset(ref);
    expect(got?.mime).toBe('image/png');
    expect(Buffer.compare(got!.bytes, bytes)).toBe(0);
  });
  it('getAsset rejects a path-traversal ref', async () => {
    await expect(getAsset('../journal.json')).resolves.toBeNull(); // ensureFileName throws → caught → null
  });
  it('ensureJournalAssetInput enforces png/jpeg + 25MB', () => {
    expect(() => ensureJournalAssetInput({ bytes: [1], mime: 'image/gif' })).toThrow();
    expect(() => ensureJournalAssetInput({ bytes: new Array(26 * 1024 * 1024).fill(0), mime: 'image/png' })).toThrow();
    expect(ensureJournalAssetInput({ bytes: [1, 2], mime: 'image/jpeg' }).mime).toBe('image/jpeg');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm vitest run test/journal-assets.test.ts`).
- [ ] **Step 3: Implement** `src/main/storage/journal-assets.ts` — clone `src/main/reports/store.ts`'s `extFor`/`mimeFor`/`putAsset`/`getAsset`, but `assetsDir() = join(dataRoot(), 'journal-assets')`. Use `secureWriteFile`/`secureReadFile` from `./secure-fs`, `randomUUID` from `node:crypto`, `ensureFileName` in `getAsset`. Add `ensureJournalAssetInput` to `validate.ts` (identical to `ensureReportAssetInput`: png/jpeg only, 25 MB cap). Wire channels + preload + the two `safeHandle`s (getAsset returns `{ mime, dataUrl: 'data:...;base64,...' }`, using `ensureFileName(ref,'assetRef')`; putAsset uses `ensureJournalAssetInput`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Typecheck** — `pnpm typecheck`.
- [ ] **Step 6: Commit** — `feat(journal): encrypted journal-assets store + putAsset/getAsset IPC`.

---

### Task 2: Journal entry blocks model + legacy migration + validation

**Files:**
- Modify: `src/shared/types.ts:332-348` (add `JournalBlock`, extend `JournalEntry`/`JournalEntryInput`)
- Modify: `src/shared/ipc-contracts.ts` (`journal.save` arg / `read` return already reference the types — no channel change; confirm type-map compiles)
- Modify: `src/main/security/validate.ts:1062` (`ensureJournalEntry` — validate `blocks`)
- Modify: `src/main/storage/journal.ts` (read/readAll synthesize legacy body→text block; save persist blocks + size bound; list bytes from serialized blocks)
- Test: `test/journal-blocks-migration.test.ts` (new)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `type JournalBlock = Extract<ReportBlock, { kind: 'text' | 'image' }>` (import `ReportBlock` from `@shared/reports-types`); `JournalEntry` gains `blocks: JournalBlock[]` and keeps `body?: string` (legacy, read-only); `JournalEntryInput` gains `blocks: JournalBlock[]` (drops reliance on `body`). Consumed by Task 3.

- [ ] **Step 1: Write the failing test** — `test/journal-blocks-migration.test.ts` (node env, mock electron, tmp data root):

```ts
// Seed a legacy entry (body string, no blocks) directly into journal.json, then read via the store.
import { describe, it, expect } from 'vitest';
import * as journal from '../src/main/storage/journal';
import { ensureJournalEntry } from '../src/main/security/validate';

describe('journal blocks migration', () => {
  it('reads a legacy plain-text body as ONE escaped text block', async () => {
    // write a legacy record { id, title, body:'a <b>x</b> & y', createdAt, updatedAt } via the seam the store uses
    // ...seed journal.json with the legacy shape...
    const e = await journal.read('legacy-id');
    expect(e!.blocks).toHaveLength(1);
    expect(e!.blocks[0].kind).toBe('text');
    // escaped, NOT interpreted as HTML:
    expect((e!.blocks[0] as any).html).toContain('&lt;b&gt;');
    expect((e!.blocks[0] as any).html).not.toContain('<b>');
  });
  it('round-trips a blocks entry', async () => {
    const saved = await journal.save({ id: 'n1', title: 'T', blocks: [
      { id: 'b1', kind: 'text', html: '<b>hi</b>' },
      { id: 'b2', kind: 'image', assetRef: 'uuid.png', widthPct: 60, caption: '' },
    ] } as any);
    const read = await journal.read('n1');
    expect(read!.blocks).toHaveLength(2);
  });
  it('ensureJournalEntry rejects a path-traversal image ref', () => {
    expect(() => ensureJournalEntry({ id: 'x', title: 'T', blocks: [
      { id: 'b', kind: 'image', assetRef: '../../secret', widthPct: 60, caption: '' } ] })).toThrow();
  });
  it('ensureJournalEntry rejects an unknown block kind and over-large blocks JSON', () => {
    expect(() => ensureJournalEntry({ id: 'x', title: 'T', blocks: [{ id: 'b', kind: 'script' } as any] })).toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `types.ts`: `import type { ReportBlock } from './reports-types';` then `export type JournalBlock = Extract<ReportBlock, { kind: 'text' | 'image' }>;`. `JournalEntry`: add `blocks: JournalBlock[]`, keep `body?: string`. `JournalEntryInput`: `{ id: string; title: string; blocks: JournalBlock[] }`.
  - `validate.ts` `ensureJournalEntry`: after title, validate `blocks` is an array (bound count, e.g. ≤500); each block: `kind` ∈ {`text`,`image`}; text → `html` is a string bounded to `MAX_BLOCK_HTML` (e.g. 512 KB); image → `assetRef` passes `ensureFileName(ref,'assetRef')`, `widthPct` a finite number clamped [10,100], `caption` a bounded string, `align` ∈ {left,center,right}|undefined. Enforce total serialized `JSON.stringify(blocks).length ≤ MAX_BODY` (2 MB). Reject unknown kinds/fields.
  - `journal.ts`: `read`/`readAll` — when a record has `body` and no `blocks`, synthesize `blocks: [{ id: randomUUID(), kind: 'text', html: escapeHtml(body) }]` (add a tiny local `escapeHtml` — `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, wrapped so newlines survive, e.g. `<p>`-join). `save` — persist `input.blocks` (already structurally validated by `ensureJournalEntry` at the IPC boundary); drop the old `body` truncation; keep `id/createdAt/updatedAt` ownership. `list` — `bytes: Buffer.byteLength(JSON.stringify(e.blocks ?? []), 'utf8')`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression + typecheck** — `pnpm vitest run test/journal.test.ts && pnpm typecheck` (existing journal tests: PIN/lockout/limits unchanged; any test asserting the old `body` shape gets updated to blocks in THIS task).
- [ ] **Step 6: Commit** — `feat(journal): entry blocks model + legacy body→text-block migration + structural validation`.

---

### Task 3: Journal block editor UI (reuse TextBlock + ImageBlock)

**Files:**
- Modify: `src/renderer/modules/journal/JournalModule.tsx` (replace the `<textarea>` body — the current editor pane — with a block editor; add photo upload + the asset preview cache)
- Modify: `src/renderer/styles/theme.css` (journal block-editor layout, reuse `.ga98-report-block` spacing or a `.ga98-journal-block` equivalent)
- Test: `test/journal-block-editor.test.tsx` (new)

**Interfaces:**
- Consumes: Task 1 (`window.api.journal.putAsset/getAsset`), Task 2 (`JournalBlock`, entry `blocks`), Reports `TextBlock`/`ImageBlock`/`clampPct`, `sanitizeReportHtml`.

- [ ] **Step 1: Write the failing test** — `test/journal-block-editor.test.tsx` (jsdom, mount JournalModule, drive to `open` gate with a mocked `journal` api that returns an entry with blocks). Assertions:
  - Renders a `TextBlock` contentEditable for a text block and its B/I/U toolbar buttons.
  - Given an entry whose text block html is `'<img src=x onerror=alert(1)>hi <a href="javascript:alert(1)">x</a>'`, the rendered/displayed HTML contains neither `onerror` nor `javascript:` (read-side sanitize).
  - Clicking "+ Photo" and supplying png bytes calls `window.api.journal.putAsset` and appends an image block; the `ImageBlock` renders with the resolved preview `src`.
  - Save sends `{ id, title, blocks }` to `window.api.journal.save` (not a `body` string).
  - A legacy entry (blocks synthesized in Task 2) renders its text unchanged.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Mirror `ReportEditor.tsx:399-435` block-mapping and `ReportsModule.tsx` state:
  - Block-array state `blocks`, seeded from the opened entry (or one empty text block). Mutators: `addTextBlock`, `updateTextBlock(id, html)`, `updateImageBlock(id, patch)`, `removeBlock(id)` — all `setBlocks`.
  - `assets` cache `Record<string,string>`; `loadAssetsFor(blocks)` calls `window.api.journal.getAsset(ref)` for each image block → store `dataUrl`.
  - `addPhotoBytes(bytes, mime)` → `window.api.journal.putAsset` → append `{ id: uid(), kind:'image', assetRef, widthPct:60, caption:'' }` + cache. A "+ Photo" control uploads a png/jpeg `File` (mirror `CasePhotoPicker`'s upload path / `reports` file-read → `number[]`).
  - Render: map blocks → `<TextBlock block onChange={html=>updateTextBlock(id, html)} />` (no descriptors/introductions) and `<ImageBlock block src={assets[ref]} onChange onRemove onSelect selected />`.
  - **Read-side sanitize:** when seeding a text block into the editor / displaying stored html, pass it through `sanitizeReportHtml` first (defense-in-depth).
  - `save()` → `window.api.journal.save({ id, title, blocks })`.
  - Keep the Task-1(Pass1) banner + New/list column intact; only the editor pane changes.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression + typecheck** — `pnpm vitest run test/journal.test.ts test/journal-banner.test.tsx test/journal-unlock-layout.test.tsx && pnpm typecheck`.
- [ ] **Step 6: Commit** — `feat(journal): block editor — reuse Reports TextBlock/ImageBlock, encrypted photos, read-side sanitize`.

---

### Task 4: Hyperlink click-to-open through the guarded external opener

**Files:**
- Modify: `src/renderer/modules/journal/JournalModule.tsx` (delegated anchor-click handler on the editor)
- Test: `test/journal-link-open.test.tsx` (new)

**Interfaces:**
- Consumes: `window.api.system.openExternal` (main-side `validateExternalUrl` already restricts to http/https/mailto). Mirror `ai-assistant/useClearnetLinkOpener.ts` for the clearnet acknowledgement step.

- [ ] **Step 1: Write the failing test** — mount the journal editor with a text block containing `<a href="https://example.com">go</a>`; simulate a click on the anchor; assert `window.api.system.openExternal` was called with `https://example.com` and that default navigation was prevented (the jsdom anchor's default is `preventDefault`-ed). Assert that a `javascript:`-scheme href never reaches `openExternal` (it was stripped by sanitize, so no anchor exists — assert no call).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Add a delegated `onClick` on the editor container: if `event.target.closest('a[href]')`, `event.preventDefault()`, read the href, and route through the guarded opener (reuse/mirror `useClearnetLinkOpener` so the clearnet acknowledgement applies exactly as elsewhere). Never call `openExternal` for non-http(s)/mailto (defense-in-depth; sanitize already guarantees it).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression** — `pnpm vitest run test/journal-block-editor.test.tsx`.
- [ ] **Step 6: Commit** — `feat(journal): open entry hyperlinks via the scheme-guarded external opener`.

---

## Self-Review Notes (author)

- **Spec coverage:** B/I/U + links (Task 3 via TextBlock, Task 4 for click-open) ✓; photo upload+resize (Task 3 via ImageBlock + Task 1 store) ✓; encrypt-at-rest (Task 1 secure-fs) ✓; backward compat (Task 2 migration) ✓; sanitize write+read (TextBlock + Task 3 read-side) ✓; scheme-guard (Task 4) ✓.
- **Trust model:** main can't DOM-sanitize → renderer sanitizes write+read; main does structural validation + `ensureFileName` on every image ref (Task 1 getAsset, Task 2 validator). This is the load-bearing security decision — the reviewers must confirm no path lets unsanitized HTML render without a read-side `sanitizeReportHtml`, and no `assetRef` reaches the fs without `ensureFileName`.
- **Type consistency:** `JournalBlock = Extract<ReportBlock,{kind:'text'|'image'}>` is structurally identical to what `TextBlock`/`ImageBlock` consume, so the reused components typecheck against journal blocks without adapters. `JournalEntryInput` uses `blocks` in Tasks 2/3 consistently.
- **Ordering:** Task 1 (store) and Task 2 (model) are independent; Task 3 depends on both; Task 4 depends on Task 3. Build 1→2→3→4.
- **No reorder / no table:** Reports has no block-reorder and journal omits the table block — matches Reports' own feature set; not a gap.
