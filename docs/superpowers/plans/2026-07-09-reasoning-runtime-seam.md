# Reasoning-Runtime Seam (Plan A, core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the core-side seam that lets the OSINT investigator plugin supply the autonomous-run "Brain": a `reasoning-runtime`-gated `ctx.registerBrain()` (so `getBrain()` returns it), plus `ctx.reasoning.{generate,ensureModel,verify}` over core's existing bundled reasoning runtime + trust root.

**Architecture:** Reuses what core already has — the reasoning runtime scaffold (`src/main/services/reasoning/reasoning-runtime.ts`, port 11440), the PQ-hybrid verifier (`verify.ts` + `trust.ts`), and the capability-gating pattern (`context.ts`/`wire-deps.ts`, exactly like `background-tasks`/`vector-recall`). It adds a text-generation call to the runtime, a brain registry, and the gated context surface. No shipped-app functional change — no core plugin declares `reasoning-runtime`, so `getBrain()` still returns `null` until the plugin is installed.

**Tech Stack:** Electron 33 + TypeScript, the bundled CPU-Ollama runtime, vitest.

## Global Constraints

- **No new dependency; no new network egress.** Inference is loopback-only to the bundled Ollama reasoning runtime (127.0.0.1:11440). Verification reuses `verifyPluginSignature` (Ed25519 ∥ ML-DSA-65).
- **No shipped-app functional change.** No core plugin holds `reasoning-runtime`; `getBrain()` returns `null` until the plugin registers a brain. The only visible change is the `RunPanel` unavailable-card copy.
- **Single trust root.** Entitlement verification lives here (core owns `trust.ts` pins); the plugin never bundles crypto/keys.
- **Determinism.** The brain registry is a plain holder; `ctx.reasoning.generate` is the only non-deterministic surface and is fully test-injectable.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage the known-dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`).
- **Branch:** `feat/reasoning-runtime-seam`. Implementers commit ONLY on this branch — never touch main/other branches; the controller merges.
- **Commands:** `pnpm test`, `pnpm typecheck`.

## File Structure

**New:** `src/main/investigation/brain-registry.ts`, `test/brain-registry.test.ts`, `test/reasoning-generate.test.ts`, `test/reasoning-capability.test.ts`.
**Modified:** `src/main/services/reasoning/reasoning-runtime.ts` (+`reasoningGenerate`), `src/main/plugins/context.ts` (`ContextDeps`+`PluginContext`+gate), `src/main/plugins/wire-deps.ts` (supply deps), `src/main/ipc/register.ts` (`getBrain` wiring), `src/main/plugins/loader.ts` + `src/main/index.ts` (teardown clears the brain), `src/renderer/modules/investigation-graph/RunPanel.tsx` (card copy), and the CAPABILITIES snapshot test if one asserts the gated surface.

**Sequencing:** T1 (generate) → T2 (brain registry + registerBrain + getBrain) → T3 (ctx.reasoning gate) → T4 (RunPanel copy). Each leaves the build + suite green.

---

### Task 1: `reasoningGenerate` on the reasoning runtime

**Files:** Modify `src/main/services/reasoning/reasoning-runtime.ts`; Test: `test/reasoning-generate.test.ts`.

**Interfaces:**
- Consumes: existing `reasoningEndpoint()`, `ensureReasoningRuntime()`.
- Produces: `reasoningGenerate(prompt: string, opts?: { maxTokens?: number; stop?: string[] }): Promise<string>`; `__setGenerateFetchForTest(fn: ((url: string, init: unknown) => Promise<{ ok: boolean; json(): Promise<unknown> }>) | null): void`.

- [ ] **Step 1: Write the failing test** `test/reasoning-generate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { reasoningGenerate, configureReasoningRuntime, __setExistsForTest, __setProbeForTest, __setGenerateFetchForTest, __resetReasoningRuntimeForTest, ensureReasoningRuntime } from '../src/main/services/reasoning/reasoning-runtime';

describe('reasoningGenerate', () => {
  beforeEach(() => { __resetReasoningRuntimeForTest(); });
  it('POSTs the prompt to /api/generate on the resolved endpoint and returns the response text', async () => {
    configureReasoningRuntime({ modelsDir: '/tmp/models', model: 'reason' });
    __setExistsForTest(async () => true);
    __setProbeForTest(async () => true);   // runtime resolves immediately
    let seenUrl = ''; let seenBody: any = null;
    __setGenerateFetchForTest(async (url, init: any) => { seenUrl = url; seenBody = JSON.parse(init.body); return { ok: true, json: async () => ({ response: 'run-transform crypto-btc-txs' }) }; });
    await ensureReasoningRuntime();
    const out = await reasoningGenerate('decide', { maxTokens: 128, stop: ['\n\n'] });
    expect(seenUrl).toMatch(/\/api\/generate$/);
    expect(seenBody).toMatchObject({ model: 'reason', prompt: 'decide', stream: false });
    expect(out).toBe('run-transform crypto-btc-txs');
  });
  it('throws a clear error when the runtime is not resolved', async () => {
    __resetReasoningRuntimeForTest();
    await expect(reasoningGenerate('x')).rejects.toThrow(/reasoning runtime not available/i);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test reasoning-generate`.

- [ ] **Step 3: Implement.** In `reasoning-runtime.ts`, add a test-injectable fetch + the generate fn:

```ts
let genFetchFn: (url: string, init: unknown) => Promise<{ ok: boolean; json(): Promise<unknown> }> =
  (url, init) => fetch(url, init as RequestInit) as unknown as Promise<{ ok: boolean; json(): Promise<unknown> }>;
export function __setGenerateFetchForTest(fn: ((url: string, init: unknown) => Promise<{ ok: boolean; json(): Promise<unknown> }>) | null): void {
  genFetchFn = fn ?? ((url, init) => fetch(url, init as RequestInit) as unknown as Promise<{ ok: boolean; json(): Promise<unknown> }>);
}

/** One-shot local generation on the bundled reasoning runtime (loopback only). Requires the runtime
 *  to be resolved (ensureReasoningRuntime succeeded); throws otherwise so callers fall back cleanly. */
export async function reasoningGenerate(prompt: string, opts?: { maxTokens?: number; stop?: string[] }): Promise<string> {
  const endpoint = reasoningEndpoint();
  if (!endpoint || !config) throw new Error('reasoning runtime not available');
  const body = JSON.stringify({
    model: config.model, prompt, stream: false,
    options: { num_predict: opts?.maxTokens ?? 256, ...(opts?.stop ? { stop: opts.stop } : {}) },
  });
  const r = await genFetchFn(`${endpoint}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (!r.ok) throw new Error('reasoning generate failed');
  const j = (await r.json()) as { response?: string };
  return j.response ?? '';
}
```

  Also add `genFetchFn` reset to `__resetReasoningRuntimeForTest()` (set it back to the real fetch).

- [ ] **Step 4: Run → PASS** — `pnpm test reasoning-generate && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(reasoning): reasoningGenerate() one-shot local inference on the runtime`.

---

### Task 2: Brain registry + `ctx.registerBrain` + `getBrain` wiring

**Files:** Create `src/main/investigation/brain-registry.ts`; Modify `src/main/plugins/context.ts`, `src/main/plugins/wire-deps.ts`, `src/main/ipc/register.ts`, `src/main/plugins/loader.ts`, `src/main/index.ts`; Test: `test/brain-registry.test.ts`, extend `test/plugin-context.test.ts`.

**Interfaces:**
- Consumes: `Brain` from `../../shared/investigation-agent`.
- Produces: `setRegisteredBrain(pluginId: string, b: Brain): void`, `getRegisteredBrain(): Brain | null`, `clearRegisteredBrain(pluginId: string): void`, `clearAllBrains(): void`, `_resetBrainsForTest(): void`. `ContextDeps.registerBrain?: (pluginId: string, b: Brain) => void`; `PluginContext.registerBrain?: (b: Brain) => void`.

- [ ] **Step 1: Write the failing test** `test/brain-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setRegisteredBrain, getRegisteredBrain, clearRegisteredBrain, clearAllBrains, _resetBrainsForTest } from '../src/main/investigation/brain-registry';
import type { Brain } from '../src/shared/investigation-agent';

const brain: Brain = { decide: async () => ({ kind: 'done', reason: 'x' }) };

describe('brain registry', () => {
  beforeEach(() => _resetBrainsForTest());
  it('returns null with no brain, the last registered brain otherwise', () => {
    expect(getRegisteredBrain()).toBeNull();
    setRegisteredBrain('osint', brain);
    expect(getRegisteredBrain()).toBe(brain);
  });
  it('clearRegisteredBrain(id) removes that plugin\'s brain', () => {
    setRegisteredBrain('osint', brain);
    clearRegisteredBrain('osint');
    expect(getRegisteredBrain()).toBeNull();
  });
  it('clearAllBrains wipes everything', () => {
    setRegisteredBrain('osint', brain); clearAllBrains();
    expect(getRegisteredBrain()).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test brain-registry`.

- [ ] **Step 3: Implement.**
  - `src/main/investigation/brain-registry.ts`:
```ts
/** Holds the autonomous-run Brain supplied by a `reasoning-runtime` plugin. Core's getBrain() returns
 *  the registered brain, so installing the OSINT plugin flips run.available() true. Keyed by plugin id
 *  so teardown clears it (mirrors the schedule registry). Last-registered wins (only one brain runs). */
import type { Brain } from '../../shared/investigation-agent';
const brains = new Map<string, Brain>();
export function setRegisteredBrain(pluginId: string, b: Brain): void { brains.set(pluginId, b); }
export function getRegisteredBrain(): Brain | null {
  let last: Brain | null = null;
  for (const b of brains.values()) last = b;
  return last;
}
export function clearRegisteredBrain(pluginId: string): void { brains.delete(pluginId); }
export function clearAllBrains(): void { brains.clear(); }
export function _resetBrainsForTest(): void { brains.clear(); }
```
  - `context.ts`: add to `ContextDeps` `registerBrain?: (pluginId: string, b: import('../../shared/investigation-agent').Brain) => void;` and to `PluginContext` `registerBrain?: (b: import('../../shared/investigation-agent').Brain) => void;`. In `createPluginContext`, after the `background-tasks` gate: `if (has('reasoning-runtime') && deps.registerBrain) { ctx.registerBrain = (b) => deps.registerBrain!(id, b); }`.
  - `wire-deps.ts`: `import { setRegisteredBrain } from '../investigation/brain-registry';` and add to the returned deps object: `registerBrain: (pluginId, b) => setRegisteredBrain(pluginId, b),`.
  - `register.ts:1522`: change `getBrain: (): Brain | null => null` to `getBrain: (): Brain | null => getRegisteredBrain()` and add `import { getRegisteredBrain } from '../investigation/brain-registry';`.
  - `loader.ts` `disablePlugin(pluginId)`: add `clearRegisteredBrain(pluginId);` (import it) next to `disposePluginSchedules(pluginId);`.
  - `index.ts` will-quit: add `clearAllBrains()` to the backstop list (import it).

- [ ] **Step 4: Extend `test/plugin-context.test.ts`** — a context WITHOUT `reasoning-runtime` has `ctx.registerBrain === undefined`; WITH it + a `deps.registerBrain` spy, `ctx.registerBrain(brain)` calls `deps.registerBrain('<id>', brain)`.

- [ ] **Step 5: Run tests + typecheck** → PASS/clean.
- [ ] **Step 6: Commit** — `feat(reasoning): ctx.registerBrain + brain registry; getBrain returns the registered brain`.

---

### Task 3: `ctx.reasoning` (generate / ensureModel / verify)

**Files:** Modify `src/main/plugins/context.ts`, `src/main/plugins/wire-deps.ts`; Test: `test/reasoning-capability.test.ts`.

**Interfaces:**
- Consumes: `reasoningGenerate` (T1); `configureReasoningRuntime`/`ensureReasoningRuntime` (existing); `verifyPluginSignature` (`../plugins/verify`); `getPinnedKeysets` (`../plugins/trust`).
- Produces: `ContextDeps.reasoning?` and `PluginContext.reasoning?` with `generate(prompt, opts?)`, `ensureModel(blobPath, name)`, `verify(payload, signature): boolean`.

- [ ] **Step 1: Write the failing test** `test/reasoning-capability.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPluginContext } from '../src/main/plugins/context';
import type { ContextDeps } from '../src/main/plugins/context';

function deps(over: Partial<ContextDeps>): ContextDeps {
  return { isNetworkEnabled: () => false, rawFetch: async () => ({ status: 0, body: '', finalUrl: '' }), validateUrl: (u) => u,
    secretBackend: { get: async () => null, set: async () => {}, delete: async () => {} }, entities: {},
    timelineAppend: async () => {}, caseSidecar: { read: async () => null, write: async () => {} },
    pluginStore: { read: async () => null, write: async () => {}, list: async () => [], delete: async () => {} }, ...over } as ContextDeps;
}

describe('ctx.reasoning gate', () => {
  it('absent without the reasoning-runtime capability', () => {
    const ctx = createPluginContext('p', [], deps({ reasoning: { generate: vi.fn(), ensureModel: vi.fn(), verify: vi.fn() } as any }));
    expect(ctx.reasoning).toBeUndefined();
  });
  it('present with the capability; verify delegates to deps', () => {
    const verify = vi.fn(() => true);
    const ctx = createPluginContext('p', ['reasoning-runtime'], deps({ reasoning: { generate: vi.fn(), ensureModel: vi.fn(), verify } as any }));
    expect(ctx.reasoning).toBeTruthy();
    expect(ctx.reasoning!.verify(new Uint8Array([1]), new Uint8Array([2]))).toBe(true);
    expect(verify).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test reasoning-capability`.

- [ ] **Step 3: Implement.**
  - `context.ts`: define
```ts
export interface ReasoningApi {
  generate(prompt: string, opts?: { maxTokens?: number; stop?: string[] }): Promise<string>;
  ensureModel(blobPath: string, name: string): Promise<void>;
  verify(payload: Uint8Array, signature: Uint8Array): boolean;
}
```
    add `reasoning?: ReasoningApi;` to both `ContextDeps` and `PluginContext`. Gate (after registerBrain): `if (has('reasoning-runtime') && deps.reasoning) { ctx.reasoning = deps.reasoning; }`.
  - `wire-deps.ts`: build the impl and add `reasoning: { … }` to the returned deps:
```ts
import { reasoningGenerate, configureReasoningRuntime, ensureReasoningRuntime } from '../services/reasoning/reasoning-runtime';
import { verifyPluginSignature } from './verify';
import { getPinnedKeysets } from './trust';
import { copyFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
// …in the returned object:
reasoning: {
  generate: (prompt, opts) => reasoningGenerate(prompt, opts),
  async ensureModel(blobPath, name) {
    // Copy the plugin-delivered GGUF into the reasoning models dir, then configure + start the runtime.
    const modelsDir = join(app.getPath('userData'), 'local-ai', 'reasoning-models');
    await mkdir(modelsDir, { recursive: true });
    await copyFile(blobPath, join(modelsDir, `${name}.gguf`));
    configureReasoningRuntime({ modelsDir, model: name });
    await ensureReasoningRuntime();
  },
  verify: (payload, signature) => verifyPluginSignature(payload, signature, getPinnedKeysets()),
},
```
    (`app` is already imported in wire-deps for the plugin-store paths.)

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(reasoning): ctx.reasoning (generate/ensureModel/verify) gated by reasoning-runtime`.

---

### Task 4: RunPanel unavailable-card copy

**Files:** Modify `src/renderer/modules/investigation-graph/RunPanel.tsx`; Test: `test/run-panel-copy.test.tsx` (or extend an existing RunPanel test).

- [ ] **Step 1: Failing test** — assert the unavailable card names the plugin + upgrade:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunPanel } from '../src/renderer/modules/investigation-graph/RunPanel';
// (mirror the existing RunPanel test harness for store setup with available === false)
it('unavailable card points at the OSINT plugin + AI upgrade', () => {
  // render RunPanel with an entry whose available === false
  expect(screen.getByText(/OSINT investigator plugin/i)).toBeTruthy();
  expect(screen.getByText(/AI reasoning is an upgrade/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test run-panel-copy`.

- [ ] **Step 3: Implement.** In `RunPanel.tsx` `UnavailableCard`, reword the `<h4>`/`<p>` to: title "Autonomous runs need the OSINT investigator plugin"; body "Install the OSINT investigator plugin to fan out across transforms and grow the graph on its own. **AI reasoning is an upgrade** — without it, runs use a fast built-in heuristic."

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(investigation): reword the reasoning-pack card (plugin + AI upgrade)`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`. Confirm no shipped-app functional change (`getBrain()` still `null` with no plugin; run.available() false).
- [ ] Whole-branch adversarial review (focus: `getBrain` wiring can't return a stale brain after teardown; `ctx.reasoning.verify` genuinely uses pinned keys; `ensureModel` writes only inside userData; loopback-only generate).
- [ ] Merge `feat/reasoning-runtime-seam` → main (`--no-ff`); this unblocks Plan B (the plugin brains).

## Self-Review

- **Spec coverage:** registerBrain+getBrain (T2) ✓; ctx.reasoning.generate (T1/T3) ✓; ensureModel (T3) ✓; verify/single-trust-root (T3) ✓; card copy (T4) ✓; teardown clears brain (T2) ✓; no shipped-app change ✓.
- **Placeholder scan:** none — pure units carry full code; T4's copy is the exact strings.
- **Type consistency:** `Brain` from `shared/investigation-agent` used identically; `ReasoningApi` shape stable across `ContextDeps`/`PluginContext`/wire-deps; registry fn names stable T2→loader/index.
- **Charter:** loopback-only inference; single trust root (verify uses pinned keys); no new dep; persona identity.
