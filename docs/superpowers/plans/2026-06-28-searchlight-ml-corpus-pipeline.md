# Searchlight ML Corpus & Retraining Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Implementers run SEQUENTIALLY on the shared git tree. Steps use `- [ ]` checkboxes.

**Goal:** Build the offline dev pipeline (pure libs + tsx orchestrator scripts) that collects features via Searchlight's own extractor, trains a deterministic logistic-regression model (heuristic-as-feature + interaction terms), and evaluates it on a precision-at-matched-recall gate vs the heuristic — so we can decide, on evidence, whether ML beats the heuristic on the soft-404 case.

**Architecture:** Pure, vitest-tested TypeScript modules under `src/shared/searchlight/ml/` (logreg, metrics, csv, soft404) plus a shared `features.ts` interaction builder; thin `tsx` orchestrator scripts under `scripts/searchlight-ml/` that do I/O (fetch, file read/write) and call the pure cores. Reuses `signals.ts`/`scorer.ts` verbatim so train-time and infer-time features are identical by construction.

**Tech Stack:** TypeScript (strict), Node, `tsx` (new devDep, to run `.ts` scripts), Vitest. No new runtime/shipped dependency.

## Global Constraints

- **Determinism:** the fit is full-batch gradient descent, zero-initialized, fixed iteration count, L2-regularized, stable-ordered, **NO `Math.random`/`Date.now`** in any pure module. Stratified folds = index mod k within each class. Identical dataset → bit-identical model.
- **No label leakage:** `is_soft404_site` is evaluation-only, NEVER a model feature. Interaction features are `heuristic_score ×` structural signals only.
- **Reuse the extractor verbatim:** collection imports `extractSignals`/`scoreSignals`/`weightedSum` from `src/shared/searchlight/` — never reimplements feature logic.
- **Gate (precision-first):** at matched recall (ML threshold tuned so `recall_ML ≈ recall_heuristic`), require `precision_ML ≥ precision_heuristic + 0.05` AND `F1_ML ≥ F1_heuristic − 0.02`, on the 5-fold CV mean, **both overall and on the soft-404 subset**. Soft-404 held-out subset `< 80` → inconclusive (treated as fail → expand corpus).
- **This plan builds the tooling only.** Curating the real corpus, running collection, and the conditional ship (model swap + `useMl` flip + release) are operational follow-ups, NOT tasks here.
- **Charter:** no telemetry; collection (operational, not in this plan) is clearnet to public pages; the shipped app gains nothing from this plan.
- **Spec:** `docs/superpowers/specs/2026-06-28-searchlight-ml-corpus-design.md`.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/searchlight/features.ts` (create) | `buildInteractionFeatures(v)` — pure; shared by collect + interpret |
| `src/shared/searchlight/ml/csv.ts` (create) | deterministic CSV parse/serialize for corpus + dataset |
| `src/shared/searchlight/ml/logreg.ts` (create) | standardize, deterministic fit (GD+L2), predict |
| `src/shared/searchlight/ml/metrics.ts` (create) | precision/recall/F1, matched-recall threshold, stratified k-fold, gate verdict |
| `src/shared/searchlight/ml/soft404.ts` (create) | classify a known-fake-handle probe → soft-404 site? |
| `scripts/searchlight-ml/collect.ts` (create) | `corpus.csv → dataset.csv` (fetch → extractSignals + interactions) |
| `scripts/searchlight-ml/scan-soft404.ts` (create) | tag sites soft-404-prone |
| `scripts/searchlight-ml/transport-check.ts` (create) | clearnet-vs-Tor feature-drift report |
| `scripts/searchlight-ml/train.ts` (create) | `dataset.csv → model.json` |
| `scripts/searchlight-ml/eval.ts` (create) | 5-fold CV, gate verdict → `eval-report.md` |
| `src/shared/searchlight/interpret.ts` (modify) | set interaction features before `predict()` |
| `package.json` (modify) | add `tsx` devDep + `ml:*` script aliases |
| `test/searchlight-{features,ml-csv,ml-logreg,ml-metrics,ml-soft404,ml-collect}.test.ts` (create) | TDD |

---

### Task 1: Setup + interaction-feature builder (`features.ts`)

**Files:** Modify `package.json`; Create `src/shared/searchlight/features.ts`, `test/searchlight-features.test.ts`.

**Interfaces — Consumes:** `SignalVector`, `weightedSum` (from `scorer.ts`). **Produces:** `INTERACTION_KEYS: string[]` and `buildInteractionFeatures(v: SignalVector): SignalVector` — returns a NEW vector = `v` plus `heuristic_x_og_type`, `heuristic_x_json_ld`, `heuristic_x_error_kw`, `heuristic_x_error_section`, each `= (v.heuristic_score ?? 0) * (v[signal] ?? 0)`. Requires `v.heuristic_score` already set by the caller.

- [ ] **Step 1:** Add `"tsx": "^4.19.0"` to `devDependencies` in `package.json`, and these scripts: `"ml:scan": "tsx scripts/searchlight-ml/scan-soft404.ts"`, `"ml:collect": "tsx scripts/searchlight-ml/collect.ts"`, `"ml:transport": "tsx scripts/searchlight-ml/transport-check.ts"`, `"ml:train": "tsx scripts/searchlight-ml/train.ts"`, `"ml:eval": "tsx scripts/searchlight-ml/eval.ts"`. Run `pnpm install` to add tsx.
- [ ] **Step 2: Write the failing test** `test/searchlight-features.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildInteractionFeatures, INTERACTION_KEYS } from '../src/shared/searchlight/features';

describe('buildInteractionFeatures', () => {
  it('multiplies heuristic_score by each structural signal', () => {
    const v = { heuristic_score: 10, og_type_profile: 1, has_json_ld_person: 0, error_keyword_count: 3, error_section_count: 0 };
    const out = buildInteractionFeatures(v);
    expect(out.heuristic_x_og_type).toBe(10);
    expect(out.heuristic_x_json_ld).toBe(0);
    expect(out.heuristic_x_error_kw).toBe(30);
    expect(out.heuristic_x_error_section).toBe(0);
    expect(out.heuristic_score).toBe(10); // original preserved
  });
  it('treats missing keys as 0 and lists all interaction keys', () => {
    expect(buildInteractionFeatures({}).heuristic_x_og_type).toBe(0);
    expect(INTERACTION_KEYS).toEqual(['heuristic_x_og_type','heuristic_x_json_ld','heuristic_x_error_kw','heuristic_x_error_section']);
  });
  it('is pure (does not mutate input)', () => {
    const v = { heuristic_score: 5 }; buildInteractionFeatures(v); expect(Object.keys(v)).toEqual(['heuristic_score']);
  });
});
```
- [ ] **Step 3:** Run `npx vitest run test/searchlight-features.test.ts` → FAIL. **Step 4:** Implement `features.ts` (pure; `const INTERACTION_KEYS = [...]`; map each to `(v.heuristic_score ?? 0) * (v[signal] ?? 0)` over a fixed `[key, signal]` table; return `{ ...v, ...interactions }`). **Step 5:** Run → PASS. `pnpm typecheck` → PASS.
- [ ] **Step 6:** Commit: `feat(searchlight-ml): tsx setup + interaction-feature builder`.

---

### Task 2: Deterministic CSV I/O (`ml/csv.ts`)

**Files:** Create `src/shared/searchlight/ml/csv.ts`, `test/searchlight-ml-csv.test.ts`.

**Interfaces — Produces:** `parseCsv(text: string): { header: string[]; rows: Record<string, string>[] }`; `toCsv(header: string[], rows: Record<string, string|number>[]): string` (deterministic column order = `header`; `\n` line endings; numbers via `String(n)`; no quoting needed — our data is numeric + simple tokens, reject any field containing `,` or `\n` by throwing).

- [ ] **Step 1: Failing test** `test/searchlight-ml-csv.test.ts`:
```typescript
import { parseCsv, toCsv } from '../src/shared/searchlight/ml/csv';
it('round-trips header + rows deterministically', () => {
  const csv = 'a,b,label\n1,2,0\n3,4,1\n';
  const p = parseCsv(csv);
  expect(p.header).toEqual(['a','b','label']);
  expect(p.rows[1]).toEqual({ a: '3', b: '4', label: '1' });
  expect(toCsv(['a','b','label'], [{a:1,b:2,label:0},{a:3,b:4,label:1}])).toBe(csv);
});
it('throws on a field containing a comma', () => {
  expect(() => toCsv(['x'], [{ x: 'a,b' }])).toThrow();
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (split on `\n`, drop trailing empty line, split on `,`, zip to header). **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-ml): deterministic CSV I/O`.

---

### Task 3: Logistic regression (`ml/logreg.ts`)

**Files:** Create `src/shared/searchlight/ml/logreg.ts`, `test/searchlight-ml-logreg.test.ts`.

**Interfaces — Produces:** `standardize(rows: number[][]): { mean: number[]; scale: number[] }` (population std; `scale=0 → 1`); `fit(X: number[][], y: number[], opts?: { lr?: number; iters?: number; l2?: number }): { w: number[]; b: number; mean: number[]; scale: number[] }` — standardizes internally with full-batch GD (defaults `lr=0.1, iters=3000, l2=0.01`), zero-init, NO RNG; `predictProba(model, row): number` = `sigmoid(Σ ((row_j-mean_j)/scale_j)·w_j + b)`.

- [ ] **Step 1: Failing test** `test/searchlight-ml-logreg.test.ts`:
```typescript
import { fit, predictProba, standardize } from '../src/shared/searchlight/ml/logreg';
it('standardize: mean/scale, scale 0 guarded', () => {
  const { mean, scale } = standardize([[0,5],[2,5]]); expect(mean).toEqual([1,5]); expect(scale[1]).toBe(1);
});
it('learns a separable 1-D boundary', () => {
  const X = [[-2],[-1],[1],[2]], y = [0,0,1,1];
  const m = fit(X, y, { iters: 5000 });
  expect(predictProba(m, [-2])).toBeLessThan(0.5); expect(predictProba(m, [2])).toBeGreaterThan(0.5);
});
it('is deterministic: identical data → identical weights', () => {
  const X = [[-2],[-1],[1],[2]], y = [0,0,1,1];
  expect(fit(X,y)).toEqual(fit(X,y));
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (sigmoid; standardize; GD loop updating `w_j -= lr*(grad_j/n + l2*w_j)`, `b -= lr*(mean residual)`). **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-ml): deterministic logistic regression`.

---

### Task 4: Metrics + gate (`ml/metrics.ts`)

**Files:** Create `src/shared/searchlight/ml/metrics.ts`, `test/searchlight-ml-metrics.test.ts`.

**Interfaces — Produces:** `prf(pred: number[], y: number[]): { precision: number; recall: number; f1: number }` (positive class = 1); `thresholdForRecall(probs: number[], y: number[], targetRecall: number): number` (smallest threshold whose recall ≥ target); `stratifiedFolds(y: number[], k: number): number[]` (fold index per row = running count within its class mod k — deterministic, no RNG); `gateVerdict(args: { precH:number; f1H:number; precM:number; f1M:number; softN:number }): { pass: boolean; reason: string }` (pass iff `precM ≥ precH+0.05 && f1M ≥ f1H-0.02`; if `softN < 80` → `pass:false, reason:'inconclusive: soft-404 subset < 80'`).

- [ ] **Step 1: Failing test** `test/searchlight-ml-metrics.test.ts`:
```typescript
import { prf, thresholdForRecall, stratifiedFolds, gateVerdict } from '../src/shared/searchlight/ml/metrics';
it('prf hand-checked', () => { const m = prf([1,1,0,0],[1,0,1,0]); expect(m.precision).toBeCloseTo(0.5); expect(m.recall).toBeCloseTo(0.5); expect(m.f1).toBeCloseTo(0.5); });
it('thresholdForRecall picks smallest threshold meeting recall', () => { expect(thresholdForRecall([0.9,0.6,0.4,0.1],[1,1,0,0],1.0)).toBeLessThanOrEqual(0.6); });
it('stratifiedFolds balances each class deterministically', () => { const f = stratifiedFolds([1,1,1,0,0,0],3); expect(f).toEqual([0,1,2,0,1,2]); });
it('gate passes on margin, fails on small soft subset', () => {
  expect(gateVerdict({precH:0.5,f1H:0.5,precM:0.56,f1M:0.49,softN:100}).pass).toBe(true);
  expect(gateVerdict({precH:0.5,f1H:0.5,precM:0.7,f1M:0.7,softN:50}).pass).toBe(false);
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-ml): metrics + precision-first gate`.

---

### Task 5: Soft-404 site classifier (`ml/soft404.ts`)

**Files:** Create `src/shared/searchlight/ml/soft404.ts`, `test/searchlight-ml-soft404.test.ts`.

**Interfaces — Consumes:** `RawCheckResult`, `extractSignals` (signals.ts). **Produces:** `isSoft404Site(raw: RawCheckResult, site: MaigretSiteEntry, fakeUrl: string): boolean` — TRUE iff a known-fake handle probe returns `statusCode === 200` with NO profile markers (`extractSignals` gives `og_type_profile=0 && has_json_ld_person=0 && title_has_username=0`). A `404`/redirect/non-200 → false (not soft-404-prone).

- [ ] **Step 1: Failing test** (use the PROFILE/SOFT404 HTML fixtures from `test/searchlight-signals.test.ts`):
```typescript
it('200 + no profile markers → soft-404 site', () => { expect(isSoft404Site(raw({statusCode:200, body:SOFT404}), site(), 'https://s.com/fakehandle')).toBe(true); });
it('clean 404 → not soft-404 site', () => { expect(isSoft404Site(raw({statusCode:404, body:''}), site(), 'https://s.com/fakehandle')).toBe(false); });
it('200 + profile markers → not soft-404 (site actually rendered a profile for a fake handle? treat as non-soft)', () => { expect(isSoft404Site(raw({statusCode:200, body:PROFILE}), site(), 'https://s.com/fakehandle')).toBe(false); });
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement via `extractSignals`. **Step 4:** Run → PASS. **Step 5:** Commit: `feat(searchlight-ml): soft-404 site classifier`.

---

### Task 6: Collect orchestrator (`scripts/searchlight-ml/collect.ts`)

**Files:** Create `scripts/searchlight-ml/collect.ts`, `src/shared/searchlight/ml/collect-core.ts`, `test/searchlight-ml-collect.test.ts`.

**Interfaces — Consumes:** `extractSignals`, `weightedSum`, `buildInteractionFeatures`. **Produces (pure core, the tested part):** `rowToFeatures(site: MaigretSiteEntry, raw: RawCheckResult, targetUrl: string): SignalVector` = `extractSignals` → set `heuristic_score = weightedSum(v)` → `buildInteractionFeatures(v)`. **Produces (DATASET_COLUMNS):** the ordered feature-name list (28 base names + 4 interaction names + `heuristic_score`) used as the dataset CSV header (plus trailing `label`, `is_soft404_site`).

- [ ] **Step 1: Failing test** `test/searchlight-ml-collect.test.ts` for the pure core:
```typescript
import { rowToFeatures, DATASET_COLUMNS } from '../src/shared/searchlight/ml/collect-core';
it('produces base + heuristic_score + interaction features', () => {
  const v = rowToFeatures(site(), raw({ statusCode: 200, body: PROFILE }), 'https://s.com/ghostexodus');
  expect(v.heuristic_score).toBeTypeOf('number');
  expect(v.heuristic_x_og_type).toBe(v.heuristic_score * v.og_type_profile);
  for (const c of DATASET_COLUMNS) expect(v[c]).toBeTypeOf('number');
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `collect-core.ts` (the pure transform + `DATASET_COLUMNS`). Then `collect.ts` (tsx orchestrator): read `corpus.csv` via `parseCsv`; for each row, clearnet-`fetch` the probe URL (GET, 64 KB cap, UA + timeout, no-redirect-follow beyond capturing `location`), build a `RawCheckResult`, call `rowToFeatures`, append `{...features, label, is_soft404_site}` to `dataset.csv` via `toCsv` (header = `DATASET_COLUMNS` + `['label','is_soft404_site']`); **resumable** (skip `(username,site)` already present); concurrency cap 4, per-host ≥1 s spacing. **Step 4:** `npx vitest run test/searchlight-ml-collect.test.ts` → PASS; `pnpm typecheck` → PASS. **Step 5:** Commit: `feat(searchlight-ml): collect orchestrator + pure rowToFeatures`.

---

### Task 7: scan-soft404 + transport-check scripts

**Files:** Create `scripts/searchlight-ml/scan-soft404.ts`, `scripts/searchlight-ml/transport-check.ts`, `src/shared/searchlight/ml/drift.ts`, extend `test/searchlight-ml-metrics.test.ts` (or a new `test/searchlight-ml-drift.test.ts`).

**Interfaces — Produces:** `featureDrift(clearnet: SignalVector, tor: SignalVector, ignore: string[]): { key: string; a: number; b: number }[]` — lists features (excluding `ignore`, e.g. `['response_time']`) that differ beyond a tiny epsilon.

- [ ] **Step 1: Failing test** for `featureDrift`:
```typescript
import { featureDrift } from '../src/shared/searchlight/ml/drift';
it('ignores response_time, flags real drift', () => {
  const d = featureDrift({ og_type_profile:1, response_time:0.1 }, { og_type_profile:0, response_time:9 }, ['response_time']);
  expect(d).toEqual([{ key: 'og_type_profile', a: 1, b: 0 }]);
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `drift.ts`. Then `scan-soft404.ts` (probe each unique site in `corpus.csv` with a fixed high-entropy fake handle → `isSoft404Site` → write `is_soft404_site` back) and `transport-check.ts` (re-fetch a deterministic sample over the app's Tor SOCKS path — reuse `probe` from `src/main/searchlight/probe.ts` with `useTor:true` — and `featureDrift` vs the clearnet dataset row; print a report). **Step 4:** Run drift test → PASS; `pnpm typecheck` → PASS. **Step 5:** Commit: `feat(searchlight-ml): soft-404 scan + transport drift check`.

---

### Task 8: Train orchestrator (`scripts/searchlight-ml/train.ts`)

**Files:** Create `scripts/searchlight-ml/train.ts`, `src/shared/searchlight/ml/train-core.ts`, `test/searchlight-ml-train.test.ts`.

**Interfaces — Consumes:** `fit`, `predictProba`, `thresholdForRecall`, `DATASET_COLUMNS`. **Produces (pure core):** `trainModel(rows: { features: number[]; label: number }[], featureNames: string[]): MlModel` — fits, builds the self-describing `model.json` object (`version:'3.0.0-corpus'`, `feature_schema=featureNames`, `mean`, `scale`, `coef`, `intercept`, `ml_weight:1.0` (pure-ML; heuristic is a feature now, no separate blend), `thresholds` calibrated precision-first via `thresholdForRecall` at the heuristic's recall, `training` metadata).

- [ ] **Step 1: Failing test** `test/searchlight-ml-train.test.ts`:
```typescript
import { trainModel } from '../src/shared/searchlight/ml/train-core';
it('produces a valid self-describing model, deterministically', () => {
  const rows = [{features:[-2],label:0},{features:[-1],label:0},{features:[1],label:1},{features:[2],label:1}];
  const m = trainModel(rows, ['x']);
  expect(m.feature_schema).toEqual(['x']);
  expect(m.coef.length).toBe(1); expect(typeof m.intercept).toBe('number');
  expect(m.thresholds.found).toBeGreaterThan(m.thresholds.not_found);
  expect(trainModel(rows, ['x'])).toEqual(m); // deterministic
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `train-core.ts` (uses `MlModel` type from `ml.ts`), then `train.ts` (read `dataset.csv`, project `DATASET_COLUMNS` → `number[]`, call `trainModel`, write `scripts/searchlight-ml/out/model.json`). **Step 4:** Run → PASS; `pnpm typecheck` → PASS. **Step 5:** Commit: `feat(searchlight-ml): deterministic model training`.

---

### Task 9: Eval orchestrator + gate (`scripts/searchlight-ml/eval.ts`)

**Files:** Create `scripts/searchlight-ml/eval.ts`, `src/shared/searchlight/ml/eval-core.ts`, `test/searchlight-ml-eval.test.ts`.

**Interfaces — Consumes:** `trainModel`, `predictProba`, `scoreSignals`, `prf`, `thresholdForRecall`, `stratifiedFolds`, `gateVerdict`. **Produces (pure core):** `evaluate(rows: { features: number[]; vec: SignalVector; label: number; soft: boolean }[], featureNames: string[]): { overall: GateInputs; soft: GateInputs; verdict: ReturnType<typeof gateVerdict> }` — 5-fold stratified CV: per fold, train on train-folds, on the held-out fold compute heuristic predictions (`scoreSignals(vec)` thresholded at its own matched-recall point) and ML predictions (`predictProba`), at matched recall; aggregate precision/recall/F1 overall and on the `soft` subset; feed the means to `gateVerdict` (soft N = held-out soft count).

- [ ] **Step 1: Failing test** with a small hand-built fixture where ML clearly beats a deliberately-weak heuristic column → assert `verdict.pass === true` and the soft-subset numbers populate; and a fixture with `< 80` soft rows → `pass === false` with the inconclusive reason.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `eval-core.ts`, then `eval.ts` (read `dataset.csv`, build rows incl. reconstructing `vec` from the feature columns, run `evaluate`, write `scripts/searchlight-ml/out/eval-report.md` with the per-fold + mean table and the verdict). **Step 4:** Run → PASS; `pnpm typecheck` → PASS. **Step 5:** Commit: `feat(searchlight-ml): CV evaluation + gate report`.

---

### Task 10: Wire interaction features into inference (`interpret.ts`)

**Files:** Modify `src/shared/searchlight/interpret.ts`; extend `test/searchlight-interpret.test.ts`.

**Interfaces — Consumes:** `buildInteractionFeatures`. **Produces:** in the `useMl` branch, after `v.heuristic_score = weightedSum(v)`, replace `v` with `buildInteractionFeatures(v)` before `predict()`, so inference computes the same interaction features training used. Inert with the current shipped model (its `feature_schema` lacks the interaction names, so `predict` ignores the extra keys) and `useMl` defaults off — but correct and ready for the corpus model.

- [ ] **Step 1: Failing test** — extend interpret tests: with `useMl:true` and a tiny model whose `feature_schema` includes `heuristic_x_og_type`, assert the interaction feature reaches `predict` (e.g. a model with a large positive coef on `heuristic_x_og_type` flips a borderline profile to `found`). **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS (new + all existing interpret tests). **Step 5:** Commit: `feat(searchlight): compute interaction features for ML inference`.

---

### Task 11: Full-suite green + determinism/charter gates

- [ ] **Step 1:** `pnpm typecheck` + `pnpm build` clean. **Step 2:** `pnpm test` → all green (record count). **Step 3:** `grep -rn "Math.random\|Date.now" src/shared/searchlight/ml/ src/shared/searchlight/features.ts` → empty (determinism). **Step 4:** Confirm no `is_soft404_site` in `DATASET_COLUMNS`/`featureNames` (no label leakage): `grep -n "is_soft404_site" src/shared/searchlight/ml/collect-core.ts` shows it only in the trailing label columns, never the feature list. **Step 5:** Commit any fixes: `test(searchlight-ml): full-suite green + determinism/leakage gates`.

---

## Self-Review

- **Spec coverage:** features.ts/interactions (T1, T10), CSV (T2), logreg (T3), metrics+gate (T4), soft404 (T5), collect (T6), scan+transport (T7), train (T8), eval+gate report (T9). Curation, real collection run, and conditional ship are operational (out of plan scope, per spec). ✓
- **No new shipped surface:** only `interpret.ts` interaction wiring ships (inert until a corpus model + `useMl` on); everything else is dev tooling. ✓
- **Determinism + no-leakage:** asserted in T3 (fit), T4 (folds), T11 (grep gates). ✓
- **Type consistency:** `MlModel` reused from `ml.ts`; `SignalVector`/`extractSignals`/`weightedSum`/`buildInteractionFeatures`/`DATASET_COLUMNS` names consistent T1→T10. ✓
