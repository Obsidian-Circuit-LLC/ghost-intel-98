# Searchlight Adaptive Learning — Plan A (Engine Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Implementers run SEQUENTIALLY on the shared git tree. Steps use `- [ ]` checkboxes.

**Goal:** Build the headless main-process layer that captures per-result feature vectors at sweep time, accumulates an encrypted personal label corpus, trains a deterministic local model (his labels + the seed as bootstrap volume, projected into one feature space), evaluates it against the heuristic on his held-out labels via the merged engine's gate, and enables ML only on a passing verdict — with regression protection. No UI (that's Plan B).

**Architecture:** New main-process modules under `src/main/searchlight/learning/` plus a `model-store` userData-override, all reusing the merged engine (`train-core`/`eval-core`/`metrics`/`collect-core`/`features`) verbatim. Vector capture threads a callback through `runSweep`. Four new IPC channels surface label/train/status/enable. Everything persists via secure-fs (encrypted at rest); zero new network egress.

**Tech Stack:** TypeScript (strict), Electron main, Vitest. No new runtime dependency.

## Global Constraints

- **Zero new network egress.** All work is local CPU + secure-fs storage. The corpus/model never leave the machine; no telemetry.
- **Encrypt-at-rest.** Every store uses `secureReadFile`/`secureWriteFile` (`src/main/storage/secure-fs.ts`); they throw `EVAULTLOCKED` when the vault is locked — callers surface that, never plaintext-fallback.
- **Determinism.** Training/eval reuse the merged engine (no RNG). **Sort corpus rows by `resultId` before train/eval** so order is stable → identical corpus yields a bit-identical model + reproducible verdict.
- **Feature parity by construction.** Capture, train, and infer all use `rowToFeatures`/`DATASET_COLUMNS` from `collect-core.ts` — never reimplement feature logic.
- **No label leakage / no silent change.** `soft` is an eval-only stratifier; ML enablement only flips on a passing verdict via an explicit handler; a regressing retrain warns and does not auto-apply.
- **Gate (from the merged engine):** `gateVerdict` passes iff `softN >= 80 && precM >= precH + 0.05 && f1M >= f1H - 0.02`.
- **Contract:** new channels update `test/searchlight-contracts.test.ts`'s exact-set assertion.
- **Spec:** `docs/superpowers/specs/2026-06-28-searchlight-adaptive-learning-design.md`. This is Plan A of two; the Learning UI is Plan B.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/searchlight/model-store.ts` (modify) | add `userDataModelPath()`, `setModelOverride(m\|null)`, override-first `getModel()` |
| `src/main/searchlight/learning/paths.ts` (create) | `learningDir()`, `vectorsFile(caseId)`, `corpusFile()`, `seedFile()` |
| `src/main/searchlight/learning/vector-store.ts` (create) | per-case captured vectors: save/load |
| `src/main/searchlight/learning/corpus-store.ts` (create) | global label corpus: append/load/remove + sanitize |
| `src/main/searchlight/learning/seed.ts` (create) | load bundled seed + project into the app's feature space |
| `src/main/searchlight/learning/trainer.ts` (create) | corpus + seed → `trainModel` → model + meta + `setModelOverride` |
| `src/main/searchlight/learning/evaluator.ts` (create) | corpus → `evaluate` → verdict |
| `src/main/searchlight/sweep.ts` (modify) | capture `rowToFeatures` vector for found/maybe results via a callback |
| `src/shared/ipc-contracts.ts` (modify) | 4 channels + contracts |
| `src/main/ipc/register.ts` (modify) | handlers + wire capture + enable/regression |
| `resources/searchlight/seed_dataset.csv` (create) | bundled full Aliens_eye seed (MIT) |
| `test/searchlight-learning-*.test.ts` (create) | TDD |

---

### Task 1: model-store userData override

**Files:** Modify `src/main/searchlight/model-store.ts`; create `test/searchlight-model-override.test.ts`.

**Interfaces — Produces:** `userDataModelPath(): string` = `join(app.getPath('userData'),'searchlight','learning','model.json')`; `setModelOverride(m: MlModel | null): Promise<void>` (writes via `secureWriteFile`, or removes the override file + clears cache when `null`); `clearModelCache(): void`; `getModel()` now returns the override (userData model) when present, else the vendored model. Keep `parseModel` exported and pure.

- [ ] **Step 1: Write failing test** — `parseModel` round-trips a valid `MlModel`; an in-memory override set via the cache takes precedence. Use a pure helper `pickModel(override: MlModel | null, vendored: MlModel | null): MlModel | null` (override ?? vendored) so precedence is unit-testable without Electron:
```typescript
import { pickModel } from '../src/main/searchlight/model-store';
it('override wins over vendored', () => {
  const o = { version: 'local' } as any, v = { version: 'vendored' } as any;
  expect(pickModel(o, v).version).toBe('local');
  expect(pickModel(null, v).version).toBe('vendored');
  expect(pickModel(null, null)).toBeNull();
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Add `pickModel`, `userDataModelPath`, `setModelOverride` (deferred `require('electron')` like the existing `getModel`), an override cache, and route `getModel()` through `pickModel(loadOverride(), loadVendored())`. **Step 4:** Run → PASS; `pnpm typecheck`. **Step 5:** Commit: `feat(searchlight-learning): model-store userData override`.

---

### Task 2: learning paths + seed bundling

**Files:** Create `src/main/searchlight/learning/paths.ts`, `resources/searchlight/seed_dataset.csv`; test `test/searchlight-learning-paths.test.ts`.

**Interfaces — Produces:** `learningDir()` = `join(userData,'searchlight','learning')`; `vectorsFile(caseId)` = `join(learningDir(),'vectors', encodeURIComponent(caseId)+'.bin')`; `corpusFile()` = `join(learningDir(),'corpus.bin')`; `seedFile()` resolves the bundled `seed_dataset.csv` under `process.resourcesPath`/`searchlight` (packaged) or `resources/searchlight` (dev), mirroring `model-store.getModel`'s resolution.

- [ ] **Step 1:** Fetch the full seed: `curl -sL https://raw.githubusercontent.com/arxhr007/Aliens_eye/main/src/aliens_eye/data/seed_dataset.csv -o resources/searchlight/seed_dataset.csv`; verify it has 369 lines (368 rows + header) and the 31-column header ending `,heuristic_score,label`. (MIT; attribution already in `THIRD_PARTY_LICENSES`.)
- [ ] **Step 2: Write failing test** — `paths.ts` builds the expected suffixes (assert `vectorsFile('a/b').endsWith('vectors/a%2Fb.bin')`, `corpusFile().endsWith('learning/corpus.bin')`). Use a pure `vectorsLeaf(caseId)`/`corpusLeaf()` if needed to test without Electron paths.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement `paths.ts`. Run → PASS. **Step 5:** Commit: `feat(searchlight-learning): learning paths + bundle full seed`.

---

### Task 3: seed projection into the app feature space

**Files:** Create `src/main/searchlight/learning/seed.ts`; test `test/searchlight-learning-seed.test.ts`.

**Interfaces — Consumes:** `parseCsv` (ml/csv.ts), `DATASET_COLUMNS`, `INTERACTION_KEYS`. **Produces:** `projectSeedRow(row: Record<string,string>): { features: number[]; vec: SignalVector; label: number; soft: boolean }` — the seed CSV has the 31 raw columns (incl. the 2 fingerprint cols, NOT the interaction cols). Build a `SignalVector` from the seed's base columns (the 27 base names that exist in both DATASET_COLUMNS and the seed header) + `heuristic_score`, **compute the interaction terms** (`heuristic_x_og_type = heuristic_score * og_type_profile`, etc. per `INTERACTION_KEYS`), then `features = DATASET_COLUMNS.map(c => vec[c] ?? 0)`. `label = Number(row.label) >= 0.5 ? 1 : 0`. `soft = Number(row.http_200) === 1`. `loadSeedRows(csvText): EvalRow[]` maps all rows.

- [ ] **Step 1: Failing test** with a one-row CSV fixture: assert the projected `features.length === DATASET_COLUMNS.length`, the fingerprint columns are absent from `vec`, and `heuristic_x_og_type === vec.heuristic_score * vec.og_type_profile`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-learning): project seed rows into app feature space`.

---

### Task 4: vector-store (per-case captured vectors)

**Files:** Create `src/main/searchlight/learning/vector-store.ts`; test `test/searchlight-learning-vector-store.test.ts`.

**Interfaces — Consumes:** `secureReadFile`/`secureWriteFile`, `vectorsFile`. **Produces:** `CapturedVector = { resultId: string; features: number[]; soft: boolean; siteName: string; status: string }`; `saveVectors(caseId: string, vectors: CapturedVector[]): Promise<void>` (merge-by-resultId then write JSON via secureWriteFile); `loadVectors(caseId: string): Promise<CapturedVector[]>` (return `[]` on ENOENT; rethrow EVAULTLOCKED). Inject the fs functions for testability: `saveVectors(caseId, vectors, io = { read: secureReadFile, write: secureWriteFile })`.

- [ ] **Step 1: Failing test** with a mock `io` (in-memory map): save 2 vectors, save 1 more with a duplicate resultId → load returns 2 (deduped, latest wins). ENOENT read → `[]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-learning): per-case vector store`.

---

### Task 5: corpus-store (global labels)

**Files:** Create `src/main/searchlight/learning/corpus-store.ts`; test `test/searchlight-learning-corpus-store.test.ts`.

**Interfaces — Produces:** `LabelEntry = { resultId: string; features: number[]; label: 0 | 1; soft: boolean; siteName: string; caseId: string; ts: number }`; `appendLabel(entry, io?)`, `removeLabel(resultId, io?)`, `loadCorpus(io?): Promise<LabelEntry[]>` — load **sanitizes**: drop any entry missing a string `resultId` / numeric `features` array / `label` in {0,1}; coerce types; never throw on a malformed file (return the valid subset). Overwrite-by-`resultId` on append.

- [ ] **Step 1: Failing test**: append 2, append a dup resultId (overwrites), `loadCorpus` returns 2 sorted by resultId; a tampered file with one bad entry (label `"x"`, missing features) loads only the valid entries, no throw; `removeLabel` drops one.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-learning): global label corpus store (sanitized)`.

---

### Task 6: trainer (corpus + seed → model + meta + override)

**Files:** Create `src/main/searchlight/learning/trainer.ts`; test `test/searchlight-learning-trainer.test.ts`.

**Interfaces — Consumes:** `loadCorpus`, `loadSeedRows`, `trainModel`, `DATASET_COLUMNS`, `setModelOverride`. **Produces:** `LearningModelMeta = { trainedAt: number; labelCount: number; verdict: { pass: boolean; reason: string } }`; `buildTrainRows(corpus: LabelEntry[], seed: EvalRow[]): TrainRow[]` — sort corpus by `resultId`, map each to `{ features, label }`, concat the seed's `{features,label}` (seed as bootstrap volume). `trainFromCorpus(corpus, seed): MlModel` = `trainModel(buildTrainRows(corpus, seed), DATASET_COLUMNS)`. (The handler in Task 9 calls these + `setModelOverride` + writes meta; this task is the pure core.)

- [ ] **Step 1: Failing test**: `buildTrainRows` sorts by resultId + appends seed (assert count = corpus + seed, corpus order stable); `trainFromCorpus` on a separable fixture is deterministic (`toEqual` on two runs) and returns a model whose `feature_schema === DATASET_COLUMNS`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-learning): deterministic trainer (corpus + seed bootstrap)`.

---

### Task 7: evaluator (corpus → verdict)

**Files:** Create `src/main/searchlight/learning/evaluator.ts`; test `test/searchlight-learning-evaluator.test.ts`.

**Interfaces — Consumes:** `evaluate` (eval-core.ts — confirm its `EvalRow` shape is `{ features: number[]; vec: SignalVector; label: number; soft: boolean }`), `DATASET_COLUMNS`. **Produces:** `evalFromCorpus(corpus: LabelEntry[], seed: EvalRow[]): EvalResult` — build `EvalRow[]` from corpus (`features`, reconstruct `vec` from `DATASET_COLUMNS`↔`features`, `label`, `soft`) **plus the seed rows** (so held-out folds have enough soft samples), sort by resultId, call `evaluate(rows, DATASET_COLUMNS)`. Returns the `{ overall, soft, verdict, perFold }`.

- [ ] **Step 1: Failing test**: on a fixture where ML clearly beats a weak heuristic column with ≥80 soft rows → `verdict.pass === true`; with `< 80` soft rows → `pass === false` (inconclusive). Deterministic.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-learning): evaluator + gate verdict from corpus`.

---

### Task 8: sweep-time vector capture

**Files:** Modify `src/main/searchlight/sweep.ts`; extend `test/searchlight-sweep.test.ts`.

**Interfaces — Consumes:** `rowToFeatures`. **Produces:** `RunSweepArgs` gains `captureVector?: (v: CapturedVector) => void`. In the worker, after building the emitted `SweepResult`, **for results with `status === 'found' || status === 'maybe'`**, call `args.captureVector?.({ resultId: <the emitted result.id>, features: zeroFill-ordered numbers from rowToFeatures(site, raw, url), soft: raw.statusCode === 200, siteName: site.name, status: interp.status })`. (Only the labelable candidates are captured → bounded storage; the model's job is real-vs-false-positive among candidates.)

- [ ] **Step 1: Failing test** (mock probe): a found result triggers `captureVector` once with matching `resultId` + `features.length === DATASET_COLUMNS.length`; a `not_found` result does NOT trigger capture; `soft` is true for a 200, false for a 404.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (compute the vector via `rowToFeatures` then `DATASET_COLUMNS.map(c => v[c] ?? 0)`; reuse the emitted result's `id` as `resultId`). **Step 4:** Run → PASS (new + existing sweep tests). **Step 5:** Commit: `feat(searchlight-learning): capture candidate vectors at sweep time`.

---

### Task 9: IPC channels + handlers

**Files:** Modify `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `test/searchlight-contracts.test.ts`.

**Interfaces — Produces channels:** `labelResult: 'searchlight:labelResult'`, `learningStatus: 'searchlight:learningStatus'`, `trainModel: 'searchlight:trainModel'`, `setMlEnabled: 'searchlight:setMlEnabled'`, with contracts: `labelResult` args `[{ caseId: string; resultId: string; label: 0|1 }]` returns `{ ok: boolean }`; `learningStatus` args `[]` returns `{ labelCount: number; meta: LearningModelMeta | null; mlEnabled: boolean }`; `trainModel` args `[]` returns `{ verdict: { pass: boolean; reason: string }; labelCount: number }`; `setMlEnabled` args `[boolean]` returns `{ ok: boolean }`.

- [ ] **Step 1:** Add the 4 channels + contracts. Update `test/searchlight-contracts.test.ts`'s `expected` array to include the 4 names. Run `npx vitest run test/searchlight-contracts.test.ts` → PASS.
- [ ] **Step 2:** In `register.ts`, wire the capture: in `startSweep`'s deps add `captureVector: (v) => slVectorBuffer.push(v)` and on `onDone` flush the buffered vectors to `saveVectors(activeCaseId, buffer)` (the renderer passes the active `caseId` with the sweep start, or use the most-recent; simplest: include `caseId` in the startSweep request and thread it). Implement `labelResult` (load the result's `CapturedVector` from `loadVectors(caseId)`, build a `LabelEntry`, `appendLabel`), `learningStatus` (count corpus + read meta + `settings.searchlight.scorer.useMl`), `trainModel` (Task 10), `setMlEnabled` (update `settings.searchlight.scorer.useMl` via `settingsStore`).
- [ ] **Step 3:** `pnpm typecheck` + `npx vitest run test/searchlight-contracts.test.ts test/x-ipc.test.ts` → PASS. **Step 4:** Commit: `feat(searchlight-learning): IPC channels + label/status/enable handlers`.

---

### Task 10: train handler + enable/regression logic

**Files:** Modify `src/main/ipc/register.ts`; create `src/main/searchlight/learning/orchestrator.ts`; test `test/searchlight-learning-orchestrator.test.ts`.

**Interfaces — Produces (pure-ish core):** `runTrainAndGate(corpus, seed, deps: { train: typeof trainFromCorpus; eval: typeof evalFromCorpus; setOverride: (m: MlModel | null) => Promise<void>; writeMeta: (m: LearningModelMeta) => Promise<void>; wasEnabled: boolean }): Promise<{ verdict; labelCount }>` — train + eval; **if `verdict.pass`** → `setOverride(model)` + writeMeta; **if not pass AND wasEnabled** (a regression) → do NOT overwrite the active model, writeMeta with the failing verdict, leave the prior good model in place; **if not pass and not enabled** → writeMeta only (no override). The `trainModel` handler calls this with real deps.

- [ ] **Step 1: Failing test** with mock deps: passing verdict → `setOverride` called with the model; failing verdict + `wasEnabled:true` → `setOverride` NOT called (regression protected), meta written; failing + `wasEnabled:false` → no override, meta written.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `orchestrator.ts` + wire the `trainModel` handler to it. **Step 4:** Run → PASS; `pnpm typecheck`. **Step 5:** Commit: `feat(searchlight-learning): train+gate orchestrator with regression protection`.

---

### Task 11: Full-suite green + charter gates

- [ ] **Step 1:** `pnpm typecheck` + `pnpm build` clean. **Step 2:** `pnpm test` → all green (record count). **Step 3:** Determinism: `grep -rnE "Math\.random\(|Date\.now\(" src/main/searchlight/learning/` — `Date.now` allowed ONLY for `ts`/`trainedAt` timestamps (not in train/eval math); confirm no RNG. **Step 4:** Egress: confirm `src/main/searchlight/learning/` makes no network call (`grep -rnE "fetch\(|https?\.request|socksDial|connect\(" src/main/searchlight/learning/` → empty); confirm all persistence goes through secure-fs (`grep -rn "secureWriteFile\|secureReadFile" src/main/searchlight/learning/`). **Step 5:** Commit any fixes: `test(searchlight-learning): full-suite green + charter gates`.

---

## Self-Review

- **Spec coverage:** model override (T1), paths+seed bundle (T2), seed projection (T3), vector capture store (T4, T8), label corpus (T5), trainer+seed bootstrap (T6), evaluator+gate (T7), IPC+enable (T9), regression protection (T10), charter gates (T11). The Learning UI is Plan B. ✓
- **Determinism + no-leakage:** sort-by-resultId (T6/T7), `soft` eval-only (T3/T8 never in `features`), engine reuse. ✓
- **No new egress:** all learning modules are local + secure-fs (T11 grep gate). ✓
- **Type consistency:** `CapturedVector`, `LabelEntry`, `EvalRow {features,vec,label,soft}`, `TrainRow {features,label}`, `LearningModelMeta`, `MlModel`, `DATASET_COLUMNS` consistent T1→T10; `EvalRow` shape flagged for confirmation against `eval-core.ts` in T7. ✓
