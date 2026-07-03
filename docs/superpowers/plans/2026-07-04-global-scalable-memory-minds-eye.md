# Global Scalable Memory + Mind's Eye Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers run SEQUENTIALLY on the shared git tree — never in parallel.

**Goal:** Make the AI Assistant's memory reliable and global by default — recall across all conversations, cases, and uploaded documents — and give it a visible, shapeable face (the "Mind's Eye" SVG graph).

**Architecture:** Reuse the existing `src/main/services/memory/` substrate (shards, chunker, retriever, profile). Add a *dedicated bundled embedding runtime* on its own loopback port so embeddings never depend on the user's chat Ollama (this is the root-cause fix for the silent "0 chunks" bug); make the indexer fail loud instead of writing empty shards; add a case-independent global document library (uploads + briefcase + journal); add a Mind's Eye graph surface (build → auto-edges → deterministic layout → SVG) with curation; and add user-drawn retrieval "bonds" that boost co-recall.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, React (renderer), vitest (tests), Playwright (render assertion), bundled Ollama (`nomic-embed-text` 768-dim embeddings over loopback), `secure-fs` encrypted-at-rest storage.

## Global Constraints

- **No new network egress.** Embeddings and chat are loopback-only. The dedicated embedding runtime is the *bundled* Ollama on a loopback port; no clearnet, ever. No telemetry/phone-home. (Charter, verbatim.)
- **Encrypted at rest.** Every new persisted file (library manifest, doc text, bonds, any shard) goes through `secure-fs` (`secureWriteFile`/`secureReadText`), exactly as existing shards do.
- **Determinism in critical paths.** No `Math.random`, no `Date.now()` in layout/retrieval logic — seed positions, use stable tie-breaks (`score desc, id asc`), fixed bond boost, deterministic chunk boundaries. Same query + same pool ⇒ same evidence and same graph layout. Inject `now`/ids/rng via params for testability (existing pattern: `createLiveReindexer` deps, `reconcile({now,newId})`).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER any AI-identity trailer (`Co-Authored-By`, `Signed-off-by`, `Claude-Session`) in author, committer, or body.
- **Do not touch pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`. Stage only files you create/modify for the task.
- **Embedding model:** `nomic-embed-text`, 768-dim (`EMBED_MODEL`/`EMBED_DIM` in `src/main/services/memory/embeddings.ts`). Do not change the model.
- **Test runner:** vitest. Single file: `npx vitest run test/<file>.test.ts`. Main-process tests mock electron: `vi.mock('electron', () => ({ app: { getPath: () => ROOT } }))`. Inject the embedder with `setEmbedderForTest(fn)` and reset with `setEmbedderForTest(null)`.
- **Naming caveats (verbatim from the codebase — use these exact names):** the chunker fn is `chunkText` (not `chunk`); the transient chunk type is `SourceChunk`, the persisted one is `StoredChunk`; cosine top-k is `topKChunks` (there is no `search` in store.ts); RAG search is `recall` in `retriever.ts`; `reindexShard` and `caseSources` are PRIVATE in `indexer.ts`; `memory:onRecall` is NOT an IPC channel (preload synthesizes it off `channels.ai.onChatChunk`); the Memory transparency panel is inline in `AiAssistantModule.tsx` with pure helpers in `memory-view.ts` — there is no separate panel component file.

---

## File Structure

**New files:**
- `src/main/services/memory/embed-runtime.ts` — dedicated bundled embedding runtime (ensure/health/port-step) + test seams.
- `src/main/services/memory/library/store.ts` — global document library: manifest + per-doc encrypted text + CRUD.
- `src/main/services/memory/library/sources.ts` — gather library `Source[]` (uploaded docs + briefcase + journal) for indexing.
- `src/main/services/memory/graph/model.ts` — graph node/edge types (shared shape).
- `src/main/services/memory/graph/build.ts` — pure: shards+profile+library → nodes + representative vectors.
- `src/main/services/memory/graph/edges.ts` — pure: similarity auto-edges.
- `src/main/services/memory/graph/layout.ts` — pure: deterministic clustered 2D layout.
- `src/main/services/memory/graph/index.ts` — assemble build+edges+layout into a `MemoryGraph`.
- `src/main/services/memory/bonds.ts` — user-drawn retrieval bonds (CRUD, undirected, encrypted).
- `src/renderer/modules/minds-eye/MindsEyeModule.tsx` — the SVG graph surface.
- `src/renderer/modules/minds-eye/svg-graph.ts` — pure SVG geometry helpers (node/edge rendering data).
- `src/renderer/lib/libraryExtract.ts` — renderer-side extraction dispatcher (pdf/txt/md/docx → text).
- Test files under `test/` (one per task, named below).

**Modified files:**
- `src/main/services/memory/embeddings.ts` — route through embed-runtime; loud errors.
- `src/main/services/memory/chunker.ts` — add `'doc'` to `ChunkKind`.
- `src/main/services/memory/indexer.ts` — loud failure (no empty-shard overwrite), `failures[]` in `reindexAll`, `reindexLibrary()`, library in `reindexAll`.
- `src/main/services/memory/index.ts` — `status()` counts library shard; export `embedHealth`, `reindexLibrary`.
- `src/main/services/memory/retriever.ts` — bond boost + bond provenance.
- `src/main/ipc/register.ts` — new channels: `memory.embedHealth`, `memory.graph`, `memory.libraryList/libraryAdd/libraryRemove`, `memory.bondList/bondAdd/bondRemove`, `memory.forgetDoc`, `memory.mergeItems`.
- `src/shared/ipc-contracts.ts` — channel names + shared shapes.
- `src/preload/index.ts`, `src/preload/api.d.ts` — preload surface for the above.
- `src/shared/types.ts` — `AppSettings.ai.useMemory` default `true`; new graph/library/bond shared shapes.
- `src/renderer/modules/settings/SettingsModule.tsx` — embed-runtime health line + failures display; relabel master toggle.
- `src/renderer/modules/ai-assistant/AiAssistantModule.tsx` — "➕ Add to memory" control; open Mind's Eye.
- `src/renderer/modules/register-builtins.tsx` (+ Icon/Desktop as needed) — register `minds-eye` module surface.

---

## Task 1: Dedicated embedding runtime

**Files:**
- Create: `src/main/services/memory/embed-runtime.ts`
- Test: `test/memory-embed-runtime.test.ts`

**Interfaces:**
- Consumes: `bundledRoot`, `fetchedRoot`, `LOCAL_AI_ENDPOINT` from `../local-ai-paths`; `isBundled`, `ensureRuntime` from `../local-ai`.
- Produces:
  - `export type EmbedHealth = 'ready' | 'starting' | 'unavailable'`
  - `export function embedEndpoint(): string` — the base URL embeddings must POST to (dedicated port when the bundled runtime is up, else `LOCAL_AI_ENDPOINT`).
  - `export async function ensureEmbedRuntime(): Promise<void>` — guarantees an embeddings-capable runtime; throws with an actionable message if none can be started.
  - `export async function embedHealth(): Promise<EmbedHealth>`
  - Test seams mirroring `local-ai.ts`: `export function __setSpawnForTest(fn: SpawnLike | null): void`, `export function __setProbeForTest(fn: ((url: string) => Promise<boolean>) | null): void`, `export function __setBundledForTest(v: boolean | null): void`, `export function __resetEmbedRuntimeForTest(): void`.
- Constants: `EMBED_HOST = '127.0.0.1'`, `EMBED_PORT_BASE = 11435` (dedicated; distinct from chat 11434), try up to `EMBED_PORT_BASE..EMBED_PORT_BASE+4` for port-step.

**Design notes for the implementer:**
- When packaged (`isBundled()` true): spawn the bundled `ollama`(`.exe`) from `bundledRoot()` with `OLLAMA_HOST=<host>:<port>` and `OLLAMA_MODELS=join(bundledRoot(),'models')` (the dir that contains the bundled `nomic-embed-text`), `OLLAMA_NO_ANALYTICS=1`. Mirror `ensureRuntime`'s spawn+probe loop (probe `GET <endpoint>/api/tags`, 30s deadline, early-exit on child `exit`/`error`). If the port is taken, step to the next candidate port before failing.
- When NOT bundled (dev): do not spawn; fall back to `ensureRuntime()` (the user's 11434) and let `embedEndpoint()` return `LOCAL_AI_ENDPOINT`. Embeddings there may fail loudly if `nomic-embed-text` is absent — that is the correct, visible degraded state for dev.
- Cache the resolved endpoint + child handle in module state; `embedHealth()` returns `'ready'` when a probe of the resolved endpoint succeeds, `'starting'` while a spawn is in flight, `'unavailable'` otherwise. Never kill a runtime you did not spawn.

- [ ] **Step 1: Write the failing test**

```ts
// test/memory-embed-runtime.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-embedrt-test') } }));

import {
  ensureEmbedRuntime, embedEndpoint, embedHealth,
  __setSpawnForTest, __setProbeForTest, __setBundledForTest, __resetEmbedRuntimeForTest
} from '../src/main/services/memory/embed-runtime';

function fakeChild() {
  const handlers: Record<string, (() => void)[]> = {};
  return { on(ev: string, cb: () => void) { (handlers[ev] ||= []).push(cb); }, kill() {}, pid: 1234, __fire(ev: string) { (handlers[ev] || []).forEach((f) => f()); } };
}

beforeEach(() => __resetEmbedRuntimeForTest());

describe('dedicated embedding runtime', () => {
  it('bundled: spawns on the dedicated port and reports ready', async () => {
    __setBundledForTest(true);
    let spawnedEnv: NodeJS.ProcessEnv | undefined;
    __setSpawnForTest((_bin, _args, opts) => { spawnedEnv = opts.env; return fakeChild(); });
    __setProbeForTest(async () => true); // runtime answers immediately
    await ensureEmbedRuntime();
    expect(spawnedEnv?.OLLAMA_HOST).toContain('11435');
    expect(spawnedEnv?.OLLAMA_MODELS).toContain('models');
    expect(embedEndpoint()).toContain('11435');
    expect(await embedHealth()).toBe('ready');
  });

  it('not bundled: does not spawn, endpoint falls back to 11434', async () => {
    __setBundledForTest(false);
    let spawned = false;
    __setSpawnForTest(() => { spawned = true; return fakeChild(); });
    __setProbeForTest(async (url) => url.includes('11434'));
    await ensureEmbedRuntime();
    expect(spawned).toBe(false);
    expect(embedEndpoint()).toContain('11434');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/memory-embed-runtime.test.ts`
Expected: FAIL — module `embed-runtime` not found / exports undefined.

- [ ] **Step 3: Implement `embed-runtime.ts`**

Implement per the design notes. Mirror the injectable `SpawnLike` type and probe pattern from `local-ai.ts`. `ensureEmbedRuntime` (bundled): loop candidate ports; for each, spawn with the env above and run the 30s probe loop; on success cache `{ endpoint, child }` and return; on early-exit try the next port; after all ports fail, throw `new Error('Embedding runtime could not start (is a port in 11435–11439 free?).')`. (not bundled): `await ensureRuntime(); cache endpoint = LOCAL_AI_ENDPOINT`. `embedEndpoint()` returns the cached endpoint or `LOCAL_AI_ENDPOINT` default. `embedHealth()` probes the cached endpoint.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/memory-embed-runtime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/embed-runtime.ts test/memory-embed-runtime.test.ts
git commit -m "feat(memory): dedicated bundled embedding runtime on its own loopback port"
```

---

## Task 2: Route embeddings through the dedicated runtime

**Files:**
- Modify: `src/main/services/memory/embeddings.ts`
- Test: `test/memory-embeddings-endpoint.test.ts`

**Interfaces:**
- Consumes: `ensureEmbedRuntime`, `embedEndpoint` from `./embed-runtime` (Task 1).
- Produces: unchanged public surface (`EMBED_MODEL`, `EMBED_DIM`, `embed`, `setEmbedderForTest`). `defaultEmbed` now `await ensureEmbedRuntime()` (instead of `ensureRuntime()`) and POSTs to `` `${embedEndpoint()}/api/embeddings` ``.

- [ ] **Step 1: Write the failing test**

```ts
// test/memory-embeddings-endpoint.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-embep-test') } }));

const ensured = { called: false };
vi.mock('../src/main/services/memory/embed-runtime', () => ({
  ensureEmbedRuntime: async () => { ensured.called = true; },
  embedEndpoint: () => 'http://127.0.0.1:11435'
}));

import { embed, setEmbedderForTest } from '../src/main/services/memory/embeddings';

beforeEach(() => { ensured.called = false; setEmbedderForTest(null); });

describe('embeddings routing', () => {
  it('defaultEmbed ensures the embed runtime and POSTs to its endpoint', async () => {
    let calledUrl = '';
    const g = globalThis as unknown as { fetch: typeof fetch };
    const orig = g.fetch;
    g.fetch = (async (url: string) => {
      calledUrl = String(url);
      return { ok: true, json: async () => ({ embedding: [1, 0, 0] }) } as Response;
    }) as typeof fetch;
    try {
      const out = await embed(['hello']);
      expect(ensured.called).toBe(true);
      expect(calledUrl).toBe('http://127.0.0.1:11435/api/embeddings');
      expect(out[0]).toEqual([1, 0, 0]);
    } finally { g.fetch = orig; }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/memory-embeddings-endpoint.test.ts`
Expected: FAIL — still calls `ensureRuntime`/old endpoint.

- [ ] **Step 3: Implement**

In `src/main/services/memory/embeddings.ts` replace the `local-ai` import and body: `import { ensureEmbedRuntime, embedEndpoint } from './embed-runtime';`, then in `defaultEmbed` call `await ensureEmbedRuntime();` and `fetch(\`${embedEndpoint()}/api/embeddings\`, …)`. Keep the existing `!res.ok` loud error message (it already names the model).

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/memory-embeddings-endpoint.test.ts test/memory.test.ts`
Expected: PASS (new test + existing memory suite still green).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/embeddings.ts test/memory-embeddings-endpoint.test.ts
git commit -m "feat(memory): embeddings use the dedicated embedding runtime endpoint"
```

---

## Task 3: Loud indexer — never overwrite a good shard with an empty one; report failures

**Files:**
- Modify: `src/main/services/memory/indexer.ts`
- Test: `test/memory-indexer-loud.test.ts`

**Interfaces:**
- Consumes: existing `embed`, `loadShard`, `saveShard`, `emptyShard`, `caseSources` (private).
- Produces:
  - `reindexAll(onProgress?)` return type widens to `{ cases: number; chunks: number; failures: { label: string; error: string }[] }`.
  - New behavior in `reindexShard`: if `embed(newTexts)` throws, **do not** `saveShard`; rethrow so the prior shard on disk is preserved. (Today an embed throw already skips saveShard because it's after the embed call — VERIFY this and add a regression test; if a future edit reorders it, the test guards it.)
  - `reindexAll` catches per-case/conv/library errors into `failures[]` instead of silently swallowing, and still increments progress.

- [ ] **Step 1: Write the failing test**

```ts
// test/memory-indexer-loud.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';

const ROOT = join(tmpdir(), 'dcs98-indexer-loud');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({
  ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'http://127.0.0.1:11435'
}));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { reindexAll } from '../src/main/services/memory/indexer';
import { caseShardPath, loadShard, saveShard, emptyShard, EMBED_MODEL_UNUSED } from '../src/main/services/memory/store';

// NOTE: EMBED_MODEL for emptyShard — import EMBED_MODEL from embeddings if needed by the shard factory.

beforeEach(async () => { await rm(ROOT, { recursive: true, force: true }); setEmbedderForTest(null); });

describe('loud indexer', () => {
  it('reindexAll reports failures instead of swallowing, and does not wipe a prior shard', async () => {
    // Arrange a case dir with content and a pre-existing NON-EMPTY shard.
    // (Use the real case store to write a case; or write a shard directly and a case record.)
    // Then make the embedder throw:
    setEmbedderForTest(async () => { throw new Error('embed boom'); });
    const res = await reindexAll();
    expect(Array.isArray(res.failures)).toBe(true);
    expect(res.failures.length).toBeGreaterThanOrEqual(1);
    expect(res.failures[0].error).toContain('boom');
  });
});
```

(The implementer will finalize case-fixture setup using `caseStore` from `../../storage/json-fs`, matching `test/memory.test.ts`'s fixture approach; the assertions above are the contract.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/memory-indexer-loud.test.ts`
Expected: FAIL — `reindexAll` has no `failures` field.

- [ ] **Step 3: Implement**

Widen `reindexAll`'s accumulator to collect `failures`. Replace the two `catch { /* … */ }` blocks around `reindexCase` and `reindexConversations` with `catch (e) { failures.push({ label: id /* or 'conversations' */, error: (e as Error).message }); }`. Return `{ cases, chunks, failures }`. In `reindexShard`, add a comment + keep `saveShard` strictly AFTER the `embed(newTexts)` call so a throw preserves the prior shard (it already is — assert with the test).

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/memory-indexer-loud.test.ts test/memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/indexer.ts test/memory-indexer-loud.test.ts
git commit -m "feat(memory): indexer reports embed failures instead of silently swallowing them"
```

---

## Task 4: Embed-runtime health in status; default-on; Settings surfacing

**Files:**
- Modify: `src/main/services/memory/index.ts` (add `embedHealth` re-export; keep `status`)
- Modify: `src/shared/ipc-contracts.ts` (add `memory.embedHealth` channel + widen the `reindexAll` return shape)
- Modify: `src/preload/index.ts`, `src/preload/api.d.ts` (expose `memory.embedHealth()` and the `failures` field)
- Modify: `src/main/ipc/register.ts` (register `channels.memory.embedHealth`)
- Modify: `src/shared/types.ts` (`AppSettings.ai.useMemory` default → `true`)
- Modify: `src/renderer/modules/settings/SettingsModule.tsx` (health line + failures toast; relabel toggle)
- Test: `test/memory-embed-health-ipc.test.ts`, `test/settings-memory-default.test.ts`

**Interfaces:**
- Consumes: `embedHealth` from `./embed-runtime`.
- Produces: `channels.memory.embedHealth = 'memory:embedHealth'`; `window.api.memory.embedHealth(): Promise<'ready'|'starting'|'unavailable'>`.

- [ ] **Step 1: Write failing tests**

```ts
// test/settings-memory-default.test.ts
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
describe('memory default-on', () => {
  it('useMemory defaults to true so memory works out of the box', () => {
    expect(defaultSettings.ai.useMemory).toBe(true);
    expect(defaultSettings.ai.autoReindex).toBe(true); // live reindex on by default
  });
});
```

```ts
// test/memory-embed-health-ipc.test.ts — assert the facade re-exports embedHealth
import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-health') } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({
  embedHealth: async () => 'ready', ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'x'
}));
import * as memory from '../src/main/services/memory';
describe('memory facade', () => {
  it('re-exports embedHealth', async () => { expect(await memory.embedHealth()).toBe('ready'); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/settings-memory-default.test.ts test/memory-embed-health-ipc.test.ts`
Expected: FAIL — default is `false`; facade has no `embedHealth`.

- [ ] **Step 3: Implement**

- `src/shared/types.ts`: in the `ai` block of `defaultSettings`, set `useMemory: true`. (mergeSettings shallow-merges `ai`, so existing installs keep their persisted value; only fresh installs get default-on. This is intentional — no forced flip of an explicit user choice.)
- `src/main/services/memory/index.ts`: `export { embedHealth } from './embed-runtime';`.
- `ipc-contracts.ts`: add `embedHealth: 'memory:embedHealth'` to `channels.memory`; update the `reindexAll` contract return type to include `failures`.
- `register.ts`: `safeHandle(channels.memory.embedHealth, () => memory.embedHealth());`.
- `preload`: add `embedHealth(): Promise<'ready'|'starting'|'unavailable'>` invoking `channels.memory.embedHealth`; update `reindexAll` type.
- `SettingsModule.tsx`: relabel the first checkbox's legend/label region so the recall toggle reads as the master "Memory (recall across all conversations, cases & documents)"; after `rebuildIndex`, if `r.failures.length` show `toast.error(\`\${r.failures.length} item(s) failed to index — \${r.failures[0].error}\`)`; add a small health line: `useEffect(() => { void window.api.memory.embedHealth().then(setEmbedHealth); }, [])` rendering `Embedding engine: {embedHealth}`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/settings-memory-default.test.ts test/memory-embed-health-ipc.test.ts`
Expected: PASS. Also `npx vitest run test/settings-upgrade-merge.test.ts` (or the existing settings-merge test) stays green.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/index.ts src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/main/ipc/register.ts src/shared/types.ts src/renderer/modules/settings/SettingsModule.tsx test/settings-memory-default.test.ts test/memory-embed-health-ipc.test.ts
git commit -m "feat(memory): default-on memory + embedding-engine health and index-failure surfacing"
```

---

## Task 5: Add the `'doc'` chunk kind

**Files:**
- Modify: `src/main/services/memory/chunker.ts` (extend `ChunkKind`)
- Test: `test/memory-chunker-doc.test.ts`

**Interfaces:**
- Produces: `ChunkKind = 'desc' | 'note' | 'file' | 'entity' | 'chat' | 'doc'`. `RecallHit.kind` (retriever) and `StoredChunk.kind` (store) both import `ChunkKind`, so they widen automatically.

- [ ] **Step 1: Failing test**

```ts
// test/memory-chunker-doc.test.ts
import { describe, it, expect } from 'vitest';
import { chunkText, type ChunkKind } from '../src/main/services/memory/chunker';
describe("chunker 'doc' kind", () => {
  it('chunks a doc source with kind doc', () => {
    const kind: ChunkKind = 'doc';
    const out = chunkText(kind, 'report.pdf', 'hello world '.repeat(200));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].kind).toBe('doc');
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/memory-chunker-doc.test.ts` → FAIL (type `'doc'` not assignable).
- [ ] **Step 3: Implement** — add `| 'doc'` to the `ChunkKind` union in `chunker.ts`.
- [ ] **Step 4: Run** — `npx vitest run test/memory-chunker-doc.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/chunker.ts test/memory-chunker-doc.test.ts
git commit -m "feat(memory): add 'doc' chunk kind for the global document library"
```

---

## Task 6: Global document library store

**Files:**
- Create: `src/main/services/memory/library/store.ts`
- Test: `test/memory-library-store.test.ts`

**Interfaces:**
- Consumes: `secureWriteFile`, `secureReadText` from `../../../storage/secure-fs`; `dataRoot` from `../../../storage/paths`.
- Produces:
  ```ts
  export interface LibraryDoc { docId: string; title: string; mime: string; addedAt: number; charCount: number; bytesHash: string }
  export function libraryDir(): string;                 // join(dataRoot(),'memory','library')
  export function libraryManifestPath(): string;        // join(libraryDir(),'manifest.json')
  export function libraryDocTextPath(docId: string): string; // join(libraryDir(),'docs',`${docId}.txt`)
  export interface LibraryIO { readManifest(): Promise<string|null>; writeManifest(t: string): Promise<void>; readDocText(id: string): Promise<string|null>; writeDocText(id: string, t: string): Promise<void>; removeDocText(id: string): Promise<void>; }
  export function createLibrary(io?: LibraryIO): {
    list(): Promise<LibraryDoc[]>;
    add(input: { docId: string; title: string; mime: string; text: string; now: number }): Promise<LibraryDoc>;
    remove(docId: string): Promise<void>;
    readText(docId: string): Promise<string|null>;
  };
  ```
- `docId` is provided by the caller (deterministic id from the IPC layer / test), not minted with randomness here. `bytesHash` = `contentHash(text)` (reuse `chunker.contentHash`).

- [ ] **Step 1: Failing test** (inject an in-memory `LibraryIO`, mirroring `makeFakeIO` in `test/memory-profile-store.test.ts`)

```ts
// test/memory-library-store.test.ts
import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-lib') } }));
import { createLibrary, type LibraryIO } from '../src/main/services/memory/library/store';

function fakeIO(): LibraryIO {
  let manifest: string | null = null; const docs = new Map<string, string>();
  return {
    async readManifest() { return manifest; }, async writeManifest(t) { manifest = t; },
    async readDocText(id) { return docs.get(id) ?? null; }, async writeDocText(id, t) { docs.set(id, t); },
    async removeDocText(id) { docs.delete(id); }
  };
}

describe('library store', () => {
  it('adds, lists, reads, and removes a document', async () => {
    const lib = createLibrary(fakeIO());
    const d = await lib.add({ docId: 'doc-1', title: 'report.pdf', mime: 'application/pdf', text: 'alpha bravo charlie', now: 1000 });
    expect(d.charCount).toBe('alpha bravo charlie'.length);
    expect(await lib.list()).toHaveLength(1);
    expect(await lib.readText('doc-1')).toBe('alpha bravo charlie');
    await lib.remove('doc-1');
    expect(await lib.list()).toHaveLength(0);
    expect(await lib.readText('doc-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to fail** — FAIL (module missing).
- [ ] **Step 3: Implement** — default `LibraryIO` uses `secureReadText`/`secureWriteFile` and `node:fs/promises` `rm` for `removeDocText`; manifest is a JSON array of `LibraryDoc`. `add` upserts by `docId`, writes text, returns the doc.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/library/store.ts test/memory-library-store.test.ts
git commit -m "feat(memory): global document library store (manifest + encrypted per-doc text)"
```

---

## Task 7: Library sources + reindexLibrary + reindexAll/status integration

**Files:**
- Create: `src/main/services/memory/library/sources.ts`
- Modify: `src/main/services/memory/store.ts` (add `libraryShardPath()`)
- Modify: `src/main/services/memory/indexer.ts` (`reindexLibrary()`, include in `reindexAll`)
- Modify: `src/main/services/memory/index.ts` (`status()` counts the library shard; export `reindexLibrary`)
- Modify: `src/main/services/memory/retriever.ts` (`shardsFor` global path also loads the library shard)
- Test: `test/memory-library-index.test.ts`

**Interfaces:**
- Consumes: `createLibrary` (Task 6); `briefcase` (`../../storage/briefcase`), `journal` (`../../storage/journal`); the private `reindexShard` in `indexer.ts` (same file — call it directly).
- Produces:
  - `store.ts`: `export function libraryShardPath(): string` → `join(dataRoot(),'memory','library.json')`. Sentinel `caseId = '__library__'`, title `'Library'`.
  - `library/sources.ts`: `export async function librarySources(deps?): Promise<Source[]>` returning uploaded docs (`key: \`doc:${docId}\`, kind: 'doc'`), briefcase notes (`key: \`briefcase:${id}\`, kind: 'doc'`), journal entries (`key: \`journal:${id}\`, kind: 'doc'`). Import the `Source` shape from indexer or redeclare identically (`{ key; kind: ChunkKind; ref; text }`).
  - `indexer.ts`: `export async function reindexLibrary(): Promise<ReindexResult>` → `reindexShard(libraryShardPath(), '__library__', 'Library', await librarySources())`. Add a `reindexLibrary()` call into `reindexAll` (count its chunks; add to `failures` on throw; `total` becomes `ids.length + 2`).
  - `index.ts`: `status()` also `loadShard(libraryShardPath())` and adds its chunk count; `export { reindexLibrary } from './indexer'`.
  - `retriever.ts`: in `shardsFor` (no-caseId branch) also `const lib = await loadShard(libraryShardPath()); if (lib) shards.push(lib);`.

- [ ] **Step 1: Failing test**

```ts
// test/memory-library-index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { rm } from 'node:fs/promises';
const ROOT = join(tmpdir(), 'dcs98-lib-index');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({ ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'x' }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { createLibrary } from '../src/main/services/memory/library/store';
import { reindexLibrary } from '../src/main/services/memory/indexer';
import { recall } from '../src/main/services/memory/retriever';

beforeEach(async () => { await rm(ROOT, { recursive: true, force: true }); setEmbedderForTest(null); });

describe('library indexing + recall', () => {
  it('an added document is embedded and recalled globally', async () => {
    // deterministic embedder: token-overlap vector so query matches doc
    setEmbedderForTest(async (texts) => texts.map((t) => [t.includes('zebra') ? 1 : 0, 1]));
    const lib = createLibrary();
    await lib.add({ docId: 'doc-z', title: 'z.txt', mime: 'text/plain', text: 'the zebra crossing report', now: 1 });
    const r = await reindexLibrary();
    expect(r.chunks).toBeGreaterThan(0);
    const hits = await recall('zebra');
    expect(hits.some((h) => h.kind === 'doc' && h.ref === 'z.txt')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to fail** — FAIL.
- [ ] **Step 3: Implement** all the interface items above.
- [ ] **Step 4: Run** — `npx vitest run test/memory-library-index.test.ts test/memory.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/library/sources.ts src/main/services/memory/store.ts src/main/services/memory/indexer.ts src/main/services/memory/index.ts src/main/services/memory/retriever.ts test/memory-library-index.test.ts
git commit -m "feat(memory): index uploads + briefcase + journal into a global library shard, recalled everywhere"
```

---

## Task 8: Library IPC + preload + contracts

**Files:**
- Modify: `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`
- Test: `test/memory-library-ipc.test.ts`

**Interfaces:**
- Channels: `memory.libraryList='memory:libraryList'`, `memory.libraryAdd='memory:libraryAdd'`, `memory.libraryRemove='memory:libraryRemove'`.
- `register.ts`: `libraryAdd` receives `{ title, mime, text }` (extraction happens renderer-side), mints a deterministic `docId` via the existing `ensureUuid`/id helper (use `crypto.randomUUID()` in the handler — id generation at the IPC boundary is acceptable; it is not a determinism-critical path). Then `await createLibrary().add({ docId, title, mime, text, now: Date.now() })`, and fire `liveReindex` for the library (add a `libraryChanged()` to the live-reindexer OR call `reindexLibrary()` fire-and-forget). Return the `LibraryDoc`. `libraryRemove(docId)` → `createLibrary().remove(docId)` then reindex library. `libraryList()` → `createLibrary().list()`.
- preload: `window.api.memory.library = { list(), add({title,mime,text}), remove(docId) }`.

- [ ] **Step 1: Failing test** — assert the three channel names exist on `channels.memory` and the preload types compile (a light contract test importing `channels`).

```ts
// test/memory-library-ipc.test.ts
import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
describe('library channels', () => {
  it('declares library channels', () => {
    expect(channels.memory.libraryList).toBe('memory:libraryList');
    expect(channels.memory.libraryAdd).toBe('memory:libraryAdd');
    expect(channels.memory.libraryRemove).toBe('memory:libraryRemove');
  });
});
```

- [ ] **Step 2: Run to fail** — FAIL.
- [ ] **Step 3: Implement** channels + `safeHandle` registrations + preload surface + `api.d.ts` types. Add a `libraryChanged()` method to `live-reindex.ts`/`.singleton.ts` mirroring `conversationsChanged()` (gate `useMemory && autoReindex`; calls `reindexLibrary`), OR call `reindexLibrary()` directly fire-and-forget in the handler — pick the live-reindexer path for consistency.
- [ ] **Step 4: Run** — `npx vitest run test/memory-library-ipc.test.ts` → PASS; `npx vitest run test/memory-live-reindex.test.ts` stays green.
- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts src/main/services/memory/live-reindex.ts src/main/services/memory/live-reindex.singleton.ts test/memory-library-ipc.test.ts
git commit -m "feat(memory): library IPC (list/add/remove) with live reindex"
```

---

## Task 9: Renderer extraction dispatcher + "➕ Add to memory" UI

**Files:**
- Create: `src/renderer/lib/libraryExtract.ts`
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx`
- Test: `test/library-extract.test.ts`

**Interfaces:**
- Consumes: `extractPdfText` from `../lib/pdfExtract`; `mammoth` (dynamic import, as DocViewer does).
- Produces: `export async function extractForLibrary(name: string, bytes: Uint8Array): Promise<{ title: string; mime: string; text: string }>` — dispatch by extension: `.pdf` → `extractPdfText(bytes)`; `.txt`/`.md` → UTF-8 decode; `.docx` → `mammoth.convertToHtml({arrayBuffer})` then strip tags to text; else throw `new Error('Unsupported file type: <name>')`.

- [ ] **Step 1: Failing test** (txt + md + unsupported; pdf/docx exercised via a mocked pdfExtract/mammoth)

```ts
// test/library-extract.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/renderer/lib/pdfExtract', () => ({ extractPdfText: async () => 'pdf text' }));
import { extractForLibrary } from '../src/renderer/lib/libraryExtract';
const enc = (s: string) => new TextEncoder().encode(s);
describe('extractForLibrary', () => {
  it('decodes txt/md', async () => {
    expect((await extractForLibrary('a.txt', enc('hello'))).text).toBe('hello');
    expect((await extractForLibrary('a.md', enc('# hi'))).mime).toBe('text/markdown');
  });
  it('routes pdf to extractPdfText', async () => {
    expect((await extractForLibrary('a.pdf', enc('%PDF'))).text).toBe('pdf text');
  });
  it('rejects unsupported', async () => {
    await expect(extractForLibrary('a.exe', enc('MZ'))).rejects.toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run to fail** — FAIL.
- [ ] **Step 3: Implement** `libraryExtract.ts`. Then in `AiAssistantModule.tsx`: add a `➕ Add to memory` button + a hidden `<input type="file" accept=".pdf,.txt,.md,.docx" multiple>` and a drag-drop handler on the chat pane; for each file read `arrayBuffer` → `extractForLibrary` → `window.api.memory.library.add({title,mime,text})` → `toast.success(\`Indexed '${title}'\`)`; errors → `toast.error`.
- [ ] **Step 4: Run** — `npx vitest run test/library-extract.test.ts` → PASS; `pnpm typecheck` clean.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/libraryExtract.ts src/renderer/modules/ai-assistant/AiAssistantModule.tsx test/library-extract.test.ts
git commit -m "feat(ai): upload documents into memory from the assistant (pdf/txt/md/docx)"
```

---

## Task 10: Graph model + build (pure)

**Files:**
- Create: `src/main/services/memory/graph/model.ts`, `src/main/services/memory/graph/build.ts`
- Test: `test/memory-graph-build.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // model.ts
  export type NodeKind = 'fact' | 'doc' | 'conversation' | 'entity';
  export interface GraphNode { id: string; kind: NodeKind; label: string; strength: number; pinned: boolean; conflict: boolean; vector: number[]; x: number; y: number; cluster: number }
  export type EdgeKind = 'auto' | 'bond';
  export interface GraphEdge { source: string; target: string; kind: EdgeKind; weight: number }
  export interface MemoryGraph { nodes: GraphNode[]; edges: GraphEdge[] }
  ```
  ```ts
  // build.ts — pure: given already-loaded shards + profile items, produce nodes (x/y/cluster filled later by layout; default 0)
  export interface BuildInputs { shards: MemoryShard[]; profile: MemoryItem[] }
  export function buildNodes(input: BuildInputs): GraphNode[];
  ```
- Node derivation: one `doc` node per library `doc:*` sourceKey (label = ref, vector = mean of that source's chunk vectors, strength = min(1, chunks/… )); one `conversation` node per `convo:*` sourceKey; one `entity` node per case `entities` source; one `fact` node per profile `MemoryItem` (label = item.text, strength = item.confidence, pinned = item.pinned, vector = mean of nothing → embed-less: use a zero vector placeholder, similarity edges for facts handled by text later — for v1, facts get vector = [] and are excluded from auto-edge similarity). `conflict` defaults false (set later by reconcile in Task 17).

- [ ] **Step 1: Failing test**

```ts
// test/memory-graph-build.test.ts
import { describe, it, expect } from 'vitest';
import { buildNodes } from '../src/main/services/memory/graph/build';
import type { MemoryShard } from '../src/main/services/memory/store';

const shard = (caseId: string, title: string, chunks: any[]): MemoryShard =>
  ({ version: 1, model: 'nomic-embed-text', caseId, title, sources: {}, chunks });

describe('graph build', () => {
  it('makes one doc node per library doc source, vector = mean of its chunks', () => {
    const lib = shard('__library__', 'Library', [
      { id: 'doc:1#0', sourceKey: 'doc:1', kind: 'doc', ref: 'a.txt', text: 'x', vector: [1, 0] },
      { id: 'doc:1#1', sourceKey: 'doc:1', kind: 'doc', ref: 'a.txt', text: 'y', vector: [3, 0] }
    ]);
    const nodes = buildNodes({ shards: [lib], profile: [] });
    const doc = nodes.find((n) => n.kind === 'doc');
    expect(doc?.label).toBe('a.txt');
    expect(doc?.vector).toEqual([2, 0]); // mean
  });
});
```

- [ ] **Step 2: Run to fail** — FAIL.
- [ ] **Step 3: Implement** `model.ts` types and `buildNodes` (group chunks by `sourceKey`, map prefix→NodeKind, mean-vector, profile items→fact nodes).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/services/memory/graph/model.ts src/main/services/memory/graph/build.ts test/memory-graph-build.test.ts
git commit -m "feat(memory): graph node model + pure node builder from shards and profile"
```

---

## Task 11: Similarity auto-edges (pure)

**Files:**
- Create: `src/main/services/memory/graph/edges.ts`
- Test: `test/memory-graph-edges.test.ts`

**Interfaces:**
- Consumes: `cosine` from `../store`.
- Produces: `export function autoEdges(nodes: GraphNode[], opts?: { threshold?: number; maxPerNode?: number }): GraphEdge[]` — for each unordered node pair with both vectors non-empty, compute cosine; keep edges ≥ `threshold` (default 0.6); cap to top `maxPerNode` (default 4) per node; `kind: 'auto'`, `weight = score`; dedupe undirected; deterministic order (sort by `source,target`).

- [ ] **Step 1: Failing test**

```ts
// test/memory-graph-edges.test.ts
import { describe, it, expect } from 'vitest';
import { autoEdges } from '../src/main/services/memory/graph/edges';
import type { GraphNode } from '../src/main/services/memory/graph/model';
const n = (id: string, v: number[]): GraphNode => ({ id, kind: 'doc', label: id, strength: 1, pinned: false, conflict: false, vector: v, x: 0, y: 0, cluster: 0 });
describe('auto edges', () => {
  it('links similar nodes, skips dissimilar and empty-vector nodes', () => {
    const e = autoEdges([n('a', [1, 0]), n('b', [1, 0]), n('c', [0, 1]), n('d', [])], { threshold: 0.9 });
    expect(e).toEqual([{ source: 'a', target: 'b', kind: 'auto', weight: 1 }]);
  });
});
```

- [ ] **Step 2–5:** Run→fail; implement; run→pass; commit `feat(memory): similarity auto-edges for the graph`.

---

## Task 12: Deterministic clustered layout (pure)

**Files:**
- Create: `src/main/services/memory/graph/layout.ts`
- Test: `test/memory-graph-layout.test.ts`

**Interfaces:**
- Produces: `export function layout(nodes: GraphNode[], opts?: { clusters?: number; width?: number; height?: number }): GraphNode[]` — returns nodes with `cluster`, `x`, `y` filled. Deterministic: **no `Math.random`**. Algorithm: deterministic k-means over node vectors with a fixed seed derived from node ids (seed the initial centroids by picking the k nodes whose id sorts first), fixed iteration count (e.g. 8); place cluster centers evenly on a circle (`angle = 2π·c/clusters`), place each node around its center by a deterministic offset derived from a hash of its id (angle) and its within-cluster rank (radius). Nodes with empty vectors go to a dedicated "unclustered" ring. Same input ⇒ identical output.

- [ ] **Step 1: Failing test** (determinism is the key assertion)

```ts
// test/memory-graph-layout.test.ts
import { describe, it, expect } from 'vitest';
import { layout } from '../src/main/services/memory/graph/layout';
import type { GraphNode } from '../src/main/services/memory/graph/model';
const n = (id: string, v: number[]): GraphNode => ({ id, kind: 'doc', label: id, strength: 1, pinned: false, conflict: false, vector: v, x: 0, y: 0, cluster: 0 });
describe('deterministic layout', () => {
  it('same input → identical positions (no RNG)', () => {
    const input = () => [n('a', [1, 0]), n('b', [0.9, 0.1]), n('c', [0, 1]), n('d', [0.1, 0.9])];
    const a = layout(input(), { clusters: 2 });
    const b = layout(input(), { clusters: 2 });
    expect(a.map((x) => [x.id, x.x, x.y, x.cluster])).toEqual(b.map((x) => [x.id, x.x, x.y, x.cluster]));
    expect(a.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))).toBe(true);
  });
});
```

- [ ] **Step 2–5:** Run→fail; implement (pure, seeded); run→pass; commit `feat(memory): deterministic clustered graph layout`.

---

## Task 13: Assemble MemoryGraph + `memory:graph` IPC

**Files:**
- Create: `src/main/services/memory/graph/index.ts`
- Modify: `src/main/services/memory/index.ts` (export `buildGraph`), `ipc-contracts.ts`, `register.ts`, preload (+ `api.d.ts`)
- Test: `test/memory-graph-assemble.test.ts`

**Interfaces:**
- Produces: `export async function buildGraph(): Promise<MemoryGraph>` — load all shards (reuse the enumeration from `shardsFor` — extract a shared `loadAllShards()` helper in `store.ts` or `retriever.ts` and use it here and in `shardsFor` to avoid divergence) + profile items (`profileList()` all scopes), `buildNodes` → `autoEdges` → `layout` → `{ nodes, edges }`. Channel `memory.graph='memory:graph'`; `window.api.memory.graph(): Promise<MemoryGraph>`.
- Note: extract `export async function loadAllShards(): Promise<MemoryShard[]>` into `store.ts` and refactor `retriever.shardsFor` (no-caseId branch), `index.status`, and `buildGraph` to call it — one enumeration, DRY. Keep behavior identical (case shards + conversation shard + library shard).

- [ ] **Step 1: Failing test** — build a couple of shards on a tmp root, assert `buildGraph()` returns nodes with finite x/y and at least one edge for similar docs. (Mock embed-runtime; set embedder.)
- [ ] **Step 2–5:** fail; implement; pass (`npx vitest run test/memory-graph-assemble.test.ts test/memory.test.ts`); commit `feat(memory): assemble MemoryGraph and expose it over IPC`.

---

## Task 14: Mind's Eye SVG module

**Files:**
- Create: `src/renderer/modules/minds-eye/svg-graph.ts` (pure geometry: map `MemoryGraph` → renderable `{ circles, lines, labels }` with a viewBox), `src/renderer/modules/minds-eye/MindsEyeModule.tsx`
- Modify: `src/renderer/modules/register-builtins.tsx` (register `minds-eye`), `src/renderer/shell/Icon.tsx` (glyph), and open-from-Memory-button in `AiAssistantModule.tsx`
- Test: `test/minds-eye-svg.test.ts`

**Interfaces:**
- `svg-graph.ts` (pure, testable): `export function toSvgScene(graph: MemoryGraph, view: { w: number; h: number }): { nodes: {id,cx,cy,r,cls}[]; edges: {x1,y1,x2,y2,cls}[]; labels: {x,y,text}[] }`. Node radius from `strength`; `cls` from kind + pinned/conflict; edge `cls` from `'auto'|'bond'`. Normalize node x/y (which layout produced in some arbitrary range) into the viewBox.
- `MindsEyeModule.tsx`: fetches `window.api.memory.graph()`, renders `<svg viewBox="0 0 {w} {h}">` with `<line>`/`<circle>`/`<text>` from `toSvgScene`. **SVG/DOM only — NO `<canvas>`** (canvas rendered black on mobile). Empty state: when `nodes.length===0`, render an inviting message ("Nothing remembered yet — start chatting or ➕ add a document"), never a blank/black rect. Clicking a node opens an inspector panel (kind, label, strength, provenance). Reduced-motion respected.

- [ ] **Step 1: Failing test** (pure scene mapping + empty-state guarantee)

```ts
// test/minds-eye-svg.test.ts
import { describe, it, expect } from 'vitest';
import { toSvgScene } from '../src/renderer/modules/minds-eye/svg-graph';
describe('svg scene', () => {
  it('maps nodes into the viewBox and never returns NaN', () => {
    const scene = toSvgScene({ nodes: [
      { id: 'a', kind: 'doc', label: 'a', strength: 1, pinned: false, conflict: false, vector: [], x: -50, y: 200, cluster: 0 }
    ], edges: [] }, { w: 720, h: 500 });
    const c = scene.nodes[0];
    expect(c.cx).toBeGreaterThanOrEqual(0); expect(c.cx).toBeLessThanOrEqual(720);
    expect(Number.isFinite(c.cy)).toBe(true);
  });
});
```

- [ ] **Step 2–5:** fail; implement pure mapper + the React module + registration; `npx vitest run test/minds-eye-svg.test.ts` PASS; `pnpm typecheck` clean; commit `feat(minds-eye): SVG memory graph surface with empty state`.

---

## Task 15: Mind's Eye renders non-black on mobile (Playwright)

**Files:**
- Test: `test/minds-eye-render.pw.test.ts` (follow the existing Playwright computed-style harness used for the 98.css/table checks — locate it and mirror its setup)

**Interfaces:** Render `MindsEyeModule` (or a static fixture HTML that mounts the SVG scene) at a mobile viewport (e.g. 390×844), assert: the SVG element exists, its computed background is not the same as the container fill making it all-black, and at least one `<circle>` (populated) OR the empty-state text (empty) is present. This is the guard against the v1 canvas-black regression.

- [ ] **Step 1:** Write the Playwright test mirroring the repo's existing `*.pw.test.ts`/computed-style harness (search `resolveComputedStyle`/`page.evaluate(getComputedStyle`).
- [ ] **Step 2:** Run → fail (until fixture wired). Run: the repo's Playwright command (check `package.json` scripts, e.g. `pnpm test:e2e` or a dedicated vitest+playwright config).
- [ ] **Step 3:** Wire a minimal render fixture (populated + empty).
- [ ] **Step 4:** Run → PASS both states.
- [ ] **Step 5:** Commit `test(minds-eye): assert SVG graph renders non-black on a mobile viewport`.

---

## Task 16: Curation — pin / forget / recall-into-chat

**Files:**
- Modify: `register.ts` (channels `memory.forgetDoc`, reuse `memory.profileUpsert`/`profileDelete` for facts), preload, `MindsEyeModule.tsx`, `ipc-contracts.ts`
- Test: `test/memory-forget-doc.test.ts`

**Interfaces:**
- `memory.forgetDoc='memory:forgetDoc'` → `createLibrary().remove(docId)` then `reindexLibrary()`. Pin/forget a **fact** reuses existing `profileUpsert({id,scope,text,pinned})` / `profileDelete([id])`. "Recall into chat" is renderer-only: clicking a node posts its label/text into the active AI Assistant composer (a window message or shared store) — no new IPC. Node id encodes kind so the renderer routes: `fact:*`→profile ops, `doc:*`→forgetDoc, `conversation:*`/`entity:*`→(v1) forget disabled with a tooltip.

- [ ] **Step 1: Failing test** — forgetDoc removes the doc + its chunks (add doc, reindex, recall finds it; forgetDoc; recall no longer finds it).
- [ ] **Step 2–5:** fail; implement handler + wire node context menu (pin/forget/recall) in `MindsEyeModule.tsx`; PASS; commit `feat(minds-eye): pin/forget/recall-into-chat curation`.

---

## Task 17: Curation — merge duplicates + resolve conflict

**Files:**
- Create: `src/main/services/memory/graph/merge.ts` (pure merge/conflict logic over `MemoryItem[]`)
- Modify: `register.ts` (`memory.mergeItems`), `build.ts` (set `conflict:true` on facts flagged by a conflict detector), preload, `MindsEyeModule.tsx`, contracts
- Test: `test/memory-merge.test.ts`

**Interfaces:**
- `merge.ts`: `export function detectConflicts(items: MemoryItem[]): [string,string][]` — pairs whose `normalized` text contradicts (v1 heuristic: same subject prefix, differing trailing value — keep the heuristic conservative and documented); `export function mergeItems(items: MemoryItem[], keepId: string, dropId: string, now: number): MemoryItem[]` — union provenance, keep higher confidence, drop the other.
- `memory.mergeItems='memory:mergeItems'` → load profile, `mergeItems`, persist via profile store `put`/`remove`. `build.ts` calls `detectConflicts` to set `conflict` on the involved fact nodes so the "one thing to fix" tray can surface them one at a time.

- [ ] **Step 1: Failing test** — `mergeItems` unions provenance + keeps higher confidence + drops the other; `detectConflicts` finds an obvious contradiction and ignores unrelated items.
- [ ] **Step 2–5:** fail; implement; wire the "one thing to fix" tray (surface a single conflict, Resolve → mergeItems); PASS; commit `feat(minds-eye): merge duplicates and resolve conflicts`.

---

## Task 18: Retrieval bonds store

**Files:**
- Create: `src/main/services/memory/bonds.ts`
- Test: `test/memory-bonds-store.test.ts`

**Interfaces:**
- Consumes: `secureReadText`/`secureWriteFile`, `dataRoot`.
- Produces:
  ```ts
  export interface Bond { a: string; b: string } // node ids, undirected, stored a<b
  export interface BondIO { read(): Promise<string|null>; write(t: string): Promise<void> }
  export function bondsPath(): string; // join(dataRoot(),'memory','bonds.json')
  export function createBonds(io?: BondIO): {
    list(): Promise<Bond[]>;
    add(a: string, b: string): Promise<void>;   // normalizes order, dedupes, ignores self-bond
    remove(a: string, b: string): Promise<void>;
    neighbors(id: string): Promise<string[]>;   // one-hop neighbor node ids
  };
  ```

- [ ] **Step 1: Failing test** — add(a,b) then add(b,a) yields ONE bond; `neighbors('a')` returns `['b']`; remove clears it; self-bond ignored.
- [ ] **Step 2–5:** fail; implement (default IO via secure-fs); PASS; commit `feat(memory): retrieval bond store (undirected, encrypted)`.

---

## Task 19: Bond boost in recall (pure + integration)

**Files:**
- Modify: `src/main/services/memory/retriever.ts`
- Test: `test/memory-bond-boost.test.ts`

**Interfaces:**
- Produces: `export function applyBondBoost(hits: RecallHit[], neighborsOf: (nodeId: string) => Set<string>, opts?: { boost?: number }): RecallHit[]` — pure. Map each hit to its node id (`nodeIdOf(hit)`: `doc:*`/`convo:*` derive from sourceKey prefix; for chunks the retriever must carry `sourceKey` — add `sourceKey` to `RecallHit` OR compute node id from `caseId`+`kind`+`ref`). For any hit whose node is a one-hop neighbor of a top-scoring hit's node, add a **fixed** `boost` (default `0.15`) to its score; re-sort with the SAME stable tie-break (`score desc, ref asc`); one hop only (no transitive). Mark boosted hits so provenance can say "recalled via your link" (add `viaBond?: boolean` to `RecallHit`).
- Integration: `recall()` loads bonds (`createBonds().list()` → a `neighborsOf` set-map) when no test override; applies `applyBondBoost` before the final `slice(0,k)`. Guard: bond application is best-effort (try/catch) so a bond-store error never breaks recall.

- [ ] **Step 1: Failing test** (pure boost, deterministic, one-hop)

```ts
// test/memory-bond-boost.test.ts
import { describe, it, expect } from 'vitest';
import { applyBondBoost } from '../src/main/services/memory/retriever';
import type { RecallHit } from '../src/main/services/memory/retriever';
const hit = (ref: string, score: number, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ caseId: '__library__', caseTitle: 'Library', kind: 'doc', ref, text: ref, snippet: ref, score, ...extra });
describe('bond boost', () => {
  it('boosts a one-hop neighbor of a top hit and re-sorts, marking viaBond', () => {
    // node ids derived as `doc:<ref>` for this test's nodeIdOf
    const hits = [hit('a', 0.9), hit('b', 0.5)];
    const neighbors = (id: string) => new Set(id === 'doc:a' ? ['doc:b'] : id === 'doc:b' ? ['doc:a'] : []);
    const out = applyBondBoost(hits, neighbors, { boost: 0.15 });
    const b = out.find((h) => h.ref === 'b')!;
    expect(b.score).toBeCloseTo(0.65);
    expect(b.viaBond).toBe(true);
  });
});
```

- [ ] **Step 2–5:** fail; implement `nodeIdOf`, `applyBondBoost`, and the `recall` integration; PASS (`npx vitest run test/memory-bond-boost.test.ts test/memory.test.ts`); commit `feat(memory): user-drawn bonds boost co-recall (one-hop, fixed, deterministic)`.

---

## Task 20: Bond IPC + draw/cut in Mind's Eye + bond provenance

**Files:**
- Modify: `ipc-contracts.ts`, `register.ts`, preload, `MindsEyeModule.tsx`, `svg-graph.ts` (bold bond edges), `src/renderer/modules/ai-assistant/memory-view.ts` (or wherever provenance is formatted) for "recalled via your link"
- Test: `test/memory-bond-ipc.test.ts`

**Interfaces:**
- Channels: `memory.bondList='memory:bondList'`, `memory.bondAdd='memory:bondAdd'`, `memory.bondRemove='memory:bondRemove'` → `createBonds()` ops. preload `window.api.memory.bonds = { list(), add(a,b), remove(a,b) }`.
- `buildGraph` includes bonds as `GraphEdge{kind:'bond',weight:1}` so they render. `svg-graph.ts` gives bond edges a bold `cls`. `MindsEyeModule` drag-from-node-to-node → `bonds.add`; click a bond → cut (`bonds.remove`). Provenance: where recall hits are shown, a `viaBond` hit shows "recalled via your link".

- [ ] **Step 1: Failing test** — channels declared; a light handler test that add→list→remove round-trips through `createBonds` with an injected IO.
- [ ] **Step 2–5:** fail; implement; PASS; commit `feat(minds-eye): draw/cut association bonds with recall provenance`.

---

## Task 21: Version bump + docs

**Files:**
- Modify: `package.json` (version), `README.md` (status/changelog/test count), `RELEASE_NOTES_v<next>.md` (new)
- No test (docs). Set version to the next appropriate release (decide from the current `package.json` version at execution time; this is a minor feature release).

- [ ] **Step 1:** Read current version; bump minor. Update README status block + test count (run `pnpm test` first to get the count). Write release notes summarizing: global memory by default, embedding-engine fix, document library (uploads+briefcase+journal), Mind's Eye graph with curation + bonds.
- [ ] **Step 2:** `pnpm typecheck && pnpm test` — full suite green.
- [ ] **Step 3:** Commit `chore(release): v<next> — global scalable memory + Mind's Eye`. **Do NOT tag/publish** — release is operator-gated.

---

## Task 22: Full verification + charter gates

**Files:** none (verification only)

- [ ] **Step 1:** `pnpm typecheck` → clean.
- [ ] **Step 2:** `pnpm test` → all green; record the count.
- [ ] **Step 3: Charter — no-egress.** Grep the new code for any non-loopback URL/fetch host; confirm the only endpoints are `127.0.0.1:11434` (chat) and the dedicated embed port (`127.0.0.1:1143x`). If the repo has a netns/no-egress harness (search `netns`/`no-egress`), run it with memory enabled and assert only loopback traffic.
- [ ] **Step 4: Charter — determinism.** Add/confirm a double-run diff: `buildGraph()` twice on the same pool ⇒ identical node positions and edge sets; `recall()` twice ⇒ identical ordering. (This can live in `test/memory-graph-layout.test.ts` / `test/memory.test.ts`.)
- [ ] **Step 5:** No commit (or a docs-only note). Report the final test count and any residual Minor findings for the operator.

---

## Self-Review (author's check against the spec)

**Spec coverage:** embedding-runtime fix → T1–T2; loud/default-on indexer → T3–T4; global library incl. briefcase/journal + upload → T5–T9; Mind's Eye see+shape (nodes, auto/bond edges, layout, SVG, empty-state, curation: pin/forget/merge/resolve/recall) → T10–T17; retrieval bonds semantics (one-hop, fixed, undirected, provenance) → T18–T20; determinism + no-egress + encrypted-at-rest → Global Constraints + T22; migration (non-destructive, additive shards, no forced default flip for existing installs) → T4 note + additive shards. Voice PTT, "Q" rename, and web-search are explicitly out of scope per the spec.

**Placeholder scan:** none — every task has concrete test + implementation code or exact interface signatures; the two "decide at execution time" items (version number in T21, Playwright command in T15) are genuine environment reads, not hand-waves, and are called out as such.

**Type consistency:** `ChunkKind` extended once (T5) and consumed by store/retriever; `MemoryShard`/`StoredChunk` names used verbatim; `GraphNode`/`GraphEdge`/`MemoryGraph` defined in T10 and consumed T11–T14, T20; `RecallHit` gains `viaBond?`/(and `sourceKey` if needed) in T19 and is read in T20; `LibraryDoc` defined T6, used T7–T8. `reindexAll` return shape widened once (T3) and read in T4/T8/SettingsModule.

**Known execution-time decisions (flagged, not placeholders):** next version number (T21), exact Playwright harness invocation (T15), and whether `libraryChanged` lives on the live-reindexer vs a direct `reindexLibrary()` call (T8) — the plan states the preferred path for each.
