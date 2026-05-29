# Turnkey Local-AI Installer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship local, offline AI in Ghost Access 98 with no manual Ollama setup, via two tracks — a CI-assembled bundled-offline mega-installer and an online in-app fetch wizard — on Windows/Linux/macOS.

**Architecture:** A new main-process `localAi` service owns runtime detection/launch (hybrid: reuse a responsive Ollama on `127.0.0.1:11434`, else spawn our own loopback-only managed child) and model presence (bundled GGUF import or online pull), then auto-configures the existing `ai.*` settings without clobbering a user's. A renderer wizard in Settings → AI drives it over new loopback-pinned IPC. A GitHub Actions workflow assembles the bundled mega-installers with pinned, sha256-verified Ollama + Llama-3.1-8B.

**Tech Stack:** Electron 33, electron-vite, electron-builder (NSIS/AppImage/dmg), TypeScript (strict), vitest, GitHub Actions. Model runtime: Ollama. Model: Llama-3.1-8B (Q4_K_M GGUF), Meta Llama 3.1 Community License.

**Spec:** `docs/superpowers/specs/2026-05-29-turnkey-installer-design.md`

---

## File structure (what gets created/modified)

**Created**
- `src/main/services/local-ai.ts` — the runtime service (detect / ensureRuntime / ensureModel / autoConfigure / start / stop). One responsibility: own the local model runtime + model presence, loopback-only.
- `src/main/services/local-ai-paths.ts` — small helper resolving bundled (`process.resourcesPath`) vs fetched (`userData/local-ai`) binary + model dirs. Keeps path logic out of the service body.
- `src/main/services/local-ai-fetch.ts` — online-track download helper (pinned URL + sha256 verify + progress callback). Network egress lives in exactly one file.
- `src/renderer/modules/settings/LocalAiPane.tsx` — the "Set up local AI" wizard UI (state machine + progress + consent).
- `ci/pins.json` — pinned Ollama versions + Llama-3.1-8B GGUF source + sha256 per platform (produced by the spikes).
- `.github/workflows/bundle.yml` — the bundled mega-installer matrix workflow.
- `resources/licenses/LLAMA-3.1-COMMUNITY-LICENSE.txt`, `resources/licenses/LLAMA-3.1-AUP.txt`, `resources/licenses/OLLAMA-MIT.txt` — redistribution assets.
- Tests: `test/local-ai.test.ts`, `test/local-ai-fetch.test.ts`, `test/local-ai-redteam.test.ts`.

**Modified**
- `src/shared/ipc-contracts.ts` — add the `localAi` channel namespace + `LocalAiStatus` type + contract entries.
- `src/main/ipc/register.ts` — register `localAi.*` handlers (loopback-pinned, validated); wire `stop()` to app quit.
- `src/main/security/validate.ts` — `ensureLocalAiSetupOpts` validator.
- `src/preload/index.ts` + `src/preload/api.d.ts` — `localAi` bridge + typed `GhostApi.localAi`.
- `src/renderer/state/store.ts` — `useLocalAi` slice.
- `src/renderer/modules/settings/SettingsModule.tsx` — mount `<LocalAiPane/>` in the AI section.
- `electron-builder` config in `package.json` — a bundled build flavor adding `extraResources` (runtime + model + licenses), gated by an env flag so the normal/online installer stays lean.

---

## Phase 0 — Validation spikes (de-risk before building)

These three tasks produce recorded facts (commands, pinned versions, hashes) that later tasks consume. Each has a concrete deliverable; none is "real code" until validated, so they are spikes by design.

### Task 0.1: Pin the Ollama runtime per platform

**Files:** Create `ci/pins.json`

- [ ] **Step 1:** For each target — `win-x64`, `linux-x64`, `darwin-x64`, `darwin-arm64` — identify the latest stable Ollama release asset URL from `https://github.com/ollama/ollama/releases` that is a *self-contained* runtime (the standalone binary/zip, not the system-service installer). Record URL + the published sha256 (or compute it after download).
- [ ] **Step 2:** Confirm the binary runs standalone with `OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=<tmp> <binary> serve` and that `curl http://127.0.0.1:11434/api/tags` returns 200. Record the exact invocation per platform.
- [ ] **Step 3:** Write `ci/pins.json`:

```json
{
  "ollama": {
    "win-x64":     { "url": "<asset url>", "sha256": "<hash>", "bin": "ollama.exe" },
    "linux-x64":   { "url": "<asset url>", "sha256": "<hash>", "bin": "ollama" },
    "darwin-x64":  { "url": "<asset url>", "sha256": "<hash>", "bin": "ollama" },
    "darwin-arm64":{ "url": "<asset url>", "sha256": "<hash>", "bin": "ollama" }
  },
  "model": {
    "name": "llama3.1",
    "gguf_url": "<pinned GGUF url>",
    "gguf_sha256": "<hash>",
    "quant": "Q4_K_M"
  }
}
```

- [ ] **Step 4: Commit.** `git add ci/pins.json && git commit -m "ci(turnkey): pin Ollama runtime + Llama-3.1 GGUF versions and hashes"`

**Acceptance:** every URL downloads, every sha256 matches, every binary serves on loopback.

### Task 0.2: Establish the offline GGUF→Ollama import path

**Files:** Create `ci/Modelfile.llama3.1`, append findings to `ci/pins.json` is not needed; record the command in this plan task's notes + a `ci/README.md`.

- [ ] **Step 1:** With a downloaded `llama-3.1-8b-instruct.Q4_K_M.gguf` and a standalone Ollama serving on loopback, write `ci/Modelfile.llama3.1`:

```
FROM ./llama-3.1-8b-instruct.Q4_K_M.gguf
```

- [ ] **Step 2:** Run `OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=<tmp> ollama create llama3.1 -f ci/Modelfile.llama3.1` **with no network** (block egress / airplane mode) and confirm it succeeds purely from the local GGUF.
- [ ] **Step 3:** Confirm `ollama run llama3.1 "say hi"` answers offline, and that `/api/tags` lists `llama3.1`.
- [ ] **Step 4:** Record in `ci/README.md` the exact working command, the resulting `OLLAMA_MODELS` blob layout (so the installer can ship pre-imported blobs and skip `create` at runtime if faster), and whether runtime `create` or pre-baked blobs is the chosen offline mechanism.
- [ ] **Step 5: Commit.** `git add ci/Modelfile.llama3.1 ci/README.md && git commit -m "ci(turnkey): document offline GGUF import path for Ollama"`

**Acceptance:** the model imports and answers with the network fully disconnected. This is the crux of the air-gap promise — do it first.

### Task 0.3: Prove multi-GB assembly fits a stock GitHub runner

**Files:** Create a throwaway `.github/workflows/bundle-spike.yml` (deleted after).

- [ ] **Step 1:** Write a one-platform (`win-x64`) workflow that: frees runner disk (remove `/opt/hostedtoolcache`, `/usr/share/dotnet`, Android SDK via the standard `jlumbroso/free-disk-space` pattern or manual `rm`), downloads the pinned Ollama + GGUF (verify sha256 from `ci/pins.json`), imports the model into a staging `OLLAMA_MODELS` dir per Task 0.2, and reports `df -h` after each step.
- [ ] **Step 2:** Run it via `gh workflow run bundle-spike.yml` (or push to a spike branch) and confirm peak disk stays under the runner limit with ~6 GB of artifacts present.
- [ ] **Step 3:** Record the disk headroom + the pruning steps that worked. Delete the spike workflow.
- [ ] **Step 4: Commit.** `git commit -m "ci(turnkey): validate stock-runner disk headroom for the bundle (spike removed)"`

**Acceptance:** a stock GitHub-hosted runner completes download+import+staging without ENOSPC. If it cannot, STOP and revisit (split-artifact assembly) before Phase 4.

---

## Phase 1 — `localAi` service (main process, fully TDD)

All Phase 1 tests use the existing electron mock pattern: `vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-localai-test' } }))`. The service uses global `fetch` (available in Electron 33 main) and `node:child_process`.

### Task 1.1: Status type + path helper

**Files:** Create `src/main/services/local-ai-paths.ts`; Modify `src/shared/ipc-contracts.ts`

- [ ] **Step 1:** Add to `src/shared/ipc-contracts.ts` (near `AuthStatus`):

```ts
export type LocalAiState = 'using-existing' | 'bundled-ready' | 'running' | 'not-present' | 'downloading' | 'importing' | 'error';
export interface LocalAiStatus {
  state: LocalAiState;
  /** true when a responsive Ollama is reachable on the loopback endpoint right now */
  runtimeUp: boolean;
  /** true when the llama3.1 model is present in that runtime */
  modelPresent: boolean;
  /** true when this build shipped bundled runtime+model assets */
  bundled: boolean;
  message?: string;
}
```

- [ ] **Step 2:** Create `src/main/services/local-ai-paths.ts`:

```ts
import { app } from 'electron';
import { join } from 'node:path';

/** Where the online wizard stores a fetched runtime + models. */
export function fetchedRoot(): string { return join(app.getPath('userData'), 'local-ai'); }
export function fetchedModelsDir(): string { return join(fetchedRoot(), 'models'); }

/** Where the bundled mega-installer places runtime + model (electron-builder extraResources). */
export function bundledRoot(): string { return join(process.resourcesPath, 'local-ai'); }

/** Loopback endpoint the runtime is always pinned to. */
export const LOCAL_AI_HOST = '127.0.0.1';
export const LOCAL_AI_PORT = 11434;
export const LOCAL_AI_ENDPOINT = `http://${LOCAL_AI_HOST}:${LOCAL_AI_PORT}`;
export const LOCAL_AI_MODEL = 'llama3.1';
```

- [ ] **Step 3: Commit.** `git add src/shared/ipc-contracts.ts src/main/services/local-ai-paths.ts && git commit -m "feat(local-ai): status type + path/loopback constants"`

### Task 1.2: `detect()` — runtime + model probe

**Files:** Create `src/main/services/local-ai.ts`; Test `test/local-ai.test.ts`

- [ ] **Step 1: Write the failing test** in `test/local-ai.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-localai-test' } }));
import * as localAi from '../src/main/services/local-ai';

describe('local-ai detect()', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports runtimeUp + modelPresent when the loopback API lists llama3.1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3.1:latest' }] }), { status: 200 })));
    const s = await localAi.detect();
    expect(s.runtimeUp).toBe(true);
    expect(s.modelPresent).toBe(true);
  });

  it('reports runtime down when the probe rejects (no Ollama)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const s = await localAi.detect();
    expect(s.runtimeUp).toBe(false);
    expect(s.modelPresent).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm vitest run test/local-ai.test.ts` → FAIL (`detect` not exported).
- [ ] **Step 3: Implement** in `src/main/services/local-ai.ts`:

```ts
import { LOCAL_AI_ENDPOINT, LOCAL_AI_MODEL } from './local-ai-paths';
import type { LocalAiStatus } from '@shared/ipc-contracts';

let bundledOverride: boolean | null = null; // set by isBundled(); test seam

async function probeTags(): Promise<string[] | null> {
  try {
    const ctrl = AbortSignal.timeout(1500);
    const res = await fetch(`${LOCAL_AI_ENDPOINT}/api/tags`, { signal: ctrl });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).map((m) => m.name ?? '');
  } catch { return null; }
}

export async function detect(): Promise<LocalAiStatus> {
  const tags = await probeTags();
  const runtimeUp = tags !== null;
  const modelPresent = !!tags?.some((n) => n.startsWith(LOCAL_AI_MODEL));
  return {
    state: runtimeUp ? (modelPresent ? 'running' : 'not-present') : 'not-present',
    runtimeUp, modelPresent, bundled: bundledOverride ?? false
  };
}
```

- [ ] **Step 4: Run to verify it passes.** `pnpm vitest run test/local-ai.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git add src/main/services/local-ai.ts test/local-ai.test.ts && git commit -m "feat(local-ai): detect() loopback runtime + model probe"`

### Task 1.3: `isBundled()` — bundled-asset detection

**Files:** Modify `src/main/services/local-ai.ts`; Test `test/local-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append):

```ts
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { bundledRoot } from '../src/main/services/local-ai-paths';
// NOTE: bundledRoot() uses process.resourcesPath; in tests stub it via the exported override.

it('isBundled() true only when the runtime binary + model marker exist under resources', async () => {
  localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
  expect(await localAi.isBundled()).toBe(false);
  await mkdir('/tmp/ga98-localai-test/res/local-ai/models', { recursive: true });
  await writeFile('/tmp/ga98-localai-test/res/local-ai/ollama', 'x');
  await writeFile('/tmp/ga98-localai-test/res/local-ai/MODEL_PRESENT', 'llama3.1');
  expect(await localAi.isBundled()).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails.** `pnpm vitest run test/local-ai.test.ts` → FAIL.
- [ ] **Step 3: Implement** (add to `local-ai.ts`): a `__setBundledRootForTest(p)` seam, and `isBundled()` that checks for the runtime binary (`ollama`/`ollama.exe`) AND a `MODEL_PRESENT` marker under the bundled root; set `bundledOverride` accordingly.

```ts
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { bundledRoot as defaultBundledRoot } from './local-ai-paths';

let bundledRootFn = defaultBundledRoot;
export function __setBundledRootForTest(p: string): void { bundledRootFn = () => p; }
async function exists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

export async function isBundled(): Promise<boolean> {
  const root = bundledRootFn();
  const bin = (await exists(join(root, 'ollama'))) || (await exists(join(root, 'ollama.exe')));
  const model = await exists(join(root, 'MODEL_PRESENT'));
  bundledOverride = bin && model;
  return bundledOverride;
}
```

- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): isBundled() detection of shipped runtime+model"`

### Task 1.4: `ensureRuntime()` — hybrid reuse-or-spawn

**Files:** Modify `src/main/services/local-ai.ts`; Test `test/local-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append) — reuse path does NOT spawn:

```ts
it('ensureRuntime() reuses an existing runtime without spawning', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
  const spawn = vi.fn();
  localAi.__setSpawnForTest(spawn);
  await localAi.ensureRuntime();
  expect(spawn).not.toHaveBeenCalled();
});

it('ensureRuntime() spawns the managed child (loopback env) when none is up', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(async () => { throw new Error('down'); })   // initial detect
    .mockImplementation(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }))); // readiness
  const spawn = vi.fn(() => ({ on: vi.fn(), kill: vi.fn(), pid: 123 }));
  localAi.__setSpawnForTest(spawn);
  localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai'); // binary present from 1.3
  await localAi.ensureRuntime();
  expect(spawn).toHaveBeenCalledTimes(1);
  const env = spawn.mock.calls[0][2].env;
  expect(env.OLLAMA_HOST).toBe('127.0.0.1:11434');
});
```

- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement** `ensureRuntime()`: `detect()`; if `runtimeUp` return (reuse). Else resolve the binary (bundled root if `isBundled()`, else `fetchedRoot()`), `spawn(bin, ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: <modelsDir>, OLLAMA_NO_ANALYTICS: '1' }, stdio: 'ignore' })`, store the child handle, poll `probeTags()` until non-null or a timeout (~30s), throw on timeout. Add `__setSpawnForTest`.
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): ensureRuntime() hybrid reuse-or-spawn, loopback-pinned"`

### Task 1.5: `ensureModel()` — bundled import / online pull

**Files:** Modify `src/main/services/local-ai.ts`; Test `test/local-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append) — when the model is already listed, do nothing:

```ts
it('ensureModel() is a no-op when llama3.1 already present', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'llama3.1' }] }), { status: 200 })));
  const run = vi.fn();
  localAi.__setRunForTest(run); // stand-in for the import/pull executor
  await localAi.ensureModel();
  expect(run).not.toHaveBeenCalled();
});

it('ensureModel() runs the import when the model is absent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
  const run = vi.fn(async () => {});
  localAi.__setRunForTest(run);
  localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
  await localAi.ensureModel();
  expect(run).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement** `ensureModel(onProgress?)`: probe tags; if model present, return. Else, if `isBundled()`, run the offline import recorded in Task 0.2 (`ollama create llama3.1 -f <bundled Modelfile>` via the runtime API `POST /api/create` or the CLI, whichever Task 0.2 chose); else (online) call `local-ai-fetch` to download the GGUF (Task 2.x) then import the same way. Surface progress via `onProgress`. Use the `__setRunForTest` seam for the executor.
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): ensureModel() bundled-import / online-pull"`

### Task 1.6: `autoConfigure()` — non-clobbering settings write

**Files:** Modify `src/main/services/local-ai.ts`; Test `test/local-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append) — uses the real `settingsStore` (electron mocked):

```ts
import { settingsStore } from '../src/main/storage/json-fs';

it('autoConfigure() sets ollama/loopback/llama3.1 when provider is none', async () => {
  await settingsStore.update({ ai: { provider: 'none', endpoint: '', model: '' } as any });
  await localAi.autoConfigure();
  const s = await settingsStore.read();
  expect(s.ai.provider).toBe('ollama');
  expect(s.ai.endpoint).toBe('http://127.0.0.1:11434');
  expect(s.ai.model).toBe('llama3.1');
});

it('autoConfigure() never overrides a user-set custom endpoint', async () => {
  await settingsStore.update({ ai: { provider: 'openai-compatible', endpoint: 'https://api.example.com', model: 'gpt-4o-mini' } as any });
  await localAi.autoConfigure();
  const s = await settingsStore.read();
  expect(s.ai.provider).toBe('openai-compatible');
  expect(s.ai.endpoint).toBe('https://api.example.com');
});
```

- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement** `autoConfigure()`: read settings; only when `ai.provider === 'none'` (i.e., the user has not chosen a provider), `settingsStore.update({ ai: { provider: 'ollama', endpoint: LOCAL_AI_ENDPOINT, model: LOCAL_AI_MODEL } })`. Otherwise leave untouched.
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): autoConfigure() non-clobbering settings write"`

### Task 1.7: `stop()` + kill-on-quit

**Files:** Modify `src/main/services/local-ai.ts`, `src/main/index.ts`; Test `test/local-ai.test.ts`

- [ ] **Step 1: Write the failing test** (append): after a spawned child, `stop()` calls `child.kill()` and a second `stop()` is a no-op; a reused (not spawned) runtime is never killed.

```ts
it('stop() kills only a child we spawned, once', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(async () => { throw new Error('down'); })
    .mockImplementation(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
  const kill = vi.fn();
  localAi.__setSpawnForTest(() => ({ on: vi.fn(), kill, pid: 7 }));
  localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
  await localAi.ensureRuntime();
  localAi.stop(); localAi.stop();
  expect(kill).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement** `stop()`: if we hold a spawned child handle, `kill()` it and null the handle; never kill a reused runtime (we only store a handle when WE spawned). In `src/main/index.ts`, add `import * as localAi from './services/local-ai'` and `app.on('will-quit', () => localAi.stop())`.
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): stop() + kill-on-quit; never kill a reused runtime"`

---

## Phase 2 — IPC + online fetch + wizard

### Task 2.1: Pinned, integrity-checked download helper

**Files:** Create `src/main/services/local-ai-fetch.ts`; Test `test/local-ai-fetch.test.ts`

- [ ] **Step 1: Write the failing test** — a sha256 mismatch aborts and deletes the partial:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-fetch-test' } }));
import { downloadVerified } from '../src/main/services/local-ai-fetch';
import { mkdir, writeFile, access, rm } from 'node:fs/promises';

it('rejects + removes the file on sha256 mismatch', async () => {
  await mkdir('/tmp/ga98-fetch-test', { recursive: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1,2,3]), { status: 200 })));
  const dest = '/tmp/ga98-fetch-test/blob.bin';
  await expect(downloadVerified('https://x/y', dest, 'deadbeef'.repeat(8), () => {}))
    .rejects.toThrow(/sha256/i);
  await expect(access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
});
```

- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement** `downloadVerified(url, dest, expectedSha256, onProgress)`: stream the response to a `.part` file, hash with `createHash('sha256')` as it writes, compare to `expectedSha256`; on mismatch `rm` the part and throw `Error('sha256 mismatch')`; on match rename to `dest`. Emit `onProgress({receivedBytes,totalBytes})` from `Content-Length`. This is the ONLY file performing network egress.
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): integrity-verified download helper (single egress point)"`

### Task 2.2: Validator + IPC contracts

**Files:** Modify `src/main/security/validate.ts`, `src/shared/ipc-contracts.ts`; (tests via Task 2.3 handlers)

- [ ] **Step 1:** In `validate.ts` add `ensureLocalAiSetupOpts(raw)` that accepts `{ mode: 'online' | 'bundled' }` only (reject anything else), returning a clean object. No URLs accepted from the renderer — the source is pinned server-side in `ci/pins.json`/build constants, never client-supplied (SSRF guard).
- [ ] **Step 2:** In `ipc-contracts.ts` add the namespace:

```ts
localAi: {
  status: 'localAi:status',
  setup: 'localAi:setup',
  start: 'localAi:start',
  stop: 'localAi:stop',
  onProgress: 'localAi:onProgress'
},
```

and contract entries: `status(): LocalAiStatus`, `setup(opts): LocalAiStatus`, `start(): void`, `stop(): void`, plus an `onProgress` event payload `{ phase: 'download'|'import'; receivedBytes?: number; totalBytes?: number; message?: string }`.

- [ ] **Step 3: Commit.** `git commit -am "feat(local-ai): IPC contracts + setup-opts validator (no client URLs)"`

### Task 2.3: Register handlers (loopback-pinned, gated, consented)

**Files:** Modify `src/main/ipc/register.ts`; Test `test/local-ai-redteam.test.ts`

- [ ] **Step 1: Write the failing red-team test** asserting the online fetch requires `mode:'online'` consent and the endpoint never leaves loopback:

```ts
// test/local-ai-redteam.test.ts
import { describe, it, expect } from 'vitest';
import { LOCAL_AI_ENDPOINT } from '../src/main/services/local-ai-paths';
it('local AI endpoint is loopback-only', () => {
  expect(LOCAL_AI_ENDPOINT.startsWith('http://127.0.0.1:')).toBe(true);
});
import { ensureLocalAiSetupOpts } from '../src/main/security/validate';
it('setup opts reject anything but online|bundled (no client URL)', () => {
  expect(() => ensureLocalAiSetupOpts({ mode: 'evil', url: 'http://attacker' } as any)).toThrow();
  expect(ensureLocalAiSetupOpts({ mode: 'online' })).toEqual({ mode: 'online' });
});
```

- [ ] **Step 2: Run.** FAIL.
- [ ] **Step 3: Implement** handlers in `register.ts` using `safeHandle`: `localAi.status` → `localAi.detect()` merged with `isBundled()`; `localAi.setup` → `ensureLocalAiSetupOpts(args[0])`, then `ensureRuntime()` → `ensureModel(onProgress→send onProgress event)` → `autoConfigure()` → return fresh status; `localAi.start`→`ensureRuntime`; `localAi.stop`→`localAi.stop()`. The online download is reached only via `mode:'online'` (explicit user consent in the wizard). Note: `localAi.*` are NOT vault-gate-exempt — they require an unlocked vault when login is enabled (case data isn't touched, but the gate default is correct here).
- [ ] **Step 4: Run.** PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(local-ai): IPC handlers (consent-gated online fetch, loopback)"`

### Task 2.4: Preload bridge + store slice

**Files:** Modify `src/preload/index.ts`, `src/preload/api.d.ts`, `src/renderer/state/store.ts`

- [ ] **Step 1:** Add the `localAi` bridge to `preload/index.ts` (mirror the `auth` bridge: invoke wrappers + an `onProgress` subscription returning an unsubscribe fn) and type `GhostApi.localAi` in `api.d.ts`.
- [ ] **Step 2:** Add a `useLocalAi` slice to `store.ts`: `{ status: LocalAiStatus | null; progress: ProgressPayload | null; refresh(); setup(mode); }`.
- [ ] **Step 3: Commit.** `git commit -am "feat(local-ai): preload bridge + renderer store slice"`

### Task 2.5: The wizard pane

**Files:** Create `src/renderer/modules/settings/LocalAiPane.tsx`; Modify `src/renderer/modules/settings/SettingsModule.tsx`

- [ ] **Step 1:** Create `LocalAiPane.tsx` rendering by `status.state`:
  - `using-existing` → "Using the Ollama already on this machine." + a "Use it" button → `setup('online')` (no download needed since runtime is up; ensureModel may still pull if model absent — show consent then).
  - `bundled-ready` → auto-call `setup('bundled')` once on mount; show "Enabling local AI…" then "Ready."
  - `not-present` (online) → a panel: estimated size, **explicit "Download & enable (uses the internet once)"** button, a free-space note, the "Built with Llama" attribution + a link to the bundled license; on click → `setup('online')`; render a progress bar from `progress`.
  - `error` → the message + a Retry button.
- [ ] **Step 2:** Mount `<LocalAiPane/>` inside the existing AI section of `SettingsModule.tsx`, above the manual provider/endpoint fields (which remain for power users).
- [ ] **Step 3:** Manual check under `pnpm dev`: the pane renders each state (force via devtools by stubbing `window.api.localAi.status`).
- [ ] **Step 4: Commit.** `git commit -am "feat(local-ai): Settings 'Set up local AI' wizard pane"`

---

## Phase 3 — Bundled build flavor + licenses

### Task 3.1: Redistribution license assets

**Files:** Create `resources/licenses/*.txt`

- [ ] **Step 1:** Place the verbatim **Llama 3.1 Community License** text, the **Acceptable Use Policy** text, and **Ollama's MIT license** under `resources/licenses/`. Verify each against its primary source (do not transcribe from memory).
- [ ] **Step 2:** Surface attribution: add a "Built with Llama. Llama 3.1 is licensed under the Llama 3.1 Community License, © Meta Platforms, Inc." line to the AI/About pane (small change to `SettingsModule.tsx` AboutPane) + link to the bundled license file.
- [ ] **Step 3: Commit.** `git commit -am "docs(local-ai): bundle Llama 3.1 + Ollama licenses and attribution"`

### Task 3.2: electron-builder bundled flavor (env-gated)

**Files:** Modify `package.json` (build config)

- [ ] **Step 1:** Add an env-gated `extraResources` entry so ONLY the bundled build carries the payload. Use a build-time env var `GA98_BUNDLE_AI=1`; in CI the bundle job sets it and stages `release-staging/local-ai/` (runtime binary + imported model blobs + `MODEL_PRESENT` marker + `Modelfile`), mapped to `resources/local-ai/`. The normal/online installer (no env) stays lean. Document the two `package.json` scripts: `package:win` (lean, today) and a CI-only assembly path. (electron-builder reads `extraResources` from config; the env gating is done by selecting a separate config file `electron-builder.bundle.yml` passed via `--config` in CI, to avoid conditional JSON.)
- [ ] **Step 2:** Create `electron-builder.bundle.yml` extending the base build with `extraResources: [{ from: release-staging/local-ai, to: local-ai }]` and bundled artifact names (`GhostAccess98-AI-Setup-${version}-...`).
- [ ] **Step 3: Commit.** `git commit -am "build(local-ai): env-gated bundled flavor (extraResources runtime+model)"`

---

## Phase 4 — CI bundle workflow

### Task 4.1: `bundle.yml` matrix workflow

**Files:** Create `.github/workflows/bundle.yml`

- [ ] **Step 1:** Author the workflow (matrix `win-x64`, `linux-x64`, `macos-x64`, `macos-arm64`) using the pins from `ci/pins.json` and the disk-pruning + import steps validated in Tasks 0.1–0.3. Per job: checkout → free disk → setup node/pnpm → `pnpm install` → `pnpm build` → download+verify Ollama → download+verify GGUF → import model into `release-staging/local-ai/models` (Task 0.2 mechanism) → copy runtime binary + `MODEL_PRESENT` + Modelfile into `release-staging/local-ai/` → `GA98_BUNDLE_AI=1 electron-builder --config electron-builder.bundle.yml --<platform>` → `sha256sum` the installer → `gh release upload v${version} <installer> <sha256>`.
- [ ] **Step 2:** Trigger on `workflow_dispatch` (manual) — NOT auto on tag, so a release is never published without the operator (publish remains operator-gated; the workflow only uploads assets to an existing release the operator created).
- [ ] **Step 3:** Dry-run one platform via `gh workflow run bundle.yml -f platform=win-x64` against a test pre-release; confirm the asset uploads and its sha256 matches.
- [ ] **Step 4: Commit.** `git add .github/workflows/bundle.yml && git commit -m "ci(local-ai): bundled mega-installer matrix workflow"`

---

## Phase 5 — Verification

### Task 5.1: Red-team + headless suite green

**Files:** `test/local-ai-redteam.test.ts` (extend)

- [ ] **Step 1:** Add assertions: `ensureRuntime` env always pins `OLLAMA_HOST=127.0.0.1:11434` (never `0.0.0.0`); `autoConfigure` non-clobber (already in 1.6); `stop()` never kills a reused runtime (already in 1.7); a `mode`-less / unknown-mode setup is rejected.
- [ ] **Step 2:** Run the full suite: `pnpm typecheck && pnpm test` → all green (existing 75 + new). Run the headless xvfb boot smoke (per the project's existing method) to confirm `will-quit`→`localAi.stop()` wiring doesn't crash boot.
- [ ] **Step 3: Commit.** `git commit -am "test(local-ai): red-team + suite green"`

### Task 5.2: Manual air-gap acceptance (operator, Windows)

- [ ] **Step 1:** Operator installs the bundled mega-installer on Windows **with networking disabled**, opens the AI Assistant, and confirms `llama3.1` answers a prompt with zero network. Confirm no `0.0.0.0` listener (`netstat`), and that closing the app leaves no orphan `ollama` process (managed-child path) — or, if a pre-existing Ollama was present, that we reused it and did NOT kill it.
- [ ] **Step 2:** Operator installs the online variant on a networked machine, runs the wizard, confirms the consent prompt + progress + a working model afterward.
- [ ] **Step 3:** Record results; file follow-ups for any platform-specific issues.

---

## Self-review

**Spec coverage:** dual track (Phases 3–4 bundled + Phases 1–2 online) ✓; Llama-3.1-8B (0.1/0.2, 3.1) ✓; Win/Linux/mac×arch (4.1 matrix) ✓; hybrid runtime (1.4/1.7) ✓; loopback-only (1.1/2.3/5.1) ✓; integrity-verified fetch (2.1) ✓; non-clobber autoconfig (1.6) ✓; licensing (3.1) ✓; CI on stock runners (0.3/4.1) ✓; manual air-gap test (5.2) ✓. Online model menu correctly absent (out of scope).

**Placeholders:** the Phase 0 spikes intentionally produce the pins/commands later phases consume; their deliverables are concrete (URLs, hashes, a working offline `ollama create`, runner disk headroom) — not "TODO". No code step lacks code.

**Type consistency:** `LocalAiStatus`/`LocalAiState` (1.1) used uniformly; `detect/isBundled/ensureRuntime/ensureModel/autoConfigure/stop` names stable across tasks and the IPC layer; `LOCAL_AI_ENDPOINT`/`LOCAL_AI_MODEL` constants single-sourced in `local-ai-paths.ts`.

**Open dependency:** Phases 1–3 can land and ship the **online** track independently; Phase 4 (and thus the bundled track) depends on Phase 0 spikes succeeding. If 0.3 fails on stock runners, stop before Phase 4.
