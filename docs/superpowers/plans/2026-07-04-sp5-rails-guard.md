# SP-5: Rails / Budget Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic **rails/budget guard** for the Autonomous OSINT Investigator — the standalone enforcement layer the future free-form orchestrator (SP-6) must call so its autonomy is bounded by invariants the model cannot argue with: a hard scope/cost budget, dedup + no-progress stops, and an authorized-target allowlist for active transforms.

**Architecture:** A single `src/main/investigation/guard.ts` module holding a mutable `GuardState` per run and pure decision predicates over it. `checkAction` returns allow/deny for a proposed action; `shouldStop` returns whether the run must end and why. All time enters via caller-supplied `now`/`startedAt` (no `Date.now()` inside), so the guard is fully deterministic and unit-testable in isolation — SP-6 does not need to exist to build or test it.

**Tech Stack:** TypeScript, Electron main process, Vitest. Builds on SP-1/SP-2/SP-4 (merged): `RunBudget` from `src/shared/investigation-types.ts`; the guard is **core** (per the spec's "rails live in core, intelligence lives in the plugin" boundary).

## Global Constraints

- **Determinism (charter, load-bearing here):** the guard MUST be deterministic — **no `Math.random`, no `Date.now()`/`new Date()`** anywhere in `guard.ts`. Wall-clock enters only as caller-supplied `now: number` / `startedAt: number` (ms epoch). Same inputs → same decision, always.
- **Rails already enforced elsewhere (do NOT re-implement):** egress-over-Tor is core `wire-deps`/`tor-egress`; the hallucination guard (graph nodes come only from transform output) and provenance/confidence are SP-2's `runner.ts`/`ledger.ts`/`confidence.ts`. SP-5 enforces **authorized-target (rail 2), budget (rail 3), dedup/no-progress (rail 4)**, and holds the **pause/stop/scope state (rail 5)**.
- **The guard decides; it does not act.** It never runs a transform, never touches the network, never mutates the ledger — it returns allow/deny + stop decisions the orchestrator obeys. No egress, no telemetry.
- **Scope is human-set only.** The guard exposes `addToScope`/`removeFromScope`; the orchestrator wires those to a human-gated control (SP-6). The agent path only *reads* scope via `checkAction`.
- **Commit identity:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; NEVER emit AI-identity trailers. Stage only each task's files; never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/`, or `resources/local-ai/ollama*`.
- **TDD:** failing test → verify fail → minimal impl → verify pass → commit. `pnpm test <file>`; `pnpm typecheck` stays clean (both configs).

## File Structure

- `src/main/investigation/guard.ts` *(NEW)* — the whole guard: `GuardState`, `ProposedAction`, `DenyReason`, `GuardDecision`, `createGuard`, control (`pause`/`resume`/`stop`), budget (`checkBudget`/`recordAction`), dedup (`isDuplicate`), progress (`recordProgress`/`noProgress`), scope (`isAuthorized`/`addToScope`/`removeFromScope`), and the composition (`checkAction`/`shouldStop`).
- Tests *(all NEW)*: `test/investigation-guard-budget.test.ts`, `test/investigation-guard-dedup-progress.test.ts`, `test/investigation-guard-scope.test.ts`, `test/investigation-guard-decide.test.ts`.

**Shared contract (defined in Task 1, used by all):**
```ts
// A single action the orchestrator proposes to take this turn.
export interface ProposedAction {
  transformId: string;
  transformActive: boolean; // TransformDescriptor.active — active transforms touch the target
  entityId: string;
  entityValue: string;      // the target value, for scope matching (host/domain/ip)
  depth: number;            // pivot depth from the seed (0 = seed)
  estTokens: number;        // estimated token cost of this step (0 if unknown)
}
export type DenyReason =
  | 'stopped' | 'paused'
  | 'budget-pivots' | 'budget-depth' | 'budget-wallclock' | 'budget-tokens'
  | 'duplicate' | 'not-authorized-target';
export type GuardDecision = { allow: true } | { allow: false; reason: DenyReason };
```

---

### Task 1: Guard state, control, budget rail

**Files:**
- Create: `src/main/investigation/guard.ts`
- Test: `test/investigation-guard-budget.test.ts`

**Interfaces:**
- Consumes: `RunBudget` (`@shared/investigation-types`).
- Produces: `ProposedAction`, `DenyReason`, `GuardDecision` (types above); `GuardState`; `createGuard(budget, startedAt)`; `pause(g)`, `resume(g)`, `stop(g, reason)`; `checkBudget(g, a, now): DenyReason | null`; `recordAction(g, a, actualTokens)`.

- [ ] **Step 1: Write the failing test.** `test/investigation-guard-budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGuard, checkBudget, recordAction, pause, resume, stop, type ProposedAction } from '../src/main/investigation/guard';

const budget = { maxPivots: 3, maxDepth: 2, maxWallClockMs: 10_000, maxTokens: 1000 };
const act = (o: Partial<ProposedAction> = {}): ProposedAction =>
  ({ transformId: 't', transformActive: false, entityId: 'e', entityValue: 'evil.tld', depth: 0, estTokens: 100, ...o });

describe('guard budget rail', () => {
  it('allows an action within budget (checkBudget returns null)', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act(), 5_000)).toBeNull();
  });
  it('denies once maxPivots is reached', () => {
    const g = createGuard(budget, 0);
    for (let i = 0; i < 3; i++) recordAction(g, act(), 100);
    expect(checkBudget(g, act(), 0)).toBe('budget-pivots');
  });
  it('denies past the wall-clock ceiling', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act(), 10_000)).toBe('budget-wallclock');
  });
  it('denies beyond max depth', () => {
    const g = createGuard(budget, 0);
    expect(checkBudget(g, act({ depth: 3 }), 0)).toBe('budget-depth');
  });
  it('denies when the estimated tokens would exceed the ceiling', () => {
    const g = createGuard(budget, 0);
    recordAction(g, act(), 950);
    expect(checkBudget(g, act({ estTokens: 100 }), 0)).toBe('budget-tokens');
  });
  it('recordAction accrues pivots + tokens deterministically', () => {
    const g = createGuard(budget, 0);
    recordAction(g, act(), 200);
    expect(g.spentPivots).toBe(1);
    expect(g.spentTokens).toBe(200);
  });
  it('pause/resume/stop flip the flags', () => {
    const g = createGuard(budget, 0);
    pause(g); expect(g.paused).toBe(true);
    resume(g); expect(g.paused).toBe(false);
    stop(g, 'user'); expect(g.stopped).toBe(true); expect(g.stopReason).toBe('user');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-guard-budget` → FAIL (module not found).

- [ ] **Step 3: Implement `src/main/investigation/guard.ts`:**

```ts
import type { RunBudget } from '@shared/investigation-types';

export interface ProposedAction {
  transformId: string;
  transformActive: boolean;
  entityId: string;
  entityValue: string;
  depth: number;
  estTokens: number;
}
export type DenyReason =
  | 'stopped' | 'paused'
  | 'budget-pivots' | 'budget-depth' | 'budget-wallclock' | 'budget-tokens'
  | 'duplicate' | 'not-authorized-target';
export type GuardDecision = { allow: true } | { allow: false; reason: DenyReason };

export interface GuardState {
  budget: RunBudget;
  startedAt: number;
  spentPivots: number;
  spentTokens: number;
  seen: Set<string>;       // `${transformId}:${entityId}` — dedup (Task 2)
  scope: Set<string>;      // authorized targets (Task 3)
  paused: boolean;
  stopped: boolean;
  stopReason: string | null;
  progress: number[];      // entity-count history for no-progress (Task 2)
}

export function createGuard(budget: RunBudget, startedAt: number): GuardState {
  return { budget, startedAt, spentPivots: 0, spentTokens: 0, seen: new Set(), scope: new Set(), paused: false, stopped: false, stopReason: null, progress: [] };
}

export function pause(g: GuardState): void { g.paused = true; }
export function resume(g: GuardState): void { g.paused = false; }
export function stop(g: GuardState, reason: string): void { g.stopped = true; g.stopReason = reason; }

/** Budget-only check. Returns the DenyReason or null if within budget. `now` is caller-supplied
 *  (ms epoch) — the ONLY time source, so the guard stays deterministic. */
export function checkBudget(g: GuardState, a: ProposedAction, now: number): DenyReason | null {
  if (now - g.startedAt >= g.budget.maxWallClockMs) return 'budget-wallclock';
  if (g.spentPivots >= g.budget.maxPivots) return 'budget-pivots';
  if (a.depth > g.budget.maxDepth) return 'budget-depth';
  if (g.spentTokens + a.estTokens > g.budget.maxTokens) return 'budget-tokens';
  return null;
}

/** Record an action that was ALLOWED and executed: accrue pivots/tokens and mark it seen (dedup). */
export function recordAction(g: GuardState, a: ProposedAction, actualTokens: number): void {
  g.spentPivots += 1;
  g.spentTokens += actualTokens;
  g.seen.add(`${a.transformId}:${a.entityId}`);
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-guard-budget` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/guard.ts test/investigation-guard-budget.test.ts && git commit -m "feat(investigation): rails guard — state, control, deterministic budget rail"`

---

### Task 2: Dedup + no-progress rail

**Files:**
- Modify: `src/main/investigation/guard.ts`
- Test: `test/investigation-guard-dedup-progress.test.ts`

**Interfaces:**
- Consumes: `GuardState`, `ProposedAction`, `recordAction` (Task 1).
- Produces: `isDuplicate(g, a): boolean`; `recordProgress(g, entityCount)`; `noProgress(g, window): boolean`.

**Design:** `recordAction` already adds `${transformId}:${entityId}` to `seen`; `isDuplicate` checks it. `recordProgress` appends the total entity count after a turn; `noProgress` is true when the last `window` recorded counts are all equal (no new entities for `window` turns) — the tail signal that a free-form run has stalled.

- [ ] **Step 1: Write the failing test.** `test/investigation-guard-dedup-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGuard, recordAction, isDuplicate, recordProgress, noProgress, type ProposedAction } from '../src/main/investigation/guard';

const budget = { maxPivots: 10, maxDepth: 5, maxWallClockMs: 99_999, maxTokens: 99_999 };
const act = (o: Partial<ProposedAction> = {}): ProposedAction =>
  ({ transformId: 'whois', transformActive: false, entityId: 'e1', entityValue: 'evil.tld', depth: 0, estTokens: 0, ...o });

describe('guard dedup + no-progress', () => {
  it('a transform+entity already run is a duplicate; a new pair is not', () => {
    const g = createGuard(budget, 0);
    expect(isDuplicate(g, act())).toBe(false);
    recordAction(g, act(), 0);
    expect(isDuplicate(g, act())).toBe(true);                       // same transform+entity
    expect(isDuplicate(g, act({ entityId: 'e2' }))).toBe(false);    // different entity
    expect(isDuplicate(g, act({ transformId: 'dns' }))).toBe(false);// different transform
  });
  it('noProgress is true when the last N entity counts are unchanged', () => {
    const g = createGuard(budget, 0);
    recordProgress(g, 5); recordProgress(g, 5); recordProgress(g, 5);
    expect(noProgress(g, 3)).toBe(true);
  });
  it('noProgress is false when a recent turn added entities', () => {
    const g = createGuard(budget, 0);
    recordProgress(g, 5); recordProgress(g, 5); recordProgress(g, 6);
    expect(noProgress(g, 3)).toBe(false);
  });
  it('noProgress is false before there are `window` turns of history', () => {
    const g = createGuard(budget, 0);
    recordProgress(g, 5); recordProgress(g, 5);
    expect(noProgress(g, 3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-guard-dedup-progress` → FAIL.

- [ ] **Step 3: Implement.** Append to `src/main/investigation/guard.ts`:

```ts
/** True if this transform+entity pair has already been run — the dedup rail (the model must not
 *  re-pivot the same way). */
export function isDuplicate(g: GuardState, a: ProposedAction): boolean {
  return g.seen.has(`${a.transformId}:${a.entityId}`);
}

/** Record the total entity count observed at the end of a turn (for no-progress detection). */
export function recordProgress(g: GuardState, entityCount: number): void {
  g.progress.push(entityCount);
}

/** True when the last `window` recorded turns produced no new entities (all equal) — the stall
 *  signal for a free-form run. Needs at least `window` turns of history first. */
export function noProgress(g: GuardState, window: number): boolean {
  if (window <= 0 || g.progress.length < window) return false;
  const tail = g.progress.slice(-window);
  return tail.every((c) => c === tail[0]);
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-guard-dedup-progress investigation-guard-budget` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/guard.ts test/investigation-guard-dedup-progress.test.ts && git commit -m "feat(investigation): rails guard — dedup + no-progress detection"`

---

### Task 3: Authorized-target rail + scope management

**Files:**
- Modify: `src/main/investigation/guard.ts`
- Test: `test/investigation-guard-scope.test.ts`

**Interfaces:**
- Consumes: `GuardState`.
- Produces: `isAuthorized(scope, value): boolean`; `addToScope(g, target)`; `removeFromScope(g, target)`.

**Design:** an *active* transform (touches the target directly) may only run against a value the human has put in scope. Matching is exact **or** subdomain — a value is authorized if it equals a scope entry or ends with `.<entry>` (so authorizing `evil.tld` also authorizes `sub.evil.tld`, but never `evil.tld.attacker.com`). Passive transforms ignore scope. Only these setters mutate scope; the agent path never does.

- [ ] **Step 1: Write the failing test.** `test/investigation-guard-scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGuard, isAuthorized, addToScope, removeFromScope } from '../src/main/investigation/guard';

const budget = { maxPivots: 10, maxDepth: 5, maxWallClockMs: 99_999, maxTokens: 99_999 };

describe('guard authorized-target scope', () => {
  it('exact match is authorized; unrelated is not', () => {
    const s = new Set(['evil.tld']);
    expect(isAuthorized(s, 'evil.tld')).toBe(true);
    expect(isAuthorized(s, 'good.tld')).toBe(false);
  });
  it('a subdomain of an authorized domain is authorized, but a lookalike is not', () => {
    const s = new Set(['evil.tld']);
    expect(isAuthorized(s, 'sub.evil.tld')).toBe(true);
    expect(isAuthorized(s, 'evil.tld.attacker.com')).toBe(false); // NOT a subdomain of evil.tld
  });
  it('empty scope authorizes nothing', () => {
    expect(isAuthorized(new Set(), 'evil.tld')).toBe(false);
  });
  it('add/remove mutate the run scope', () => {
    const g = createGuard(budget, 0);
    addToScope(g, 'evil.tld');
    expect(isAuthorized(g.scope, 'evil.tld')).toBe(true);
    removeFromScope(g, 'evil.tld');
    expect(isAuthorized(g.scope, 'evil.tld')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-guard-scope` → FAIL.

- [ ] **Step 3: Implement.** Append to `src/main/investigation/guard.ts`:

```ts
/** Authorized if the value equals an in-scope entry or is a subdomain of one (`x.evil.tld` for
 *  `evil.tld`). Never a lookalike (`evil.tld.attacker.com`). */
export function isAuthorized(scope: Set<string>, value: string): boolean {
  for (const s of scope) {
    if (value === s || value.endsWith(`.${s}`)) return true;
  }
  return false;
}

/** Human-set only: the orchestrator wires these to a human-gated control, never the agent path. */
export function addToScope(g: GuardState, target: string): void { g.scope.add(target); }
export function removeFromScope(g: GuardState, target: string): void { g.scope.delete(target); }
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-guard-scope` → PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/guard.ts test/investigation-guard-scope.test.ts && git commit -m "feat(investigation): rails guard — authorized-target scope allowlist"`

---

### Task 4: `checkAction` + `shouldStop` (composition — the guard's public contract)

**Files:**
- Modify: `src/main/investigation/guard.ts`
- Test: `test/investigation-guard-decide.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `checkAction(g, a, now): GuardDecision`; `shouldStop(g, now, window): { stop: boolean; reason: string | null }`.

**Design:** `checkAction` is what the orchestrator calls before every proposed action — it composes the rails in priority order (stopped → paused → budget → duplicate → authorized-target). `shouldStop` is what it calls each turn to decide whether to end (explicit stop → budget exhausted → no-progress). Both deterministic.

- [ ] **Step 1: Write the failing test.** `test/investigation-guard-decide.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGuard, recordAction, recordProgress, addToScope, stop, pause, checkAction, shouldStop, type ProposedAction } from '../src/main/investigation/guard';

const budget = { maxPivots: 2, maxDepth: 2, maxWallClockMs: 10_000, maxTokens: 1000 };
const act = (o: Partial<ProposedAction> = {}): ProposedAction =>
  ({ transformId: 't', transformActive: false, entityId: 'e1', entityValue: 'evil.tld', depth: 0, estTokens: 100, ...o });

describe('checkAction (composed rails, priority order)', () => {
  it('allows a fresh, in-budget, passive action', () => {
    expect(checkAction(createGuard(budget, 0), act(), 0)).toEqual({ allow: true });
  });
  it('stopped beats everything', () => {
    const g = createGuard(budget, 0); stop(g, 'user');
    expect(checkAction(g, act(), 0)).toEqual({ allow: false, reason: 'stopped' });
  });
  it('paused denies', () => {
    const g = createGuard(budget, 0); pause(g);
    expect(checkAction(g, act(), 0)).toEqual({ allow: false, reason: 'paused' });
  });
  it('a duplicate is denied', () => {
    const g = createGuard(budget, 0); recordAction(g, act(), 100);
    expect(checkAction(g, act(), 0)).toEqual({ allow: false, reason: 'duplicate' });
  });
  it('an ACTIVE transform on an out-of-scope target is denied; in-scope is allowed', () => {
    const g = createGuard(budget, 0);
    expect(checkAction(g, act({ transformActive: true }), 0)).toEqual({ allow: false, reason: 'not-authorized-target' });
    addToScope(g, 'evil.tld');
    expect(checkAction(g, act({ transformActive: true }), 0)).toEqual({ allow: true });
  });
  it('budget denial (pivots) outranks a scope issue', () => {
    const g = createGuard(budget, 0); recordAction(g, act(), 0); recordAction(g, act({ entityId: 'e2' }), 0);
    expect(checkAction(g, act({ entityId: 'e3', transformActive: true }), 0)).toEqual({ allow: false, reason: 'budget-pivots' });
  });
});

describe('shouldStop', () => {
  it('does not stop a fresh run', () => {
    expect(shouldStop(createGuard(budget, 0), 0, 3)).toEqual({ stop: false, reason: null });
  });
  it('stops when explicitly stopped, carrying the reason', () => {
    const g = createGuard(budget, 0); stop(g, 'user');
    expect(shouldStop(g, 0, 3)).toEqual({ stop: true, reason: 'user' });
  });
  it('stops when the pivot budget is exhausted', () => {
    const g = createGuard(budget, 0); recordAction(g, act(), 0); recordAction(g, act({ entityId: 'e2' }), 0);
    expect(shouldStop(g, 0, 3)).toEqual({ stop: true, reason: 'budget-pivots' });
  });
  it('stops on the wall-clock ceiling', () => {
    expect(shouldStop(createGuard(budget, 0), 10_000, 3)).toEqual({ stop: true, reason: 'budget-wallclock' });
  });
  it('stops when the last `window` turns made no progress', () => {
    const g = createGuard(budget, 0); recordProgress(g, 4); recordProgress(g, 4); recordProgress(g, 4);
    expect(shouldStop(g, 0, 3)).toEqual({ stop: true, reason: 'no-progress' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `pnpm test investigation-guard-decide` → FAIL.

- [ ] **Step 3: Implement.** Append to `src/main/investigation/guard.ts`:

```ts
/** The orchestrator calls this before every proposed action. Rails in priority order: an explicit
 *  stop/pause first, then the hard budget, then dedup, then the authorized-target gate for active
 *  transforms. Deterministic (only time source is `now`). */
export function checkAction(g: GuardState, a: ProposedAction, now: number): GuardDecision {
  if (g.stopped) return { allow: false, reason: 'stopped' };
  if (g.paused) return { allow: false, reason: 'paused' };
  const b = checkBudget(g, a, now);
  if (b) return { allow: false, reason: b };
  if (isDuplicate(g, a)) return { allow: false, reason: 'duplicate' };
  if (a.transformActive && !isAuthorized(g.scope, a.entityValue)) return { allow: false, reason: 'not-authorized-target' };
  return { allow: true };
}

/** The orchestrator calls this each turn to decide whether the run must end: explicit stop, then a
 *  hard-budget exhaustion (pivots/wall-clock/tokens), then a `window`-turn no-progress stall. */
export function shouldStop(g: GuardState, now: number, window: number): { stop: boolean; reason: string | null } {
  if (g.stopped) return { stop: true, reason: g.stopReason };
  if (now - g.startedAt >= g.budget.maxWallClockMs) return { stop: true, reason: 'budget-wallclock' };
  if (g.spentPivots >= g.budget.maxPivots) return { stop: true, reason: 'budget-pivots' };
  if (g.spentTokens >= g.budget.maxTokens) return { stop: true, reason: 'budget-tokens' };
  if (noProgress(g, window)) return { stop: true, reason: 'no-progress' };
  return { stop: false, reason: null };
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm test investigation-guard-decide` → PASS; then the whole guard suite: `pnpm test investigation-guard-budget investigation-guard-dedup-progress investigation-guard-scope investigation-guard-decide` → all PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit.** `git add src/main/investigation/guard.ts test/investigation-guard-decide.test.ts && git commit -m "feat(investigation): rails guard — checkAction + shouldStop composition (SP-5 complete)"`

---

## Self-Review

**Spec coverage (whole-vision §6 rails + §10 SP-5):**
- Rail 2 authorized-target → Task 3 (`isAuthorized` + scope) + Task 4 (`checkAction` active gate). ✓
- Rail 3 budget (pivots/depth/wall-clock/tokens, hard-stop) → Task 1 (`checkBudget`/`recordAction`) + Task 4 (`shouldStop`). ✓
- Rail 4 dedup + no-progress → Task 2 + Task 4. ✓
- Rail 5 pause/stop/scope state → Task 1 (`pause`/`resume`/`stop`) + Task 3 (scope). ✓
- Rails 1/6/7 (egress, hallucination guard, provenance) → **out of scope, enforced by core Tor-egress + SP-2 runner/ledger** (stated in Global Constraints — not re-implemented). ✓
- "Standalone, testable in isolation" → the module is pure state + predicates, no orchestrator dependency; every rail has its own test file. ✓

**Placeholder scan:** none — every code step is complete. The one deferred item is the subdomain-only scope match (documented as v1 in Task 3), not a placeholder.

**Type consistency:** `ProposedAction`, `DenyReason`, `GuardDecision`, `GuardState` (Task 1) are used unchanged in Tasks 2–4. `seen`/`scope`/`progress` fields declared in Task 1's `GuardState` are populated by Task 2/3's functions and read by Task 4's composition. `now`/`startedAt` are `number` (ms epoch) throughout; no `Date.now()` anywhere.

**Not in scope (correctly deferred to SP-6):** wiring the guard into the orchestrator loop, the human-veto IPC/UI, and the token-estimation source. SP-5 delivers the guard the orchestrator will call.
