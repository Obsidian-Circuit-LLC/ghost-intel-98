# SP-6 — Free-Form Orchestrator (Run Harness) — Design

**Date:** 2026-07-05
**Status:** Design (brainstorm complete, all sections approved). Feeds a `writing-plans` implementation plan.
**Belongs to:** the Autonomous OSINT Investigator workstream — sub-project **SP-6** of `2026-07-04-autonomous-osint-investigator-design.md`. The **run harness is core** (buildable/testable in `/dcs98`); the **LLM brain is subsystem-2 (private)**.
**Goal:** Build the deterministic run harness that drives the free-form investigation loop — perceiving the graph, asking an injected `Brain` for the next action, enforcing every rail via the SP-5 guard, running transforms via the SP-2 runner, streaming graph deltas (SP-4), persisting the run, and honoring async human control — so all the merged substrate (SP-1/2/4/5) becomes an actual autonomous investigator.

---

## 1. The harness/brain boundary

SP-6 splits the orchestrator into two pieces along the "rails in core, intelligence in the plugin" line:

- **Core (this spec, in `/dcs98`) — the Run Controller / harness:** owns the loop and therefore owns rail enforcement. It perceives, calls the brain, validates + guards + executes the brain's proposed action, observes the result, and repeats until a stop condition. It contains **no LLM decision-making.**
- **Plugin (subsystem-2, private) — the `Brain`:** the LLM that decides the next action given a bounded context. It implements the injected `Brain` interface; the harness never depends on its internals.
- **Core ships a `ScriptedBrain` stub** (returns a preset action sequence) so the entire harness is testable end-to-end here, today, with no LLM.

**Load-bearing principle:** the brain only *proposes*. The harness *validates* (registered transform? known entity?), runs the proposal through `guard.checkAction`, and executes via the SP-2 runner. A broken, hallucinating, or prompt-injected brain **cannot** run an unregistered transform, exceed budget, touch an out-of-scope target, or fabricate a graph node — those are structurally impossible outside the guard + runner. Autonomy in *what to investigate*; invariants in *what can actually happen*.

**Run shape:** `start(caseId, seeds, objective, budget)` → perceive → `brain.decide` → validate + guard + run → observe (merge to graph, record evidence, update guard) → `guard.shouldStop` → repeat, until budget / scope / no-progress / human-stop → Finish → hand off to the INTELREPORT (SP-7).

## 2. Contracts (shared: `src/shared/investigation-agent.ts`)

Both the core harness and the subsystem-2 brain import these.

**`AgentContext`** — assembled by the harness each turn (the *perceive* step), deliberately **bounded** so it never overflows the model:
- `objective: string`; `seeds: AgentEntity[]`
- `keyEntities: AgentEntity[]` — top-K entities by score (the "what we know" summary)
- `frontier: AgentEntity[]` — entities not yet used as a transform input (worth pivoting from), top-K
- `recentFindings: string[]` — recent evidence-backed claims (last N, from the ledger)
- `budget: { pivotsLeft: number; depthMax: number; wallClockMsLeft: number; tokensLeft: number }`
- `transforms: { id: string; title: string; inputTypes: EntityType[]; active: boolean }[]` — from the SP-2 registry
- `humanInput: string | null` — a pending human message/answer, or null
- `lastError: string | null` — why the previous action was invalid/failed (fed back so the brain self-corrects)

`AgentEntity = { entityId: string; type: EntityType; value: string; role: string; score: number; depth: number }`. `keyEntities`/`frontier` are top-K slices, never the whole graph (context-window management by score/frontier ranking).

**`AgentAction`** — what the brain returns:
```ts
type AgentAction =
  | { kind: 'run-transform'; transformId: string; entityId: string; reasoning?: string }
  | { kind: 'ask'; question: string }
  | { kind: 'done'; reason: string };
```
`reasoning` is streamed to the UI (the "thinking" transparency). **There is deliberately no assert-a-fact action** — the brain can only run transforms (facts + nodes come from their output), ask, or finish; its reasoning is advisory narration, never a graph node or a scored finding. Confidence-scored findings are produced later (SP-7) from the evidence ledger.

**`Brain`** — `interface Brain { decide(ctx: AgentContext): Promise<AgentAction> }`. Stateless from the harness's view (full context each turn); the brain may keep internal history. `ScriptedBrain` (core) returns a preset sequence for deterministic tests.

## 3. The run loop (the harness)

Each turn is one deterministic pass; the only non-determinism is `brain.decide`.

1. **Perceive** — assemble `AgentContext` from the current graph (SP-4 `sceneForCase` → top-K `keyEntities` by score, `frontier` = entities not yet used as a transform input per the ledger), `recentFindings` (ledger), remaining `budget` (guard), available `transforms` (SP-2 registry), pending `humanInput`, `lastError` — honoring the run's focus/ignore sets.
2. **Decide** — `action = await brain.decide(ctx)`; stream `action.reasoning`.
3. **Dispatch by kind:**
   - **`done`** → stop → Finish (reason).
   - **`ask`** → emit the question, `guard.pause`, await the human's chat answer (resolves via IPC), set it as next turn's `humanInput`, resume.
   - **`run-transform`** →
     1. **Validate** (harness): transform registered (`registry.getTransform`)? entity known + input type accepted? If not → set `lastError`, emit, **skip execution**.
     2. **Guard**: build `ProposedAction` (`transformActive` from the descriptor; `entityValue`, `depth`, `estTokens`), `guard.checkAction`. Denied → set `lastError` to the `DenyReason`, emit "⚠ blocked: <reason>", skip.
     3. **Execute**: `runner.runTransform(...)` (SP-2) — merges produced entities + writes evidence (the hallucination guard + provenance, structurally). The ledger append auto-fires the SP-4 emitter → graph delta streams.
     4. **Observe**: `guard.recordAction` (accrue pivots/tokens + mark seen); emit "ran <transform> on <value> → N new entities".
4. **Record progress + check stop** — `guard.recordProgress(currentEntityCount)` **every turn** (so a run stuck on denied/duplicate actions goes stale → `no-progress`); then `guard.shouldStop`. Stop → Finish.
5. **Finish** — update the `InvestigationRun` status + `stopReason` in the ledger; emit run-done; the evidence + graph are ready for SP-7.

**Failure containment:** a transform that throws → caught, recorded as a failed lead, `lastError` set, run continues (one bad transform never kills the run). A brain that throws or returns a malformed action → caught, `lastError` set, next turn — and because progress is recorded every turn, an unproductive brain stalls into `no-progress` (wall-clock is the ultimate backstop). **No infinite loops are possible.**

## 4. Human control & run lifecycle

**Async control surface** — every primitive routes through the SP-5 guard (or the perceive step), callable any time a run is live, over IPC:
- `pause` / `resume` / `stop(reason)` → `guard.pause`/`resume`/`stop`.
- `addScope(target)` / `removeScope(target)` → `guard.addToScope`/`removeFromScope` — the **human-only** authorization for active/attack transforms (the agent path never calls these).
- `answer(text)` → resolves a pending `ask`.
- `focus(entityId)` / `ignore(entityId)` → a per-run set the *perceive* step respects (biases `frontier`) — pure UX steering, no rail impact.

The harness keeps a **run registry** (`runId → { guard, pendingAsk resolver, focus/ignore sets }`); **one active run per case** in v1.

**Lifecycle:** `start(...)` → create the `InvestigationRun` in the SP-2 ledger (status `running`), `createGuard(budget, now)`, register, launch the loop async, return `runId`. On stop/done → `upsertRun` with final status + `stopReason`, unregister. Every action appends a `RunAction` to the run's audit log and its evidence to the ledger → the run is **fully reconstructable**. **Not resumable across app restart in v1** (guard + brain state are in-memory); an interrupted run is marked stopped on next open — resumability is a later refinement.

**Blocking `ask`:** on an `ask` the harness stores a `pendingAsk` promise, emits the question, `guard.pause`s; `answer(runId, text)` resolves it → the loop resumes with `humanInput = text`. If the run is stopped while an ask is pending, it resolves empty and the run ends.

**Streaming** (`investigation:run:onEvent`, mirroring the chat-stream pattern): `thinking`, `action`, `observed`, `blocked(reason)`, `ask`, `paused`/`resumed`, `stopped(reason)`/`done(reason)` — alongside the SP-4 graph deltas on `investigation:onGraphDelta`.

## 5. Testing

Because only the brain is non-deterministic and it's injected, the *entire* harness is testable deterministically with `ScriptedBrain` + a stub transform (SP-2 registry) + the real SP-5 guard + mock secure-fs + injected `now`:

1. **Happy path** — transform → transform → done: entities merged, graph deltas emitted, evidence + `actionLog` in the ledger, status → done.
2. **Out-of-scope active transform blocked** — active transform on an unauthorized target → `guard` blocks (`not-authorized-target`), no execution; after `addScope`, it runs.
3. **Budget stop** · 4. **No-progress stop** (only denied/duplicate actions → stale) · 5. **Invalid action** (unregistered transform → `lastError`, skip, continue) · 6. **Ask/answer** (pause → `answer` resolves → resume) · 7. **Human stop** mid-run · 8. **Transform throws** → failed lead, run continues · 9. **Brain throws** → caught, stalls into `no-progress`.
10. **Bounded context** — `AgentContext.keyEntities`/`frontier` are capped top-K, not the whole graph.

These prove every rail holds under a stub brain — no LLM needed in CI.

## 6. Decomposition (for the plan)

1. **Agent contracts** — `src/shared/investigation-agent.ts` (`AgentContext`/`AgentEntity`/`AgentAction`/`Brain`) + `ScriptedBrain` stub.
2. **Perceive** — assemble the bounded `AgentContext` (top-K key entities + not-yet-expanded frontier from graph + ledger + guard + registry, honoring focus/ignore).
3. **Turn dispatch** — one turn: validate → guard → execute (SP-2 runner) → observe → record. All rail enforcement lives here.
4. **Run loop + lifecycle** — repeat-until-`shouldStop`, `start`/Finish, run registry, `InvestigationRun` persistence.
5. **Human control + `ask`** — pause/resume/stop/scope/focus/answer + the `pendingAsk` mechanism.
6. **IPC + streaming** — `investigation:run:start` / control / `onEvent` channels + preload.

## 7. Charter alignment

Deterministic harness (time via injected `now`; the only non-determinism is the subsystem-2 brain, kept out with `ScriptedBrain` in CI); loopback-only, **no new egress** (transforms reach the network only through the existing Tor-gated runner path); no telemetry; encrypted-at-rest run/evidence via the SP-2 ledger; the hallucination guard + provenance are structural (facts only from transforms). The rails the free-form agent operates within are the SP-5 guard, enforced by the harness outside the LLM.

## 8. Out of scope (SP-6)

The LLM brain itself (subsystem-2): prompt design, the structured-action protocol + repair-retry the brain uses to emit a valid `AgentAction`, the reasoning-model driver (SP-1 runtime), and token estimation. The INTELREPORT deliverable (SP-7). Cross-run resumability. The run-control UI panel (a thin renderer consuming the `onEvent` stream — a follow-on once the harness lands).
