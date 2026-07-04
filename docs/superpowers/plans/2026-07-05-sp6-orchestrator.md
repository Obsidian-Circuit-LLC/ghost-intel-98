# SP-6: Free-Form Orchestrator (Run Harness) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic core **run harness** for the Autonomous OSINT Investigator — it perceives the graph, asks an injected `Brain` for one action per turn, enforces every rail via the SP-5 guard, runs transforms via the SP-2 runner, streams events, persists the run, and honors async human control — turning the SP-1/2/4/5 substrate into an autonomous investigator (the LLM brain itself is subsystem-2).

**Architecture:** A `RunState` per active run (guard + depth map + expanded set + focus/ignore + pending-ask). `assembleContext` builds a bounded `AgentContext`; `runOneTurn` validates→guards→executes→observes one brain action; `startRun` loops turns until `guard.shouldStop`. The brain is injected (`Brain` interface); core ships a `ScriptedBrain` so the whole harness is unit-tested with no LLM.

**Tech Stack:** TypeScript, Electron main, Vitest. Consumes (all merged): SP-5 `guard.ts`, SP-2 `runner.ts`/`registry.ts`/`ledger.ts`, SP-4 `graph.ts`, `entities.ts`, `investigation-types.ts`/`investigation-graph.ts`.

## Global Constraints

- **Determinism (charter, load-bearing):** the harness's decision/loop logic MUST be deterministic. The ONLY time source is an injected `now: () => number` (ms epoch) in the harness deps; tests inject a controlled clock. **Do NOT call `Date.now()` or no-arg `new Date()` in the loop logic.** Converting an injected ms to the ISO string the SP-2 runner/ledger require via `new Date(ms).toISOString()` IS allowed — it is a pure function of the injected `ms`, not wall-clock. (Reviewers: `new Date(<number>)` is fine here; only `new Date()` / `Date.now()` are forbidden.)
- **Rails outside the LLM:** the brain only *proposes* an action; the harness validates it (registered transform? known entity?) and runs it through `guard.checkAction` before executing via the SP-2 runner. A malformed/hallucinating/injected brain can never run an unregistered transform, exceed budget, hit an out-of-scope target, or fabricate a node.
- **No assert-a-fact action:** `AgentAction` is `run-transform | ask | done` only — facts + nodes come solely from transform output (SP-2 runner). The brain's `reasoning` is advisory narration.
- **No new egress / no telemetry:** the harness is loopback-only; transforms reach the network only through the existing Tor-gated runner path. Run data is encrypted-at-rest via the SP-2 ledger.
- **v1 not resumable across restart:** an interrupted run is left as-is in-memory; do not build cross-restart resume.
- **Commit identity:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; NEVER emit AI-identity trailers. Stage only each task's files; never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/`, `resources/local-ai/ollama*`.
- **TDD:** failing test → verify fail → minimal impl → verify pass → commit. `pnpm test <file>`; `pnpm typecheck` clean (both configs).

## File Structure

- `src/shared/investigation-agent.ts` *(NEW)* — shared contracts: `AgentEntity`, `AgentContext`, `AgentAction`, `Brain`, `RunEvent`.
- `src/main/investigation/scripted-brain.ts` *(NEW)* — `ScriptedBrain` stub (core, for tests).
- `src/main/investigation/perceive.ts` *(NEW)* — `assembleContext`.
- `src/main/investigation/run-controller.ts` *(NEW)* — `RunState`, `runOneTurn`, `startRun`, the run registry, control (`pauseRun`/`resumeRun`/`stopRun`/`addScope`/`removeScope`/`focus`/`ignore`/`answerRun`), `getRunState`, `__resetRunsForTest`.
- `src/main/ipc/register.ts`, `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts` *(MODIFY)* — IPC + preload.
- Tests *(NEW)*: `test/investigation-scripted-brain.test.ts`, `test/investigation-perceive.test.ts`, `test/investigation-turn.test.ts`, `test/investigation-run.test.ts`, `test/investigation-run-control.test.ts`.

**Shared contract (defined Task 1, used by all):**
```ts
export interface AgentEntity { entityId: string; type: EntityType; value: string; score: number; depth: number }
export interface AgentContext {
  objective: string;
  seeds: AgentEntity[];
  keyEntities: AgentEntity[];
  frontier: AgentEntity[];
  recentFindings: string[];
  budget: { pivotsLeft: number; depthMax: number; wallClockMsLeft: number; tokensLeft: number };
  transforms: { id: string; title: string; inputTypes: EntityType[]; active: boolean }[];
  humanInput: string | null;
  lastError: string | null;
}
export type AgentAction =
  | { kind: 'run-transform'; transformId: string; entityId: string; reasoning?: string }
  | { kind: 'ask'; question: string }
  | { kind: 'done'; reason: string };
export interface Brain { decide(ctx: AgentContext): Promise<AgentAction> }
export type RunEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'action'; transformId: string; entityValue: string }
  | { kind: 'observed'; newEntities: number }
  | { kind: 'blocked'; reason: string }
  | { kind: 'ask'; question: string }
  | { kind: 'paused' } | { kind: 'resumed' }
  | { kind: 'stopped'; reason: string } | { kind: 'done'; reason: string };
```

---

### Task 1: Agent contracts + `ScriptedBrain`

**Files:**
- Create: `src/shared/investigation-agent.ts`, `src/main/investigation/scripted-brain.ts`
- Test: `test/investigation-scripted-brain.test.ts`

**Interfaces:**
- Consumes: `EntityType` (`@shared/types`).
- Produces: the shared contracts above; `class ScriptedBrain implements Brain` — constructed with `AgentAction[]`; `decide()` returns them in order, then `{ kind: 'done', reason: 'script-exhausted' }`.

- [ ] **Step 1: Write the failing test.** `test/investigation-scripted-brain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import type { AgentContext } from '../src/shared/investigation-agent';

const ctx = {} as AgentContext;

describe('ScriptedBrain', () => {
  it('returns the scripted actions in order', async () => {
    const b = new ScriptedBrain([
      { kind: 'run-transform', transformId: 'whois', entityId: 'e1' },
      { kind: 'done', reason: 'finished' },
    ]);
    expect(await b.decide(ctx)).toEqual({ kind: 'run-transform', transformId: 'whois', entityId: 'e1' });
    expect(await b.decide(ctx)).toEqual({ kind: 'done', reason: 'finished' });
  });
  it('returns done once the script is exhausted', async () => {
    const b = new ScriptedBrain([]);
    expect(await b.decide(ctx)).toEqual({ kind: 'done', reason: 'script-exhausted' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-scripted-brain` → FAIL.

- [ ] **Step 3a: Create `src/shared/investigation-agent.ts`** with exactly the contract block from "File Structure" above (import `EntityType` from `./types`).

- [ ] **Step 3b: Create `src/main/investigation/scripted-brain.ts`:**

```ts
import type { Brain, AgentContext, AgentAction } from '@shared/investigation-agent';

/** Deterministic test brain: returns a preset action sequence, then `done`. Keeps the whole harness
 *  unit-testable with no LLM (the real free-form brain is subsystem-2). */
export class ScriptedBrain implements Brain {
  private i = 0;
  constructor(private readonly script: AgentAction[]) {}
  async decide(_ctx: AgentContext): Promise<AgentAction> {
    return this.script[this.i++] ?? { kind: 'done', reason: 'script-exhausted' };
  }
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-scripted-brain` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/shared/investigation-agent.ts src/main/investigation/scripted-brain.ts test/investigation-scripted-brain.test.ts && git commit -m "feat(investigation): SP-6 agent contracts + ScriptedBrain stub"`

---

### Task 2: Perceive — assemble the bounded `AgentContext`

**Files:**
- Create: `src/main/investigation/perceive.ts`
- Test: `test/investigation-perceive.test.ts`

**Interfaces:**
- Consumes: `sceneForCase` (`./graph`), `listFindings` (`./ledger`), `listTransforms` (`./registry`), `GuardState` (`./guard`), `AgentContext`/`AgentEntity` (`@shared/investigation-agent`), `InvNode` (`@shared/investigation-graph`).
- Produces: `assembleContext(input): Promise<AgentContext>` where
  `input = { caseId, objective, guard, now, seedIds, depth: Map<string,number>, expanded: Set<string>, focus: Set<string>, ignore: Set<string>, humanInput: string | null, lastError: string | null }`.

**Design:** top-K (`K = 12`). `keyEntities` = scene nodes sorted by score desc (focus-first, ignore-last), top-K. `frontier` = scene nodes whose id is NOT in `expanded`, sorted by score desc, top-K. `seeds` = scene nodes whose id is in `seedIds`. `AgentEntity.depth` from the `depth` map (default 0). `recentFindings` = last 10 finding claims. `budget` computed from the guard. `transforms` = `listTransforms()` mapped to `{ id, title, inputTypes, active }`.

- [ ] **Step 1: Write the failing test.** `test/investigation-perceive.test.ts` (mock `graph`/`ledger`/`registry`):

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/main/investigation/graph', () => ({
  async sceneForCase() {
    return { nodes: [
      { id: 'e1', type: 'domain', value: 'evil.tld', cluster: 0, score: 1, x: 0, y: 0 },
      { id: 'e2', type: 'email', value: 'r@evil.tld', cluster: 0, score: 0.6, x: 0, y: 0 },
      { id: 'e3', type: 'ip', value: '1.2.3.4', cluster: 0, score: 0.3, x: 0, y: 0 },
    ], edges: [] };
  },
}));
vi.mock('../src/main/investigation/ledger', () => ({ async listFindings() { return [{ id: 'f', runId: 'r', claim: 'evil is bad', evidenceIds: [], confidence: { band: 'high', attribution: 'attributed', score: 4 }, createdAt: 'T' }]; } }));
vi.mock('../src/main/investigation/registry', () => ({ listTransforms() { return [{ id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false, run: async () => ({ entities: [], edges: [], signals: [], raw: '' }) }]; } }));

import { assembleContext } from '../src/main/investigation/perceive';
import { createGuard } from '../src/main/investigation/guard';

const base = () => ({
  caseId: 'c', objective: 'find all', guard: createGuard({ maxPivots: 5, maxDepth: 3, maxWallClockMs: 10_000, maxTokens: 1000 }, 0),
  now: 2_000, seedIds: ['e1'], depth: new Map([['e1', 0], ['e2', 1]]), expanded: new Set(['e1']),
  focus: new Set<string>(), ignore: new Set<string>(), humanInput: null, lastError: null,
});

describe('assembleContext', () => {
  it('builds a bounded context: seeds, key entities by score, frontier = not-yet-expanded', async () => {
    const ctx = await assembleContext(base());
    expect(ctx.objective).toBe('find all');
    expect(ctx.seeds.map((s) => s.entityId)).toEqual(['e1']);
    expect(ctx.keyEntities.map((n) => n.entityId)).toEqual(['e1', 'e2', 'e3']); // score desc
    expect(ctx.frontier.map((n) => n.entityId)).toEqual(['e2', 'e3']);          // e1 already expanded, excluded
    expect(ctx.keyEntities.find((n) => n.entityId === 'e2')!.depth).toBe(1);     // from the depth map
    expect(ctx.recentFindings).toEqual(['evil is bad']);
    expect(ctx.transforms).toEqual([{ id: 'whois', title: 'WHOIS', inputTypes: ['domain'], active: false }]);
  });
  it('reflects the guard budget and passes through humanInput/lastError', async () => {
    const ctx = await assembleContext({ ...base(), humanInput: 'focus on the IP', lastError: 'bad transform' });
    expect(ctx.budget.pivotsLeft).toBe(5);            // nothing spent yet
    expect(ctx.budget.wallClockMsLeft).toBe(8_000);   // 10000 - (now 2000 - startedAt 0)
    expect(ctx.humanInput).toBe('focus on the IP');
    expect(ctx.lastError).toBe('bad transform');
  });
  it('honors ignore (excluded) and focus (ranked first)', async () => {
    const ctx = await assembleContext({ ...base(), ignore: new Set(['e2']), focus: new Set(['e3']) });
    expect(ctx.keyEntities.map((n) => n.entityId)).toEqual(['e3', 'e1']); // e3 focused first, e2 ignored out
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-perceive` → FAIL.

- [ ] **Step 3: Implement `src/main/investigation/perceive.ts`:**

```ts
import { sceneForCase } from './graph';
import { listFindings } from './ledger';
import { listTransforms } from './registry';
import type { GuardState } from './guard';
import type { AgentContext, AgentEntity } from '@shared/investigation-agent';
import type { InvNode } from '@shared/investigation-graph';

const TOP_K = 12;
const RECENT_FINDINGS = 10;

export interface PerceiveInput {
  caseId: string; objective: string; guard: GuardState; now: number;
  seedIds: string[]; depth: Map<string, number>; expanded: Set<string>;
  focus: Set<string>; ignore: Set<string>; humanInput: string | null; lastError: string | null;
}

function toEntity(n: InvNode, depth: Map<string, number>): AgentEntity {
  return { entityId: n.id, type: n.type, value: n.value, score: n.score, depth: depth.get(n.id) ?? 0 };
}

export async function assembleContext(input: PerceiveInput): Promise<AgentContext> {
  const [scene, findings] = await Promise.all([sceneForCase(input.caseId), listFindings(input.caseId)]);
  // Rank: focused first, ignored excluded, then score desc, then id for stable determinism.
  const visible = scene.nodes.filter((n) => !input.ignore.has(n.id));
  const rank = (a: InvNode, b: InvNode): number => {
    const fa = input.focus.has(a.id) ? 1 : 0, fb = input.focus.has(b.id) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    if (a.score !== b.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  };
  const ranked = [...visible].sort(rank);
  const keyEntities = ranked.slice(0, TOP_K).map((n) => toEntity(n, input.depth));
  const frontier = ranked.filter((n) => !input.expanded.has(n.id)).slice(0, TOP_K).map((n) => toEntity(n, input.depth));
  const seeds = scene.nodes.filter((n) => input.seedIds.includes(n.id)).map((n) => toEntity(n, input.depth));

  const g = input.guard;
  return {
    objective: input.objective,
    seeds,
    keyEntities,
    frontier,
    recentFindings: findings.slice(-RECENT_FINDINGS).map((f) => f.claim),
    budget: {
      pivotsLeft: Math.max(0, g.budget.maxPivots - g.spentPivots),
      depthMax: g.budget.maxDepth,
      wallClockMsLeft: Math.max(0, g.budget.maxWallClockMs - (input.now - g.startedAt)),
      tokensLeft: Math.max(0, g.budget.maxTokens - g.spentTokens),
    },
    transforms: listTransforms().map((t) => ({ id: t.id, title: t.title, inputTypes: t.inputTypes, active: t.active })),
    humanInput: input.humanInput,
    lastError: input.lastError,
  };
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-perceive` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/perceive.ts test/investigation-perceive.test.ts && git commit -m "feat(investigation): SP-6 perceive — bounded AgentContext assembly"`

---

### Task 3: `RunState` + `runOneTurn` (validate → guard → execute → observe)

**Files:**
- Create: `src/main/investigation/run-controller.ts` (types + `runOneTurn` + helpers)
- Test: `test/investigation-turn.test.ts`

**Interfaces:**
- Consumes: `guard` fns (`checkAction`, `recordAction`, `GuardState`, `ProposedAction`), `getTransform` (`./registry`), `runTransform` (`./runner`), `entities.listAll` (`../storage/entities`), `AgentAction`/`RunEvent` (`@shared/investigation-agent`).
- Produces: `interface RunState { runId; caseId; guard: GuardState; objective; seedIds; depth: Map<string,number>; expanded: Set<string>; focus: Set<string>; ignore: Set<string>; pendingAsk: ((a: string) => void) | null; lastError: string | null; humanInput: string | null; status: 'running'|'stopped'|'done'; stopReason: string | null }`;
  `runOneTurn(rs: RunState, action: AgentAction, emit: (e: RunEvent) => void, now: number): Promise<'continue' | 'done'>`.

**Design of `runOneTurn`:** on `done` → set status/stopReason, emit `done`, return `'done'`. On `ask` → handled by the loop (Task 4), not here (return `'continue'` after emitting `ask` — the loop awaits the answer). On `run-transform`: validate (transform registered? entity exists in `entities.listAll()`? input type in `inputTypes`?) → on failure set `rs.lastError`, emit `blocked`, return `'continue'`. Then build `ProposedAction` (`transformActive` = descriptor.active, `entityValue` = the entity's value, `depth` = `rs.depth.get(entityId) ?? 0`, `estTokens` = 0) → `checkAction`; denied → set `lastError` = reason, emit `blocked`, return. Else run `runTransform` (ISO now = `new Date(now).toISOString()`), then observe: mark `rs.expanded.add(entityId)`, set each produced entity's depth to `min(existing, parentDepth+1)`, `recordAction(guard, pa, result.confidence.score>0 ? 0 : 0)` (tokens 0 in v1), clear `lastError`, emit `observed`. Return `'continue'`.

- [ ] **Step 1: Write the failing test.** `test/investigation-turn.test.ts` (mock secure-fs + entities + a registered stub transform):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-turn-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const store: { id: string; type: string; value: string }[] = [{ id: 'e1', type: 'domain', value: 'evil.tld' }];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return store.map((s) => ({ ...s, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' })); },
  async create(i: { type: string; value: string }) { const r = { id: `e${store.length + 1}`, ...i }; store.push(r); return { ...r, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }; },
}));

import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { createGuard, addToScope } from '../src/main/investigation/guard';
import { runOneTurn, newRunState } from '../src/main/investigation/run-controller';
import type { RunEvent } from '../src/shared/investigation-agent';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const passive: TransformDescriptor = { id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false,
  run: async () => ({ entities: [{ type: 'email', value: 'r@evil.tld' }], edges: [], signals: [{ kind: 'authoritative-source', weight: 2 }], raw: 'x' }) };
const active: TransformDescriptor = { ...passive, id: 'portscan', active: true };

function rs() { return newRunState('run1', 'caseT', 'find all', ['e1'], createGuard({ maxPivots: 5, maxDepth: 3, maxWallClockMs: 99_999, maxTokens: 9999 }, 0)); }
const sink = (): { events: RunEvent[]; emit: (e: RunEvent) => void } => { const events: RunEvent[] = []; return { events, emit: (e) => events.push(e) }; };

beforeEach(() => { __clearRegistryForTest(); store.length = 0; store.push({ id: 'e1', type: 'domain', value: 'evil.tld' }); });

describe('runOneTurn', () => {
  it('executes a valid passive transform and observes new entities', async () => {
    registerTransform(passive);
    const s = rs(); const { events, emit } = sink();
    const r = await runOneTurn(s, { kind: 'run-transform', transformId: 'whois', entityId: 'e1' }, emit, 0);
    expect(r).toBe('continue');
    expect(s.expanded.has('e1')).toBe(true);
    expect(events.some((e) => e.kind === 'observed')).toBe(true);
    expect(s.lastError).toBeNull();
  });
  it('blocks an unregistered transform (invalid) with lastError', async () => {
    const s = rs(); const { events, emit } = sink();
    await runOneTurn(s, { kind: 'run-transform', transformId: 'nope', entityId: 'e1' }, emit, 0);
    expect(s.lastError).toMatch(/unknown|not registered/i);
    expect(events.some((e) => e.kind === 'blocked')).toBe(true);
  });
  it('blocks an ACTIVE transform on an out-of-scope target; allows after addToScope', async () => {
    registerTransform(active);
    const s = rs(); const { events, emit } = sink();
    await runOneTurn(s, { kind: 'run-transform', transformId: 'portscan', entityId: 'e1' }, emit, 0);
    expect(events.some((e) => e.kind === 'blocked' && e.reason.includes('not-authorized-target'))).toBe(true);
    addToScope(s.guard, 'evil.tld');
    const r2 = await runOneTurn(s, { kind: 'run-transform', transformId: 'portscan', entityId: 'e1' }, emit, 0);
    expect(r2).toBe('continue'); expect(s.lastError).toBeNull();
  });
  it('done ends the turn and sets status', async () => {
    const s = rs(); const { emit } = sink();
    expect(await runOneTurn(s, { kind: 'done', reason: 'finished' }, emit, 0)).toBe('done');
    expect(s.status).toBe('done'); expect(s.stopReason).toBe('finished');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-turn` → FAIL.

- [ ] **Step 3: Implement** the types + `newRunState` + `runOneTurn` in `src/main/investigation/run-controller.ts`:

```ts
import * as entities from '../storage/entities';
import { getTransform } from './registry';
import { runTransform } from './runner';
import { checkAction, recordAction, type GuardState, type ProposedAction } from './guard';
import type { AgentAction, RunEvent } from '@shared/investigation-agent';

export interface RunState {
  runId: string; caseId: string; objective: string; seedIds: string[]; guard: GuardState;
  depth: Map<string, number>; expanded: Set<string>; focus: Set<string>; ignore: Set<string>;
  pendingAsk: ((a: string) => void) | null; lastError: string | null; humanInput: string | null;
  status: 'running' | 'stopped' | 'done'; stopReason: string | null;
}

export function newRunState(runId: string, caseId: string, objective: string, seedIds: string[], guard: GuardState): RunState {
  const depth = new Map<string, number>(); for (const id of seedIds) depth.set(id, 0);
  return { runId, caseId, objective, seedIds, guard, depth, expanded: new Set(), focus: new Set(), ignore: new Set(),
    pendingAsk: null, lastError: null, humanInput: null, status: 'running', stopReason: null };
}

/** One turn's dispatch of a brain action. Returns 'done' to end the run, else 'continue'. `ask` is
 *  emitted here but the WAIT is owned by the loop (Task 4). Deterministic: `now` (ms) is passed in. */
export async function runOneTurn(rs: RunState, action: AgentAction, emit: (e: RunEvent) => void, now: number): Promise<'continue' | 'done'> {
  if (action.kind === 'done') { rs.status = 'done'; rs.stopReason = action.reason; emit({ kind: 'done', reason: action.reason }); return 'done'; }
  if (action.kind === 'ask') { emit({ kind: 'ask', question: action.question }); return 'continue'; }

  if (action.reasoning) emit({ kind: 'thinking', text: action.reasoning });
  const t = getTransform(action.transformId);
  if (!t) { rs.lastError = `unknown transform: ${action.transformId}`; emit({ kind: 'blocked', reason: rs.lastError }); return 'continue'; }
  const all = await entities.listAll();
  const ent = all.find((e) => e.id === action.entityId);
  if (!ent) { rs.lastError = `unknown entity: ${action.entityId}`; emit({ kind: 'blocked', reason: rs.lastError }); return 'continue'; }
  if (!t.inputTypes.includes(ent.type)) { rs.lastError = `${t.id} does not accept ${ent.type}`; emit({ kind: 'blocked', reason: rs.lastError }); return 'continue'; }

  const parentDepth = rs.depth.get(ent.id) ?? 0;
  const pa: ProposedAction = { transformId: t.id, transformActive: t.active, entityId: ent.id, entityValue: ent.value, depth: parentDepth, estTokens: 0 };
  const decision = checkAction(rs.guard, pa, now);
  if (!decision.allow) { rs.lastError = decision.reason; emit({ kind: 'blocked', reason: decision.reason }); return 'continue'; }

  emit({ kind: 'action', transformId: t.id, entityValue: ent.value });
  try {
    const result = await runTransform(rs.caseId, rs.runId, t.id, { entityId: ent.id, entityType: ent.type, value: ent.value }, new Date(now).toISOString());
    rs.expanded.add(ent.id);
    for (const id of result.producedEntityIds) {
      const d = Math.min(rs.depth.get(id) ?? Number.POSITIVE_INFINITY, parentDepth + 1);
      rs.depth.set(id, d);
    }
    recordAction(rs.guard, pa, 0);
    rs.lastError = null;
    emit({ kind: 'observed', newEntities: result.producedEntityIds.length });
  } catch (e) {
    rs.lastError = `transform failed: ${(e as Error).message}`;
    emit({ kind: 'blocked', reason: rs.lastError }); // failed lead — recorded, run continues
  }
  return 'continue';
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-turn` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/run-controller.ts test/investigation-turn.test.ts && git commit -m "feat(investigation): SP-6 turn dispatch — validate/guard/execute/observe one action"`

---

### Task 4: Run loop + lifecycle + registry

**Files:**
- Modify: `src/main/investigation/run-controller.ts` (add `startRun`, the loop, registry, `getRunState`, `__resetRunsForTest`)
- Test: `test/investigation-run.test.ts`

**Interfaces:**
- Consumes: `assembleContext` (`./perceive`), `recordProgress`, `shouldStop`, `stop` (`./guard`), `sceneForCase` (`./graph`), `upsertRun` (`./ledger`), `Brain` (`@shared/investigation-agent`), `RunState`/`runOneTurn`/`newRunState` (Task 3).
- Produces: `startRun(input): Promise<string>` where `input = { caseId, seedIds, objective, budget: RunBudget, brain: Brain, deps: { emit: (runId: string, e: RunEvent) => void; now: () => number; noProgressWindow?: number } }`; `getRunState(runId): RunState | undefined`; `__resetRunsForTest()`.

**Design:** `startRun` builds a `RunState` (via `newRunState` with `createGuard(budget, deps.now())`), registers it (`runId → { rs, deps }`), persists an `InvestigationRun` (status `running`) via `upsertRun`, then runs the loop and returns the `runId` after the loop settles (tests await the whole run; production can fire-and-forget — but for testability `startRun` awaits the loop). The loop: while `rs.status === 'running'`: assemble context → `brain.decide` → `runOneTurn`; if it returned `'done'` break; if the action was `ask`, await `rs.pendingAsk` (Task 5) — for Task 4 tests, no `ask` is scripted; then `recordProgress(rs.guard, (await sceneForCase(caseId)).nodes.length)`; `const s = shouldStop(rs.guard, deps.now(), window)`; if `s.stop` → `stop(rs.guard, s.reason ?? 'stopped')` (if not already), set `rs.status='stopped'`, `rs.stopReason=s.reason`, emit `stopped`, break. Finish: `upsertRun` with the final status + stopReason, unregister.

- [ ] **Step 1: Write the failing test.** `test/investigation-run.test.ts` (same mocks as Task 3 for secure-fs/entities; register a stub transform):

```ts
// ... same electron/secure-fs/entities mocks as investigation-turn.test.ts ...
import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { startRun, getRunState, __resetRunsForTest } from '../src/main/investigation/run-controller';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import type { RunEvent } from '../src/shared/investigation-agent';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const whois: TransformDescriptor = { id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false,
  run: async () => ({ entities: [{ type: 'email', value: 'r@evil.tld' }], edges: [], signals: [], raw: 'x' }) };
const budget = { maxPivots: 3, maxDepth: 3, maxWallClockMs: 99_999, maxTokens: 9999 };
const deps = () => { const events: { id: string; e: RunEvent }[] = []; return { events, d: { emit: (id: string, e: RunEvent) => events.push({ id, e }), now: () => 0, noProgressWindow: 3 } }; };

beforeEach(() => { __clearRegistryForTest(); __resetRunsForTest(); /* reset entities store as in Task 3 */ });

describe('startRun', () => {
  it('happy path: runs the scripted transforms then done', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'run-transform', transformId: 'whois', entityId: 'e1' }, { kind: 'done', reason: 'finished' }]);
    const runId = await startRun({ caseId: 'cR', seedIds: ['e1'], objective: 'find all', budget, brain, deps: d });
    expect(events.some((x) => x.e.kind === 'observed')).toBe(true);
    expect(events.some((x) => x.e.kind === 'done' && (x.e as { reason: string }).reason === 'finished')).toBe(true);
    expect(getRunState(runId)).toBeUndefined(); // unregistered after finish
  });
  it('budget stop: a brain that keeps pivoting hits maxPivots', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    // 4 distinct pivots but budget is 3 → the guard stops the run
    const brain = new ScriptedBrain(Array.from({ length: 6 }, () => ({ kind: 'run-transform', transformId: 'whois', entityId: 'e1' })) as never);
    await startRun({ caseId: 'cB', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    expect(events.some((x) => x.e.kind === 'stopped' && (x.e as { reason: string }).reason.startsWith('budget'))).toBe(true);
  });
  it('no-progress stop: a brain proposing only duplicates stalls out', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain(Array.from({ length: 10 }, () => ({ kind: 'run-transform', transformId: 'whois', entityId: 'e1' })) as never);
    await startRun({ caseId: 'cN', seedIds: ['e1'], objective: 'x', budget: { ...budget, maxPivots: 99 }, brain, deps: d });
    expect(events.some((x) => x.e.kind === 'stopped' && (x.e as { reason: string }).reason === 'no-progress')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-run` → FAIL.

- [ ] **Step 3: Implement.** Append to `src/main/investigation/run-controller.ts`:

```ts
import { assembleContext } from './perceive';
import { recordProgress, shouldStop, stop as guardStop, createGuard } from './guard';
import { sceneForCase } from './graph';
import { upsertRun } from './ledger';
import type { Brain, RunEvent } from '@shared/investigation-agent';
import type { RunBudget, InvestigationRun } from '@shared/investigation-types';

interface RunDeps { emit: (runId: string, e: RunEvent) => void; now: () => number; noProgressWindow?: number }
const runs = new Map<string, { rs: RunState; deps: RunDeps }>();
let seq = 0;

export function getRunState(runId: string): RunState | undefined { return runs.get(runId)?.rs; }
export function __resetRunsForTest(): void { runs.clear(); seq = 0; }

export interface StartRunInput { caseId: string; seedIds: string[]; objective: string; budget: RunBudget; brain: Brain; deps: RunDeps }

function runRecord(rs: RunState, now: number): InvestigationRun {
  const iso = new Date(now).toISOString();
  return { id: rs.runId, caseId: rs.caseId, seedEntityIds: rs.seedIds, objective: rs.objective, budget: rs.guard.budget,
    status: rs.status === 'running' ? 'running' : rs.status, stopReason: rs.stopReason ?? undefined,
    actionLog: [], createdAt: iso, updatedAt: iso };
}

export async function startRun(input: StartRunInput): Promise<string> {
  const runId = `run-${++seq}`;
  const window = input.deps.noProgressWindow ?? 4;
  const rs = newRunState(runId, input.caseId, input.objective, input.seedIds, createGuard(input.budget, input.deps.now()));
  runs.set(runId, { rs, deps: input.deps });
  await upsertRun(input.caseId, runRecord(rs, input.deps.now()));
  const emit = (e: RunEvent): void => input.deps.emit(runId, e);

  while (rs.status === 'running') {
    const now = input.deps.now();
    const ctx = await assembleContext({ caseId: rs.caseId, objective: rs.objective, guard: rs.guard, now,
      seedIds: rs.seedIds, depth: rs.depth, expanded: rs.expanded, focus: rs.focus, ignore: rs.ignore,
      humanInput: rs.humanInput, lastError: rs.lastError });
    rs.humanInput = null;
    let action;
    try { action = await input.brain.decide(ctx); }
    catch (e) { rs.lastError = `brain error: ${(e as Error).message}`; emit({ kind: 'blocked', reason: rs.lastError }); action = null; }
    if (action) {
      const outcome = await runOneTurn(rs, action, emit, now);
      if (outcome === 'done') break;
      if (action.kind === 'ask') { await awaitAnswer(rs); continue; } // Task 5
    }
    recordProgress(rs.guard, (await sceneForCase(rs.caseId)).nodes.length);
    const s = shouldStop(rs.guard, input.deps.now(), window);
    if (s.stop) {
      if (!rs.guard.stopped) guardStop(rs.guard, s.reason ?? 'stopped');
      rs.status = 'stopped'; rs.stopReason = s.reason;
      emit({ kind: 'stopped', reason: s.reason ?? 'stopped' });
      break;
    }
  }
  await upsertRun(rs.caseId, runRecord(rs, input.deps.now()));
  runs.delete(runId);
  return runId;
}

// Placeholder wired in Task 5; for Task 4 no run scripts an `ask`.
async function awaitAnswer(rs: RunState): Promise<void> {
  await new Promise<void>((resolve) => { rs.pendingAsk = (a: string) => { rs.humanInput = a; rs.pendingAsk = null; resolve(); }; });
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-run investigation-turn` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/run-controller.ts test/investigation-run.test.ts && git commit -m "feat(investigation): SP-6 run loop + lifecycle + registry"`

---

### Task 5: Human control + the blocking `ask`

**Files:**
- Modify: `src/main/investigation/run-controller.ts` (control functions)
- Test: `test/investigation-run-control.test.ts`

**Interfaces:**
- Consumes: the run registry + `RunState` (Task 4), `pause`/`resume`/`stop`/`addToScope`/`removeFromScope` (`./guard`).
- Produces: `pauseRun(runId)`, `resumeRun(runId)`, `stopRun(runId, reason)`, `addScope(runId, target)`, `removeScope(runId, target)`, `focusEntity(runId, entityId)`, `ignoreEntity(runId, entityId)`, `answerRun(runId, text)` — all no-op if the run is unknown.

**Design:** each control looks up `runs.get(runId)?.rs` and mutates via the guard/sets. `answerRun` calls `rs.pendingAsk?.(text)` (resolving the loop's `awaitAnswer`). `stopRun` sets guard.stop + `rs.status='stopped'` AND resolves any pending ask (empty) so a run blocked on `ask` unblocks and finishes.

- [ ] **Step 1: Write the failing test.** `test/investigation-run-control.test.ts` (same mocks; register `whois`):

```ts
// ... same mocks; import startRun/getRunState/__resetRunsForTest + the control fns + guard.isAuthorized ...
import { startRun, answerRun, stopRun, addScope, focusEntity } from '../src/main/investigation/run-controller';
import { isAuthorized } from '../src/main/investigation/guard';

describe('run control', () => {
  it('ask pauses the run; answerRun resumes it with the human text', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'ask', question: 'which target?' }, { kind: 'done', reason: 'finished' }] as never);
    const p = startRun({ caseId: 'cA', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));                // let the loop reach the ask + block
    expect(events.some((x) => x.e.kind === 'ask')).toBe(true);
    const s = getRunStateByAsk();                             // helper: find the live run
    answerRun(s.runId, 'the domain');
    await p;                                                  // run finishes after the answer
    expect(events.some((x) => x.e.kind === 'done')).toBe(true);
  });
  it('addScope authorizes an active target on the live run', async () => {
    // start a run, addScope, assert guard scope updated
    // (uses getRunState to read rs.guard.scope via isAuthorized)
  });
  it('stopRun ends a run blocked on ask', async () => {
    // brain asks and never gets a scripted answer; stopRun unblocks + finishes as stopped
  });
});
```
*(The implementer fleshes out the two stubbed cases with the same live-run pattern: start (don't await), `setImmediate`, act via a control fn, then await the returned promise, asserting the resulting events/state.)*

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-run-control` → FAIL.

- [ ] **Step 3: Implement.** Append the control functions to `run-controller.ts`:

```ts
import { pause, resume, stop as guardStopFn, addToScope, removeFromScope } from './guard';

function rsOf(runId: string): RunState | undefined { return runs.get(runId)?.rs; }

export function pauseRun(runId: string): void { const rs = rsOf(runId); if (rs) pause(rs.guard); }
export function resumeRun(runId: string): void { const rs = rsOf(runId); if (rs) resume(rs.guard); }
export function addScope(runId: string, target: string): void { const rs = rsOf(runId); if (rs) addToScope(rs.guard, target); }
export function removeScope(runId: string, target: string): void { const rs = rsOf(runId); if (rs) removeFromScope(rs.guard, target); }
export function focusEntity(runId: string, entityId: string): void { const rs = rsOf(runId); if (rs) { rs.focus.add(entityId); rs.ignore.delete(entityId); } }
export function ignoreEntity(runId: string, entityId: string): void { const rs = rsOf(runId); if (rs) { rs.ignore.add(entityId); rs.focus.delete(entityId); } }
export function answerRun(runId: string, text: string): void { const rs = rsOf(runId); if (rs) rs.pendingAsk?.(text); }
export function stopRun(runId: string, reason: string): void {
  const rs = rsOf(runId); if (!rs) return;
  guardStopFn(rs.guard, reason); rs.status = 'stopped'; rs.stopReason = reason;
  rs.pendingAsk?.(''); // unblock a run parked on `ask` so the loop can finish
}
```

Note: after `stopRun`, the loop's next `while (rs.status === 'running')` check ends it; a run parked in `awaitAnswer` is released by the empty `pendingAsk('')` and then the loop sees `status !== 'running'`.

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-run-control investigation-run` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/run-controller.ts test/investigation-run-control.test.ts && git commit -m "feat(investigation): SP-6 human control (pause/stop/scope/focus/answer) + blocking ask"`

---

### Task 6: IPC + streaming wiring

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (channels + contracts), `src/main/ipc/register.ts` (handlers + event push), `src/preload/index.ts` + `src/preload/api.d.ts`.
- Test: `test/investigation-run-ipc.test.ts` (a wiring seam test, mirroring `investigation-ipc.test.ts`).

**Interfaces:**
- Consumes: `startRun`/`pauseRun`/`resumeRun`/`stopRun`/`addScope`/`removeScope`/`focusEntity`/`ignoreEntity`/`answerRun` (Tasks 4–5), `ensureUuid` (`../security/validate`).
- Produces: `window.api.investigation.run` = `{ start(caseId, seedIds, objective, budget), pause(runId), resume(runId), stop(runId, reason), addScope(runId, target), removeScope(runId, target), focus(runId, entityId), ignore(runId, entityId), answer(runId, text), onEvent(cb: (p: { runId: string; event: RunEvent }) => void): () => void }`.

- [ ] **Step 1: Write the failing test.** `test/investigation-run-ipc.test.ts` — extract the wiring into a testable `registerInvestigationRunIpc({ handle, sendEvent, validateCaseId })` (mirror `registerInvestigationGraphIpc`) and assert: `run:start` validates `caseId` (rejects a non-UUID via `ensureUuid`), returns a `runId`, and that run events are forwarded to `sendEvent` with `{ runId, event }`. Use a `ScriptedBrain`-backed start via an injected brain factory so the seam runs without an LLM.

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-run-ipc` → FAIL.

- [ ] **Step 3: Implement.** In `ipc-contracts.ts` add `investigation.run` channels (`start`, `pause`, `resume`, `stop`, `addScope`, `removeScope`, `focus`, `ignore`, `answer`, `onEvent`) with typed contracts. In `register.ts`, wire a `registerInvestigationRunIpc({ handle: safeHandle, sendEvent: (p) => getWindow()?.webContents.send(channels.investigation.run.onEvent, p), validateCaseId: (id) => ensureUuid(id, 'caseId') })`; `run:start` calls `startRun` with `deps.emit = (runId, event) => sendEvent({ runId, event })`, `deps.now = () => Date.now()` (the ONE production wall-clock, outside the deterministic loop), and the real reasoning-model brain when subsystem-2 is present — else a guarded error "OSINT investigator plugin not installed". The control channels call the matching control fns with `ensureUuid`-validated ids. In `preload/index.ts` add the `investigation.run` block (invoke for commands; `ipcRenderer.on` for `onEvent`, returning an unsubscribe) and the `api.d.ts` types.

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm test investigation-run-ipc` → PASS; `pnpm typecheck` clean (both configs).

- [ ] **Step 5: Commit.** `git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/investigation-run-ipc.test.ts && git commit -m "feat(investigation): SP-6 IPC — run start/control + event stream"`

---

## Self-Review

**Spec coverage:** §1 harness/brain boundary → Tasks 1 (contracts + stub brain), 6 (real brain injected at the IPC seam). §2 contracts → Task 1. §3 run loop (perceive/decide/dispatch/observe/record-progress/stop) → Task 2 (perceive) + Task 3 (dispatch) + Task 4 (loop + record-progress-every-turn + shouldStop). §4 control + lifecycle + blocking ask → Task 4 (lifecycle/registry/persistence) + Task 5 (control + ask) + Task 6 (IPC). §5 testing (all 10 scenarios) → distributed: happy/budget/no-progress (Task 4), blocked-active/invalid/done (Task 3), ask/human-stop (Task 5), transform-throws (Task 3's try/catch, tested in Task 3), brain-throws (Task 4). Bounded context (Task 2). §7 charter → Global Constraints. §8 out-of-scope (LLM brain internals, SP-7, resume, run-UI) → not built. ✓

**Placeholder scan:** none — all pure/harness code is complete. The two stubbed test *cases* in Task 5 Step 1 have an explicit fill-in note with the exact pattern to follow (a documented test scaffold, not a code placeholder); Task 6's IPC follows the exact `registerInvestigationGraphIpc` pattern already in the tree.

**Type consistency:** `AgentContext`/`AgentAction`/`Brain`/`RunEvent` (Task 1) are used unchanged in Tasks 2–6. `RunState`/`newRunState`/`runOneTurn` (Task 3) are consumed by Task 4's loop and Task 5's controls. `PerceiveInput` fields match what `startRun` passes. `now` is `number` (ms) in the loop/guard, converted to ISO only at the runner/ledger boundary via `new Date(ms).toISOString()`. `startRun` awaits the loop so tests can assert on completion.
