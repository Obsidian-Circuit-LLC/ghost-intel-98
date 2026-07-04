# SP-1 + SP-2: Reasoning Runtime + Transform/Provenance Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two foundational sub-projects of the Autonomous OSINT Investigator — the model-agnostic bundled **reasoning-runtime mechanism** (SP-1) and the **transform contract + registry + provenance ledger + deterministic confidence scorer** (SP-2) — as core substrate in `/dcs98`, so the private OSINT plugin (subsystem 2) can later build transforms and the orchestrator on top.

**Architecture:** SP-1 mirrors the existing `embed-runtime.ts` pattern but is *model-agnostic* — core spawns a bundled Ollama on its own loopback port pointed at a caller-supplied models directory + model name (the plugin supplies the model per the packaging boundary). SP-2 adds a shared `investigation-types.ts` contract, an in-memory transform **registry**, an append-only encrypted-at-rest **ledger** (evidence/finding/run) built on `secure-fs` + `withLock`, a pure deterministic **confidence scorer**, and a **runner** that invokes a registered transform, merges produced entities into the existing cross-case entity store, and writes evidence — all provable end-to-end with a *stub* transform (no agent, no real OSINT tools yet).

**Tech Stack:** TypeScript, Node, Electron main process, Vitest. Reuses `src/main/services/local-ai-paths.ts`, `src/main/storage/entities.ts`, `src/main/storage/secure-fs.ts`, `src/main/util/mutex.ts`, `src/main/storage/paths.ts`, and the `embed-runtime.ts` test seam idiom.

## Global Constraints

- **Charter — no telemetry, no phone-home.** SP-1/SP-2 add **no network egress**: the reasoning runtime is a loopback Ollama (127.0.0.1); the ledger is local encrypted storage.
- **Determinism in critical paths.** The confidence scorer and the ledger/merge logic MUST be deterministic: no `Math.random()`, no `Date.now()`/`new Date()` inside scoring or persistence — **timestamps are passed in by the caller** (`now: string`). (Runtime *spawn timing* in SP-1 may use `Date.now()` for its readiness deadline, mirroring `embed-runtime.ts`; that is not a correctness path.)
- **Encrypted at rest.** All ledger data (evidence/findings/runs + raw tool-output blobs) is written via `secureWriteFile` / read via `secureReadText`, under `caseDir(caseId)/investigation/`.
- **Reuse, don't reinvent.** SP-1 mirrors `embed-runtime.ts` (ports, `spawnOnPort`, `__set*ForTest` seams, honest health verifying the model is loaded via `/api/tags`). SP-2 mirrors `entities.ts` (secure-fs + `withLock`) for persistence.
- **Boundary.** Everything here is **core** (`src/main`, `src/shared`) — substrate + shared contract. Do NOT implement any real OSINT transform or the orchestrator here; those are subsystem-2.
- **Commit identity:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; NEVER emit `Co-Authored-By` / `Signed-off-by` / `Claude-Session` / any AI-identity trailer. Stage only files each task touches; never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, or `docs/superpowers/ideation/`.
- **TDD.** Each task: failing test → verify fail → minimal impl → verify pass → commit. `pnpm test <file>` for one suite; `pnpm typecheck` must stay clean (both configs).

## File Structure

- `src/main/services/reasoning/reasoning-runtime.ts` *(NEW, SP-1)* — model-agnostic bundled reasoning runtime mechanism.
- `src/shared/plugin-types.ts` *(MODIFY, SP-1+SP-2)* — add `reasoning-runtime` and `investigation` capabilities to the frozen capability union.
- `src/shared/investigation-types.ts` *(NEW, SP-2)* — the shared contract: confidence/signal/attribution, transform descriptor + I/O, evidence/finding/run.
- `src/shared/types.ts` *(MODIFY, SP-2)* — extend `EntityType` + `ENTITY_TYPES` with OSINT types (additive).
- `src/main/investigation/confidence.ts` *(NEW, SP-2)* — pure deterministic scorer.
- `src/main/investigation/ledger.ts` *(NEW, SP-2)* — append-only encrypted evidence/finding/run store.
- `src/main/investigation/registry.ts` *(NEW, SP-2)* — in-memory transform registry.
- `src/main/investigation/runner.ts` *(NEW, SP-2)* — invoke a registered transform → merge entities + write evidence + score.
- Tests: `test/reasoning-runtime.test.ts`, `test/investigation-confidence.test.ts`, `test/investigation-ledger.test.ts`, `test/investigation-registry.test.ts`, `test/investigation-runner.test.ts` *(all NEW)*.

---

### Task 1: Reasoning-runtime mechanism (SP-1)

**Files:**
- Create: `src/main/services/reasoning/reasoning-runtime.ts`
- Modify: `src/shared/plugin-types.ts` (add `'reasoning-runtime'` to the capability union + list)
- Test: `test/reasoning-runtime.test.ts`

**Interfaces:**
- Consumes: `bundledRoot()` from `src/main/services/local-ai-paths.ts`.
- Produces: `configureReasoningRuntime(cfg | null)`, `reasoningAvailable(): Promise<boolean>`, `ensureReasoningRuntime(): Promise<void>`, `reasoningEndpoint(): string | null`, `reasoningHealth(): Promise<ReasoningHealth>` where `ReasoningHealth = 'unconfigured'|'starting'|'unavailable'|'model-missing'|'ready'`; test seams `__setSpawnForTest`, `__setProbeForTest`, `__setTagsForTest`, `__setExistsForTest`, `__resetReasoningRuntimeForTest`.

- [ ] **Step 1: Write the failing test.** Create `test/reasoning-runtime.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureReasoningRuntime, ensureReasoningRuntime, reasoningEndpoint, reasoningHealth, reasoningAvailable,
  __setSpawnForTest, __setProbeForTest, __setTagsForTest, __setExistsForTest, __resetReasoningRuntimeForTest
} from '../src/main/services/reasoning/reasoning-runtime';

function fakeChild() {
  const h: Record<string, (() => void)[]> = {};
  return { on(ev: string, cb: () => void) { (h[ev] ||= []).push(cb); }, kill() {}, pid: 1, __fire(ev: string) { (h[ev] || []).forEach((f) => f()); } };
}
beforeEach(() => __resetReasoningRuntimeForTest());

describe('reasoning runtime (model-agnostic mechanism)', () => {
  it('is unconfigured/unavailable until a model dir is configured', async () => {
    expect(await reasoningHealth()).toBe('unconfigured');
    expect(await reasoningAvailable()).toBe(false);
  });

  it('configured + bundle present: spawns on the dedicated port and reports ready', async () => {
    configureReasoningRuntime({ modelsDir: join(tmpdir(), 'rt-models'), model: 'qwen2.5-14b' });
    __setExistsForTest(async () => true); // ollama binary + models dir exist
    let env: NodeJS.ProcessEnv | undefined;
    __setSpawnForTest((_b, _a, opts) => { env = opts.env; return fakeChild(); });
    __setProbeForTest(async () => true);
    __setTagsForTest(async () => ['qwen2.5-14b:latest']);
    await ensureReasoningRuntime();
    expect(env?.OLLAMA_HOST).toContain('11440');
    expect(env?.OLLAMA_MODELS).toContain('rt-models');
    expect(reasoningEndpoint()).toContain('11440');
    expect(await reasoningHealth()).toBe('ready');
  });

  it('server up but model absent → model-missing (honest health)', async () => {
    configureReasoningRuntime({ modelsDir: join(tmpdir(), 'rt-models'), model: 'qwen2.5-14b' });
    __setExistsForTest(async () => true);
    __setSpawnForTest(() => fakeChild());
    __setProbeForTest(async () => true);
    __setTagsForTest(async () => ['llama3.1:latest']); // not the reasoning model
    await ensureReasoningRuntime();
    expect(await reasoningHealth()).toBe('model-missing');
  });

  it('configured but bundle/model dir missing → unavailable, does not spawn', async () => {
    configureReasoningRuntime({ modelsDir: '/nope', model: 'qwen2.5-14b' });
    __setExistsForTest(async () => false);
    let spawned = false;
    __setSpawnForTest(() => { spawned = true; return fakeChild(); });
    await expect(ensureReasoningRuntime()).rejects.toThrow(/unavailable/i);
    expect(spawned).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test reasoning-runtime` → FAIL (module not found).

- [ ] **Step 3: Implement `src/main/services/reasoning/reasoning-runtime.ts`:**

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { bundledRoot } from '../local-ai-paths';

export type ReasoningHealth = 'unconfigured' | 'starting' | 'unavailable' | 'model-missing' | 'ready';
export const REASONING_HOST = '127.0.0.1';
export const REASONING_PORT_BASE = 11440;
const REASONING_PORT_MAX_STEPS = 5; // 11440..11444

type SpawnLike = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio?: unknown }) => { on: (...a: unknown[]) => void; kill: () => void; pid?: number };
let spawnFn: SpawnLike = nodeSpawn as unknown as SpawnLike;
let probeFn: (url: string) => Promise<boolean> = defaultProbe;
let tagsFn: (url: string) => Promise<string[] | null> = defaultTags;
let existsFn: (p: string) => Promise<boolean> = defaultExists;

let config: { modelsDir: string; model: string } | null = null;
let resolvedEndpoint: string | null = null;
let starting = false;

export function configureReasoningRuntime(cfg: { modelsDir: string; model: string } | null): void { config = cfg; resolvedEndpoint = null; }
export function __setSpawnForTest(fn: SpawnLike | null): void { spawnFn = fn ?? (nodeSpawn as unknown as SpawnLike); }
export function __setProbeForTest(fn: ((u: string) => Promise<boolean>) | null): void { probeFn = fn ?? defaultProbe; }
export function __setTagsForTest(fn: ((u: string) => Promise<string[] | null>) | null): void { tagsFn = fn ?? defaultTags; }
export function __setExistsForTest(fn: ((p: string) => Promise<boolean>) | null): void { existsFn = fn ?? defaultExists; }
export function __resetReasoningRuntimeForTest(): void {
  spawnFn = nodeSpawn as unknown as SpawnLike; probeFn = defaultProbe; tagsFn = defaultTags; existsFn = defaultExists;
  config = null; resolvedEndpoint = null; starting = false;
}

async function defaultExists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }
async function defaultProbe(url: string): Promise<boolean> { try { const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }
async function defaultTags(url: string): Promise<string[] | null> {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const b = (await r.json()) as { models?: { name?: string }[] };
    return Array.isArray(b.models) ? b.models.map((m) => m.name ?? '') : null;
  } catch { return null; }
}
function binName(): string { return process.platform === 'win32' ? 'ollama.exe' : 'ollama'; }

/** True when the runtime CAN start: bundled ollama binary present AND the configured models dir exists. */
export async function reasoningAvailable(): Promise<boolean> {
  if (!config) return false;
  const bin = await existsFn(join(bundledRoot(), binName()));
  const dir = await existsFn(config.modelsDir);
  return bin && dir;
}
export function reasoningEndpoint(): string | null { return resolvedEndpoint; }

async function spawnOnPort(port: number): Promise<boolean> {
  if (!config) return false;
  const endpoint = `http://${REASONING_HOST}:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: `${REASONING_HOST}:${port}`, OLLAMA_MODELS: config.modelsDir, OLLAMA_NO_ANALYTICS: '1' };
  starting = true;
  const c = spawnFn(join(bundledRoot(), binName()), ['serve'], { env, stdio: 'ignore' });
  let earlyExit = false;
  c.on('exit', () => { earlyExit = true; });
  c.on('error', () => { earlyExit = true; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (earlyExit) { starting = false; return false; }
    if (await probeFn(endpoint)) { resolvedEndpoint = endpoint; starting = false; return true; }
    await new Promise((r) => setTimeout(r, 500));
  }
  starting = false; return false;
}

export async function ensureReasoningRuntime(): Promise<void> {
  if (resolvedEndpoint && (await probeFn(resolvedEndpoint))) return;
  if (!(await reasoningAvailable())) throw new Error('Reasoning runtime unavailable (model not configured or not present).');
  for (let step = 0; step < REASONING_PORT_MAX_STEPS; step++) {
    if (await spawnOnPort(REASONING_PORT_BASE + step)) return;
  }
  throw new Error('Reasoning runtime could not start (is a port in 11440–11444 free?).');
}

export async function reasoningHealth(): Promise<ReasoningHealth> {
  if (!config) return 'unconfigured';
  if (starting) return 'starting';
  if (!resolvedEndpoint) return 'unavailable';
  const tags = await tagsFn(resolvedEndpoint);
  if (tags === null) return 'unavailable';
  return tags.some((n) => n.startsWith(config!.model)) ? 'ready' : 'model-missing';
}
```

- [ ] **Step 4: Add the capability.** In `src/shared/plugin-types.ts`, add `'reasoning-runtime'` to the capability union type and the capability list constant (grep the file for the existing `'vector-recall'` entry and add alongside it, same two places).

- [ ] **Step 5: Run tests + typecheck, verify pass.** `pnpm test reasoning-runtime` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 6: Commit.** `git add src/main/services/reasoning/reasoning-runtime.ts src/shared/plugin-types.ts test/reasoning-runtime.test.ts && git commit -m "feat(reasoning): model-agnostic bundled reasoning-runtime mechanism + capability"`

---

### Task 2: Deterministic confidence scorer + core contract types (SP-2)

**Files:**
- Create: `src/shared/investigation-types.ts` (confidence portion)
- Create: `src/main/investigation/confidence.ts`
- Test: `test/investigation-confidence.test.ts`

**Interfaces:**
- Produces (types): `ConfidenceBand = 'high'|'medium'|'low'`; `AttributionStatus = 'attributed'|'unattributed'|'unconfirmed'`; `EvidenceSignal { kind: string; weight: number }`; `ConfidenceResult { band: ConfidenceBand; attribution: AttributionStatus; score: number }`.
- Produces (fn): `scoreConfidence(signals: EvidenceSignal[]): ConfidenceResult` — pure, deterministic.

- [ ] **Step 1: Write the failing test.** `test/investigation-confidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '../src/main/investigation/confidence';
import type { EvidenceSignal } from '../src/shared/investigation-types';

const sig = (kind: string, weight: number): EvidenceSignal => ({ kind, weight });

describe('scoreConfidence (deterministic)', () => {
  it('authoritative + corroborating with net weight ≥3 → high / attributed', () => {
    const r = scoreConfidence([sig('authoritative-source', 2), sig('corroborating-source', 1), sig('field-complete', 1)]);
    expect(r.band).toBe('high');
    expect(r.attribution).toBe('attributed');
    expect(r.score).toBe(4);
  });
  it('a contradiction forces unconfirmed regardless of weight', () => {
    const r = scoreConfidence([sig('authoritative-source', 2), sig('corroborating-source', 2), sig('contradiction', -1)]);
    expect(r.attribution).toBe('unconfirmed');
  });
  it('single low-weight signal → low / unattributed', () => {
    const r = scoreConfidence([sig('field-complete', 0)]);
    expect(r.band).toBe('low');
    expect(r.attribution).toBe('unattributed');
  });
  it('is deterministic: identical input → identical output', () => {
    const s = [sig('authoritative-source', 2), sig('corroborating-source', 1)];
    expect(scoreConfidence(s)).toEqual(scoreConfidence(s));
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-confidence` → FAIL.

- [ ] **Step 3: Implement.** Create `src/shared/investigation-types.ts`:

```ts
// Shared contract for the Autonomous OSINT Investigator (SP-2). Core + the OSINT plugin agree on these.
export type ConfidenceBand = 'high' | 'medium' | 'low';
export type AttributionStatus = 'attributed' | 'unattributed' | 'unconfirmed';

/** A machine-readable signal derived from a transform's raw output — feeds the deterministic scorer. */
export interface EvidenceSignal { kind: string; weight: number }

export interface ConfidenceResult { band: ConfidenceBand; attribution: AttributionStatus; score: number }
```

Create `src/main/investigation/confidence.ts`:

```ts
import type { EvidenceSignal, ConfidenceResult, ConfidenceBand, AttributionStatus } from '@shared/investigation-types';

/** Deterministic: sum signed weights → band; attribution from signal KINDS. No time/RNG. Machine-derived,
 *  never taken from the model (charter: confidence must be grounded in tool output). */
export function scoreConfidence(signals: EvidenceSignal[]): ConfidenceResult {
  const score = signals.reduce((s, x) => s + x.weight, 0);
  const hasContradiction = signals.some((s) => s.kind === 'contradiction');
  const authoritative = signals.some((s) => s.kind === 'authoritative-source');
  const corroborating = signals.filter((s) => s.kind === 'corroborating-source').length;
  const band: ConfidenceBand = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
  const attribution: AttributionStatus = hasContradiction
    ? 'unconfirmed'
    : authoritative && corroborating >= 1 ? 'attributed' : 'unattributed';
  return { band, attribution, score };
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-confidence` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/shared/investigation-types.ts src/main/investigation/confidence.ts test/investigation-confidence.test.ts && git commit -m "feat(investigation): deterministic confidence scorer + confidence contract"`

---

### Task 3: Append-only provenance ledger (SP-2)

**Files:**
- Modify: `src/shared/investigation-types.ts` (add evidence/finding/run types)
- Create: `src/main/investigation/ledger.ts`
- Test: `test/investigation-ledger.test.ts`

**Interfaces:**
- Consumes: `EvidenceSignal` (Task 2), `secureReadText`/`secureWriteFile` from `src/main/storage/secure-fs`, `withLock` from `src/main/util/mutex`, `caseDir` from `src/main/storage/paths`.
- Produces (types): `TransformEdgeOut`, `EvidenceRecord`, `Finding`, `InvestigationRun`, `RunAction`, `RunBudget`.
- Produces (fns): `appendEvidence(caseId, rec, raw, now)`, `appendFinding(caseId, f, now)`, `upsertRun(caseId, run)`, `getRun(caseId, runId)`, `listEvidence(caseId, runId?)`. All timestamps are caller-supplied (`now: string`).

- [ ] **Step 1: Write the failing test.** `test/investigation-ledger.test.ts` (mock `secure-fs` + `paths` with an in-memory map so no real vault is touched — mirror how existing storage tests stub secure-fs; if the repo's `entities.test.ts` uses a tmpdir instead, follow that idiom):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-ledger-test') } }));
// Use a tmpdir-backed secure-fs passthrough if secure-fs requires a key in tests; else mock it:
vi.mock('../src/main/storage/secure-fs', () => {
  const store = new Map<string, string>();
  return {
    async secureWriteFile(p: string, d: string) { store.set(p, d); },
    async secureReadText(p: string) { if (!store.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return store.get(p)!; },
    __store: store,
  };
});

import { appendEvidence, appendFinding, upsertRun, getRun, listEvidence } from '../src/main/investigation/ledger';

const NOW = '2026-07-04T00:00:00.000Z';
beforeEach(() => { /* fresh module state via vi.resetModules not needed; store persists per-file, use unique caseIds */ });

describe('provenance ledger (append-only, encrypted-at-rest)', () => {
  it('appends evidence with a generated id + raw blob ref, and lists it back', async () => {
    const ev = await appendEvidence('caseA', {
      runId: 'run1', transformId: 'stub', transformVersion: '1', inputEntityId: 'ent-x',
      producedEntityIds: ['ent-y'], producedEdges: [], signals: [{ kind: 'authoritative-source', weight: 2 }],
    }, 'RAW OUTPUT', NOW);
    expect(ev.id).toMatch(/^ev-/);
    expect(ev.rawRef).toContain('caseA');
    expect(ev.createdAt).toBe(NOW);
    const list = await listEvidence('caseA', 'run1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(ev.id);
  });

  it('upserts and reads back a run with its action log', async () => {
    await upsertRun('caseB', {
      id: 'run1', caseId: 'caseB', seedEntityIds: ['ent-x'], objective: 'find all',
      budget: { maxPivots: 10, maxDepth: 3, maxWallClockMs: 60000, maxTokens: 100000 },
      status: 'running', actionLog: [{ seq: 1, kind: 'transform', transformId: 'stub', inputEntityId: 'ent-x', at: NOW }],
      createdAt: NOW, updatedAt: NOW,
    });
    const r = await getRun('caseB', 'run1');
    expect(r?.status).toBe('running');
    expect(r?.actionLog[0].transformId).toBe('stub');
  });

  it('is append-only: a second evidence append does not drop the first', async () => {
    await appendEvidence('caseC', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e', producedEntityIds: [], producedEdges: [], signals: [] }, 'a', NOW);
    await appendEvidence('caseC', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e', producedEntityIds: [], producedEdges: [], signals: [] }, 'b', NOW);
    expect(await listEvidence('caseC')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-ledger` → FAIL.

- [ ] **Step 3: Implement.** Append to `src/shared/investigation-types.ts`:

```ts
import type { EntityType } from './types';

/** An edge a transform asserts between two entities (resolved to ids on merge). */
export interface TransformEdgeOut {
  fromValue: string; fromType: EntityType;
  toValue: string; toType: EntityType;
  relation: string; // e.g. 'registrant-of', 'resolves-to', 'co-occurs-with'
}

export interface RunBudget { maxPivots: number; maxDepth: number; maxWallClockMs: number; maxTokens: number }

export interface RunAction {
  seq: number;
  kind: 'transform' | 'ask' | 'assert' | 'reflect' | 'done';
  transformId?: string; inputEntityId?: string; evidenceId?: string;
  at: string;
}

export interface EvidenceRecord {
  id: string;
  runId: string;
  transformId: string;
  transformVersion: string;
  inputEntityId: string;
  producedEntityIds: string[];
  producedEdges: TransformEdgeOut[];
  signals: EvidenceSignal[];
  rawRef: string;       // path to the encrypted raw-output blob
  createdAt: string;    // caller-supplied
}

export interface Finding {
  id: string;
  runId: string;
  claim: string;
  evidenceIds: string[];
  confidence: ConfidenceResult;
  createdAt: string;
}

export interface InvestigationRun {
  id: string;
  caseId: string;
  seedEntityIds: string[];
  objective: string;
  budget: RunBudget;
  status: 'planned' | 'running' | 'stopped' | 'done';
  stopReason?: string;
  actionLog: RunAction[];
  createdAt: string;
  updatedAt: string;
}
```

Create `src/main/investigation/ledger.ts`:

```ts
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { caseDir } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { withLock } from '../util/mutex';
import type { EvidenceRecord, Finding, InvestigationRun } from '@shared/investigation-types';

interface LedgerShape { evidence: EvidenceRecord[]; findings: Finding[]; runs: InvestigationRun[] }

function ledgerFile(caseId: string): string { return join(caseDir(caseId), 'investigation', 'ledger.json'); }
function rawFile(caseId: string, evidenceId: string): string { return join(caseDir(caseId), 'investigation', 'raw', `${evidenceId}.txt`); }

async function read(caseId: string): Promise<LedgerShape> {
  try { return JSON.parse(await secureReadText(ledgerFile(caseId))) as LedgerShape; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { evidence: [], findings: [], runs: [] }; throw e; }
}
async function write(caseId: string, l: LedgerShape): Promise<void> {
  await secureWriteFile(ledgerFile(caseId), JSON.stringify(l, null, 2));
}

export async function appendEvidence(
  caseId: string,
  rec: Omit<EvidenceRecord, 'id' | 'rawRef' | 'createdAt'>,
  raw: string,
  now: string
): Promise<EvidenceRecord> {
  return withLock(`inv:${caseId}`, async () => {
    const l = await read(caseId);
    const id = `ev-${randomUUID()}`;
    const rawRef = rawFile(caseId, id);
    await secureWriteFile(rawRef, raw);
    const full: EvidenceRecord = { ...rec, id, rawRef, createdAt: now };
    l.evidence.push(full);
    await write(caseId, l);
    return full;
  });
}

export async function appendFinding(caseId: string, f: Omit<Finding, 'id' | 'createdAt'>, now: string): Promise<Finding> {
  return withLock(`inv:${caseId}`, async () => {
    const l = await read(caseId);
    const full: Finding = { ...f, id: `find-${randomUUID()}`, createdAt: now };
    l.findings.push(full);
    await write(caseId, l);
    return full;
  });
}

export async function upsertRun(caseId: string, run: InvestigationRun): Promise<void> {
  return withLock(`inv:${caseId}`, async () => {
    const l = await read(caseId);
    const idx = l.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) l.runs[idx] = run; else l.runs.push(run);
    await write(caseId, l);
  });
}

export async function getRun(caseId: string, runId: string): Promise<InvestigationRun | undefined> {
  return withLock(`inv:${caseId}`, async () => (await read(caseId)).runs.find((r) => r.id === runId));
}

export async function listEvidence(caseId: string, runId?: string): Promise<EvidenceRecord[]> {
  return withLock(`inv:${caseId}`, async () => {
    const all = (await read(caseId)).evidence;
    return runId ? all.filter((e) => e.runId === runId) : all;
  });
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-ledger` → PASS; `pnpm typecheck` clean. (If `secure-fs` in tests needs an unlocked vault rather than the mock, adapt the test's mock to the idiom used by `test/entities.test.ts`.)

- [ ] **Step 5: Commit.** `git add src/shared/investigation-types.ts src/main/investigation/ledger.ts test/investigation-ledger.test.ts && git commit -m "feat(investigation): append-only encrypted provenance ledger (evidence/finding/run)"`

---

### Task 4: Transform contract + registry + OSINT entity types (SP-2)

**Files:**
- Modify: `src/shared/investigation-types.ts` (add transform descriptor + I/O types)
- Modify: `src/shared/types.ts` (extend `EntityType` + `ENTITY_TYPES`, additive)
- Create: `src/main/investigation/registry.ts`
- Test: `test/investigation-registry.test.ts`

**Interfaces:**
- Produces (types): `TransformInput { entityId, entityType, value }`; `TransformEntityOut { type, value, role? }`; `TransformOutput { entities, edges, signals, raw }`; `TransformDescriptor { id, version, title, inputTypes, capabilities, active, run }`.
- Produces (fns): `registerTransform(d)`, `getTransform(id)`, `listTransforms()`, `transformsForType(t)`, `__clearRegistryForTest()`.
- Extends `EntityType` with: `'url' | 'hostname' | 'asn' | 'certificate' | 'username' | 'file-hash'`.

- [ ] **Step 1: Write the failing test.** `test/investigation-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerTransform, getTransform, listTransforms, transformsForType, __clearRegistryForTest } from '../src/main/investigation/registry';
import type { TransformDescriptor } from '../src/shared/investigation-types';
import { ENTITY_TYPES } from '../src/shared/types';

const stub = (id: string, inputTypes: TransformDescriptor['inputTypes']): TransformDescriptor => ({
  id, version: '1', title: id, inputTypes, capabilities: [], active: false,
  run: async () => ({ entities: [], edges: [], signals: [], raw: '' }),
});

beforeEach(() => __clearRegistryForTest());

describe('transform registry', () => {
  it('registers and looks up a transform', () => {
    registerTransform(stub('whois', ['domain']));
    expect(getTransform('whois')?.id).toBe('whois');
    expect(listTransforms()).toHaveLength(1);
  });
  it('rejects a duplicate id', () => {
    registerTransform(stub('whois', ['domain']));
    expect(() => registerTransform(stub('whois', ['domain']))).toThrow(/already registered/i);
  });
  it('filters transforms by accepted input type', () => {
    registerTransform(stub('whois', ['domain']));
    registerTransform(stub('sherlock', ['username']));
    expect(transformsForType('username').map((t) => t.id)).toEqual(['sherlock']);
  });
  it('EntityType is extended with the OSINT types additively', () => {
    for (const t of ['url', 'hostname', 'asn', 'certificate', 'username', 'file-hash']) {
      expect(ENTITY_TYPES).toContain(t);
    }
    expect(ENTITY_TYPES).toContain('person'); // existing preserved
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-registry` → FAIL.

- [ ] **Step 3a: Extend `EntityType`.** In `src/shared/types.ts`, change the `EntityType` union to append the new members and add them to `ENTITY_TYPES` (additive — keep all existing):

```ts
export type EntityType =
  | 'person' | 'alias' | 'email' | 'phone' | 'domain' | 'ip'
  | 'organisation' | 'social-profile' | 'vehicle' | 'location' | 'crypto-wallet' | 'other'
  | 'url' | 'hostname' | 'asn' | 'certificate' | 'username' | 'file-hash';

export const ENTITY_TYPES: readonly EntityType[] = [
  'person', 'alias', 'email', 'phone', 'domain', 'ip',
  'organisation', 'social-profile', 'vehicle', 'location', 'crypto-wallet', 'other',
  'url', 'hostname', 'asn', 'certificate', 'username', 'file-hash'
];
```

- [ ] **Step 3b: Add transform contract types.** Append to `src/shared/investigation-types.ts`:

```ts
export interface TransformInput { entityId: string; entityType: EntityType; value: string }
export interface TransformEntityOut { type: EntityType; value: string; role?: string }

export interface TransformOutput {
  entities: TransformEntityOut[];
  edges: TransformEdgeOut[];
  signals: EvidenceSignal[];
  raw: string; // the raw tool output (stored encrypted at rest by the ledger)
}

/** A registered transform. `run` is supplied by the OSINT plugin; core holds the descriptor and invokes it. */
export interface TransformDescriptor {
  id: string;
  version: string;
  title: string;
  inputTypes: EntityType[];
  capabilities: string[]; // required capabilities, e.g. ['egress'] or ['authorized-target-egress']
  active: boolean;        // active (touches target) vs passive
  run: (input: TransformInput) => Promise<TransformOutput>;
}
```

- [ ] **Step 3c: Implement `src/main/investigation/registry.ts`:**

```ts
import type { TransformDescriptor, EntityType } from '@shared/investigation-types';

const registry = new Map<string, TransformDescriptor>();

export function registerTransform(d: TransformDescriptor): void {
  if (registry.has(d.id)) throw new Error(`Transform already registered: ${d.id}`);
  registry.set(d.id, d);
}
export function getTransform(id: string): TransformDescriptor | undefined { return registry.get(id); }
export function listTransforms(): TransformDescriptor[] { return [...registry.values()]; }
export function transformsForType(t: EntityType): TransformDescriptor[] {
  return [...registry.values()].filter((d) => d.inputTypes.includes(t));
}
export function __clearRegistryForTest(): void { registry.clear(); }
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-registry` → PASS; `pnpm typecheck` clean (verify the wider tree still compiles — extending `EntityType` is additive so existing `switch`/lookup code stays valid; if any exhaustive `switch (entityType)` breaks, add the new cases mapping to a sensible default label).

- [ ] **Step 5: Commit.** `git add src/shared/investigation-types.ts src/shared/types.ts src/main/investigation/registry.ts test/investigation-registry.test.ts && git commit -m "feat(investigation): transform contract + registry + OSINT entity types"`

---

### Task 5: Transform runner + investigation capability (SP-2, end-to-end)

**Files:**
- Create: `src/main/investigation/runner.ts`
- Modify: `src/shared/plugin-types.ts` (add `'investigation'` capability)
- Test: `test/investigation-runner.test.ts`

**Interfaces:**
- Consumes: `getTransform` (Task 4), `appendEvidence` (Task 3), `scoreConfidence` (Task 2), and `entities.create`/`entities.listAll` from `src/main/storage/entities`.
- Produces: `runTransform(caseId, runId, transformId, input, now): Promise<RunTransformResult>` where `RunTransformResult { evidence: EvidenceRecord; producedEntityIds: string[]; confidence: ConfidenceResult }`.

- [ ] **Step 1: Write the failing test.** `test/investigation-runner.test.ts` (mock `entities` + reuse the ledger secure-fs mock):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-runner-test') } }));
vi.mock('../src/main/storage/secure-fs', () => {
  const store = new Map<string, string>();
  return {
    async secureWriteFile(p: string, d: string) { store.set(p, d); },
    async secureReadText(p: string) { if (!store.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return store.get(p)!; },
  };
});
const created: { type: string; value: string }[] = [];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return created.map((c, i) => ({ id: `ent-${i}`, ...c })); },
  async create(input: { type: string; value: string }) { created.push(input); return { id: `ent-${created.length - 1}`, ...input }; },
}));

import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { runTransform } from '../src/main/investigation/runner';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const NOW = '2026-07-04T00:00:00.000Z';
beforeEach(() => { __clearRegistryForTest(); created.length = 0; });

describe('runTransform (contract end-to-end, stub transform)', () => {
  it('runs a transform, merges produced entities, writes evidence, scores confidence', async () => {
    const stub: TransformDescriptor = {
      id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: ['egress'], active: false,
      run: async () => ({
        entities: [{ type: 'email', value: 'reg@evil.tld' }],
        edges: [{ fromValue: 'evil.tld', fromType: 'domain', toValue: 'reg@evil.tld', toType: 'email', relation: 'registrant-of' }],
        signals: [{ kind: 'authoritative-source', weight: 2 }, { kind: 'corroborating-source', weight: 1 }],
        raw: 'Registrant Email: reg@evil.tld',
      }),
    };
    registerTransform(stub);
    const res = await runTransform('caseA', 'run1', 'whois',
      { entityId: 'ent-seed', entityType: 'domain', value: 'evil.tld' }, NOW);
    expect(res.producedEntityIds).toHaveLength(1);
    expect(created).toContainEqual({ type: 'email', value: 'reg@evil.tld' });
    expect(res.evidence.transformId).toBe('whois');
    expect(res.evidence.producedEdges[0].relation).toBe('registrant-of');
    expect(res.confidence.band).toBe('high');
    expect(res.confidence.attribution).toBe('attributed');
  });
  it('throws on an unknown transform id', async () => {
    await expect(runTransform('caseA', 'run1', 'nope',
      { entityId: 'e', entityType: 'domain', value: 'x' }, NOW)).rejects.toThrow(/unknown transform/i);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-runner` → FAIL.

- [ ] **Step 3: Implement `src/main/investigation/runner.ts`:**

```ts
import { getTransform } from './registry';
import { appendEvidence } from './ledger';
import { scoreConfidence } from './confidence';
import * as entities from '../storage/entities';
import type { TransformInput, EvidenceRecord, ConfidenceResult } from '@shared/investigation-types';

export interface RunTransformResult {
  evidence: EvidenceRecord;
  producedEntityIds: string[];
  confidence: ConfidenceResult;
}

/** Invoke a registered transform on one input entity, merge its produced entities into the cross-case
 *  registry (dedup by type+value), write an append-only evidence record with the raw output, and compute
 *  machine-derived confidence. `now` is caller-supplied for determinism. No agent, no scope logic here —
 *  this is the "transforms callable directly" runner that proves the SP-2 contract. */
export async function runTransform(
  caseId: string, runId: string, transformId: string, input: TransformInput, now: string
): Promise<RunTransformResult> {
  const t = getTransform(transformId);
  if (!t) throw new Error(`Unknown transform: ${transformId}`);
  const out = await t.run(input);

  // Merge produced entities into the cross-case registry (simple type+value dedup; canonicalization is a
  // later refinement in SP-3 when real transforms emit noisy values).
  const all = await entities.listAll();
  const byKey = new Map(all.map((r) => [`${r.type} ${r.value}`, r.id]));
  const producedEntityIds: string[] = [];
  for (const e of out.entities) {
    const key = `${e.type} ${e.value}`;
    let id = byKey.get(key);
    if (!id) { const rec = await entities.create({ type: e.type, value: e.value }); id = rec.id; byKey.set(key, id); }
    producedEntityIds.push(id);
  }

  const evidence = await appendEvidence(caseId, {
    runId, transformId: t.id, transformVersion: t.version, inputEntityId: input.entityId,
    producedEntityIds, producedEdges: out.edges, signals: out.signals,
  }, out.raw, now);

  return { evidence, producedEntityIds, confidence: scoreConfidence(out.signals) };
}
```

- [ ] **Step 4: Add the capability.** In `src/shared/plugin-types.ts`, add `'investigation'` to the capability union + list (the capability a plugin needs to register/run transforms and write to the ledger), alongside `'reasoning-runtime'` from Task 1.

- [ ] **Step 5: Run tests + typecheck, verify pass.** `pnpm test investigation-runner` → PASS; then the whole investigation + reasoning suite: `pnpm test reasoning-runtime investigation-confidence investigation-ledger investigation-registry investigation-runner` → all PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit.** `git add src/main/investigation/runner.ts src/shared/plugin-types.ts test/investigation-runner.test.ts && git commit -m "feat(investigation): transform runner (merge entities + evidence + confidence) + capability"`

---

## Self-Review

**Spec coverage (SP-1 + SP-2 sections of the design):**
- SP-1 reasoning-runtime mechanism (model-agnostic, loopback, honest health, v3.30.0 lessons) → Task 1. ✓
- SP-1 packaging boundary (model supplied by caller, not hardcoded bundled path) → Task 1 (`configureReasoningRuntime` takes `modelsDir`). ✓ (The embed-vs-side-load *packaging* decision itself is resolved when the plugin ships the model; the mechanism is agnostic, as required.)
- SP-2 transform contract → Task 4. Registry → Task 4. Provenance ledger (evidence/finding/run, append-only, encrypted) → Task 3. Deterministic confidence scorer → Task 2. "Transforms callable directly" runner → Task 5. ✓
- New capabilities (`reasoning-runtime`, `investigation`) → Tasks 1 & 5. ✓
- Charter: no egress (loopback only), determinism (caller-supplied `now`, pure scorer), encrypted-at-rest (secure-fs) → Global Constraints + enforced per task. ✓

**Not in scope here (correctly deferred):** real OSINT transforms (SP-3), graph canvas (SP-4), rails/budget guard (SP-5), orchestrator (SP-6), report (SP-7), MCP bridge (SP-8), portfolio (SP-9). The entity *annotations* (cluster/role/score) belong to SP-4's graph model and are intentionally absent here.

**Type consistency:** `EvidenceSignal`, `ConfidenceResult`, `TransformEdgeOut`, `EvidenceRecord`, `TransformDescriptor`, `TransformInput`, `TransformOutput`, `RunTransformResult` names are used identically across Tasks 2–5. `now: string` timestamp-injection is consistent in ledger + runner. `EntityType` extension is additive.

**Open risk flagged for the implementer:** the ledger/runner tests mock `secure-fs`; if the repo convention (`test/entities.test.ts`) instead exercises a real tmpdir-backed vault, follow that idiom rather than the mock. Extending `EntityType` may surface exhaustive `switch` statements elsewhere — Task 4 Step 4 says to add the new cases if `typecheck` flags them.
