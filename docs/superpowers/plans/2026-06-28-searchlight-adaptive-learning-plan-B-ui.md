# Searchlight Adaptive Learning — Plan B (Learning UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Implementers run SEQUENTIALLY on the shared git tree. Steps use `- [ ]`. **Each task's "Files: Create" list is the ONLY source of truth for what to build — the task NUMBER is meaningless; never claim a task is "already done" by matching a number or a similarly-named file from another plan. If a listed Create file does not exist, IMPLEMENT it.**

**Goal:** Build the renderer surface for adaptive learning — a "Learning" tab (status, one clear next action, plain-language verdict, bounded Maybe-queue, train/enable), inline one-click "real/not-real" thumbs on sweep results, and the missing preload bridge — so GhostExodus can label, train, and enable ML from the app.

**Architecture:** A pure `learning-view.ts` view-model (queue/progress/verdict/next-action — unit-tested) drives a `LearningPanel.tsx` that calls `window.api.searchlight.{learningStatus,trainModel,setMlEnabled,labelResult}`. Inline thumbs are added to `SweepPanel` rows. ADHD-friendly: one next action, bounded chunked queue, immediate feedback, plain language, non-nagging.

**Tech Stack:** TypeScript (strict), React renderer, Vitest (renderToStaticMarkup for components). No new dependency.

## Global Constraints

- **Plan A is merged** (the main handlers + IPC channel names + contracts already exist). The preload bridge is the ONLY IPC plumbing missing.
- **Zero new egress.** Pure renderer + IPC to existing local handlers.
- **ADHD-friendly (standing constraint — see [[ghostexodus-adhd-ui]]):** one clear next action at a time; bounded/chunked queue (cap 10), not the full result list; one-click + immediate "labeled" feedback; plain language, never raw precision/recall; visible progress to a milestone; non-nagging (heuristic keeps working if ignored).
- **No silent change.** Enabling ML is the operator's explicit click (`setMlEnabled(true)`); the panel only *recommends* on a passing verdict.
- **98.css cascade:** any new colored element must restate `background` on a CLASS selector (per [[98css-table-white-cascade]]); verify colored badges aren't painted white.
- **Spec:** `docs/superpowers/specs/2026-06-28-searchlight-adaptive-learning-design.md` (Section 2 is the UI). This is Plan B of two; Plan A (engine) is on `main`.
- **Exact handler return shapes (from `register.ts`, verbatim):** `learningStatus()` → `{ labelCount: number; meta: LearningModelMeta | null; mlEnabled: boolean } | null`; `trainModel()` → `{ verdict: { pass: boolean; reason: string }; labelCount: number }`; `setMlEnabled(boolean)` → `{ ok: boolean }`; `labelResult({ resultId, label, siteName, caseId })` → `{ ok: boolean }`. `LearningModelMeta = { trainedAt: number; labelCount: number; verdict: { pass: boolean; reason: string } }`.

## File Structure

| File | Responsibility |
|---|---|
| `src/preload/index.ts` (modify) | expose the 4 learning methods |
| `src/preload/api.d.ts` (modify) | type the 4 methods + import `LearningModelMeta` |
| `src/shared/searchlight/learning-view.ts` (create) | pure view-model: queue, progress, verdict text, next-action |
| `src/renderer/modules/searchlight/panels/LearningPanel.tsx` (create) | the Learning tab |
| `src/renderer/modules/searchlight/SearchlightModule.tsx` (modify) | register the Learning tab |
| `src/renderer/modules/searchlight/panels/SweepPanel.tsx` (modify) | inline real/not-real thumbs |
| `src/renderer/modules/searchlight/searchlight.css` (modify) | `.sl-learning-*` styles |
| `test/searchlight-learning-view.test.ts`, `test/searchlight-learning-panel.test.ts` (create) | TDD |

---

### Task 1: Preload bridge for the 4 learning channels

**Files:** Modify `src/preload/index.ts` (searchlight object, ~line 468), `src/preload/api.d.ts` (GhostApi.searchlight, ~line 540 + import). **The renderer cannot call these until this lands.**

**Interfaces — Produces (renderer-callable):** `window.api.searchlight.labelResult(payload)`, `.learningStatus()`, `.trainModel()`, `.setMlEnabled(enabled)` with the contract return shapes above.

- [ ] **Step 1:** In `src/preload/index.ts` add, inside the `searchlight:` object after the last method:
```typescript
labelResult: (payload: { resultId: string; label: 0 | 1; siteName: string; caseId: string }) =>
  ipcRenderer.invoke(channels.searchlight.labelResult, payload),
learningStatus: () => ipcRenderer.invoke(channels.searchlight.learningStatus),
trainModel: () => ipcRenderer.invoke(channels.searchlight.trainModel),
setMlEnabled: (enabled: boolean) => ipcRenderer.invoke(channels.searchlight.setMlEnabled, enabled),
```
- [ ] **Step 2:** In `src/preload/api.d.ts`, add `LearningModelMeta` to the existing `import type { ... } from '../shared/ipc-contracts'` and add to the `searchlight` interface:
```typescript
labelResult(payload: { resultId: string; label: 0 | 1; siteName: string; caseId: string }): Promise<{ ok: boolean }>;
learningStatus(): Promise<{ labelCount: number; meta: LearningModelMeta | null; mlEnabled: boolean } | null>;
trainModel(): Promise<{ verdict: { pass: boolean; reason: string }; labelCount: number }>;
setMlEnabled(enabled: boolean): Promise<{ ok: boolean }>;
```
- [ ] **Step 3:** `pnpm typecheck` → PASS (proves the bridge types line up with the contracts). **Step 4:** Commit: `feat(searchlight-learning): expose learning IPC in preload bridge`.

---

### Task 2: Learning view-model (pure logic)

**Files:** Create `src/shared/searchlight/learning-view.ts`, `test/searchlight-learning-view.test.ts`.

**Interfaces — Consumes:** `SweepResult`, `LearningModelMeta` (from contracts). **Produces:**
- `MIN_LABELS = 80` (the gate's soft-404 minimum — below this, training can't be evaluated).
- `QUEUE_CAP = 10`.
- `prioritizedQueue(results: SweepResult[], labeled: Set<string>): SweepResult[]` — unlabeled `status === 'maybe'` results, sorted by `probability` descending (strongest candidates first), capped at `QUEUE_CAP`.
- `progress(labelCount: number): { value: number; target: number; pct: number }` — `{ value: labelCount, target: MIN_LABELS, pct: Math.min(100, Math.round(labelCount/MIN_LABELS*100)) }`.
- `LearningState = 'labeling' | 'ready_to_train' | 'ready_to_enable' | 'on' | 'regressed'`.
- `nextAction(status: { labelCount: number; meta: LearningModelMeta | null; mlEnabled: boolean } | null): { state: LearningState; label: string; verdict: string }` — the single-next-action state machine + plain-language verdict (NO raw metrics):
  - null or `labelCount < MIN_LABELS` → `labeling`, "Label results to teach the detector", verdict "Keep labeling — {labelCount}/{MIN_LABELS} until your model can be checked."
  - `labelCount >= MIN_LABELS && (!meta)` → `ready_to_train`, "Train now", verdict "You have enough labels — train to check if your model beats the built-in detector."
  - `meta && meta.verdict.pass && !mlEnabled` → `ready_to_enable`, "Enable — beats the built-in detector", verdict "Your model now beats the built-in detector on your cases."
  - `mlEnabled` → `on`, "On — retrain", verdict "ML is on — beating the built-in detector on your cases."
  - `meta && !meta.verdict.pass` → `regressed` (if mlEnabled was expected) else `ready_to_train`, "Train again", verdict "Not yet — your model doesn't beat the built-in detector. Label more and retrain."

- [ ] **Step 1: Write failing test** `test/searchlight-learning-view.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { prioritizedQueue, progress, nextAction, MIN_LABELS, QUEUE_CAP } from '../src/shared/searchlight/learning-view';
import type { SweepResult } from '../src/shared/searchlight/types';
const r = (id: string, status: SweepResult['status'], probability?: number): SweepResult =>
  ({ id, jobId: 'j', siteName: 'S', username: 'u', url: 'https://s.com/u', statusCode: 200, statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, category: 'x', tags: [], checkType: 'status_code', found: false, confidence: 'medium', status, probability, timestamp: 1 });

it('queue: only unlabeled maybe, sorted by probability desc, capped', () => {
  const results = [r('a','found',0.9), r('b','maybe',0.4), r('c','maybe',0.52), r('d','not_found')];
  const q = prioritizedQueue(results, new Set(['x']));
  expect(q.map(x => x.id)).toEqual(['c','b']); // maybe only, prob desc
  const many = Array.from({length: 20}, (_,i) => r('m'+i,'maybe',i/20));
  expect(prioritizedQueue(many, new Set()).length).toBe(QUEUE_CAP);
});
it('queue excludes already-labeled', () => {
  expect(prioritizedQueue([r('b','maybe',0.4)], new Set(['b']))).toHaveLength(0);
});
it('progress maps to target', () => {
  expect(progress(40)).toEqual({ value: 40, target: MIN_LABELS, pct: 50 });
});
it('nextAction state machine + plain verdict', () => {
  expect(nextAction(null).state).toBe('labeling');
  expect(nextAction({ labelCount: 100, meta: null, mlEnabled: false }).state).toBe('ready_to_train');
  expect(nextAction({ labelCount: 100, meta: { trainedAt: 1, labelCount: 100, verdict: { pass: true, reason: '' } }, mlEnabled: false }).state).toBe('ready_to_enable');
  expect(nextAction({ labelCount: 100, meta: { trainedAt: 1, labelCount: 100, verdict: { pass: true, reason: '' } }, mlEnabled: true }).state).toBe('on');
  const v = nextAction({ labelCount: 100, meta: { trainedAt: 1, labelCount: 100, verdict: { pass: false, reason: 'precision margin' } }, mlEnabled: false });
  expect(v.verdict).not.toMatch(/precision|recall|F1/i); // plain language only
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `learning-view.ts` (pure; no `Date.now`/RNG). **Step 4:** Run → PASS; `pnpm typecheck`. **Step 5:** Commit: `feat(searchlight-learning): pure learning view-model`.

---

### Task 3: LearningPanel component + CSS

**Files:** Create `src/renderer/modules/searchlight/panels/LearningPanel.tsx`, `test/searchlight-learning-panel.test.ts`; modify `src/renderer/modules/searchlight/searchlight.css`.

**Interfaces — Consumes:** `learning-view`, `useSearchlightStore` (for `activeCaseId` + results), `window.api.searchlight`. **Produces:** default-exported `LearningPanel` React component.

**Behavior:** on mount, `learningStatus()` → state. Render: a status header (the `nextAction().verdict` text + a progress bar from `progress()`); ONE primary button labeled `nextAction().label` whose onClick is state-driven (`labeling` → scroll to/show the queue; `ready_to_train`/`regressed` → `trainModel()` then refresh status; `ready_to_enable` → `setMlEnabled(true)` then refresh; `on` → `trainModel()` retrain). Below: the **bounded queue** from `prioritizedQueue(allResults, labeledSet)` — each row shows site + `Math.round(prob*100)%` and the two thumbs (`👍 Real` → `labelResult({resultId:r.id,label:1,siteName:r.siteName,caseId:activeCaseId})` then add r.id to `labeledSet` + refresh status; `👎 Not real` → label 0). Labeled rows drop out of the queue (immediate feedback). Empty queue → a calm "Nothing to review right now — run a sweep, or come back after more results." NO raw metrics anywhere.

- [ ] **Step 1: Write failing test** `test/searchlight-learning-panel.test.ts` — test the component via `react-dom/server` `renderToStaticMarkup` with a mocked `window.api` (mirror `test/searchlight-sweep-badge.test.ts` style). Assert: with `learningStatus` resolving `{labelCount:40,meta:null,mlEnabled:false}` the markup contains the "Label results" action and a progress indicator; with a passing meta + `mlEnabled:false` it contains "Enable"; the markup contains NO "precision"/"recall"/"F1" text. (Mock `useSearchlightStore` to supply an empty results list so the queue is empty.)
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `LearningPanel.tsx` + add the `.sl-learning-*` CSS (root, toolbar, status box, primary button, queue table, thumbs, labeled state, prob badge — backgrounds restated on the class per the cascade rule). **Step 4:** Run → PASS; `pnpm typecheck`. **Step 5:** Commit: `feat(searchlight-learning): LearningPanel + styles`.

---

### Task 4: Register the Learning tab

**Files:** Modify `src/renderer/modules/searchlight/SearchlightModule.tsx`.

- [ ] **Step 1:** Add `'learning'` to the `Tab` union; add `{ key: 'learning', label: 'Learning' }` to `TABS`; add `: tab === 'learning' ? (<LearningPanel />)` to the render switch; import `LearningPanel`.
- [ ] **Step 2:** `pnpm typecheck` → PASS. **Step 3:** If a SearchlightModule render test exists, assert the Learning tab appears; else a focused jsdom test that `TABS` includes `learning`. **Step 4:** Commit: `feat(searchlight-learning): register Learning tab`.

---

### Task 5: Inline real/not-real thumbs on sweep results

**Files:** Modify `src/renderer/modules/searchlight/panels/SweepPanel.tsx`, `src/renderer/modules/searchlight/searchlight.css`.

**Behavior:** in the actions `<td>` of each result row, for `r.status === 'found' || r.status === 'maybe'`, render the two thumbs (`👍`/`👎`) calling `window.api.searchlight.labelResult({ resultId: r.id, label, siteName: r.siteName, caseId: activeCaseId })`. Track a local `labeled: Set<string>` (the panel already has `activeCaseId`); a labeled row's thumbs show the `sl-learning-labeled` struck-through state (immediate feedback). Guard: if `activeCaseId` is null, the thumbs are absent (can't label without a case).

- [ ] **Step 1: Write failing test** — extend the sweep-panel test (or a focused one) asserting that the inline-thumb render branch is taken for a `maybe`/`found` result and not for `not_found` (use the same `renderToStaticMarkup`/helper pattern as the badge test; if testing the full panel is impractical, factor the thumb-cell into a tiny pure `renderThumbCell(r, activeCaseId, labeled)` helper in `sweep-panel-utils.ts` and unit-test that).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (+ reuse the `.sl-learning-thumb`/`-real`/`-fake`/`-labeled` CSS from Task 3). **Step 4:** Run → PASS; `pnpm typecheck`. **Step 5:** Commit: `feat(searchlight-learning): inline label thumbs on sweep results`.

---

### Task 6: Full-suite green + charter + reachability

- [ ] **Step 1:** `pnpm typecheck` + `pnpm build` clean. **Step 2:** `pnpm test` → all green (record count). **Step 3:** Determinism/charter: `grep -rnE "Math\.random\(|Date\.now\(" src/shared/searchlight/learning-view.ts` → empty (pure view-model). **Step 4:** Reachability: confirm the Learning tab is in `TABS` and renders `LearningPanel`; confirm the 4 learning methods exist in BOTH `src/preload/index.ts` and `src/preload/api.d.ts` (`grep -c "labelResult\|learningStatus\|trainModel\|setMlEnabled" src/preload/index.ts src/preload/api.d.ts` ≥ 4 each); confirm inline thumbs call `labelResult`. **Step 5:** Commit any fixes: `test(searchlight-learning): full-suite green + UI reachability`.

---

## Self-Review

- **Spec coverage (Section 2):** Learning tab + status + one-next-action (T3,T4); bounded Maybe-queue (T2,T3); inline thumbs + immediate feedback (T5); plain-language verdict no metrics (T2,T3); progress bar (T2,T3); non-nagging/heuristic-keeps-working (no auto-train, no badges); enable-on-confirm (T3). Preload gap fixed (T1). ✓
- **Confabulation guard:** every task names its exact Create files; the preload gap (T1) is the real new plumbing; no task-number collision with prior plans (all files are net-new renderer/preload). ✓
- **Type consistency:** `learningStatus`/`trainModel`/`setMlEnabled`/`labelResult` shapes match the verbatim handler returns; `LearningModelMeta`, `LearningState`, `prioritizedQueue`/`progress`/`nextAction` consistent T2→T5. ✓
