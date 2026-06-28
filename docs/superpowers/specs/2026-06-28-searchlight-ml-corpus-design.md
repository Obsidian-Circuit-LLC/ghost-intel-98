# Searchlight ML Detection — Ground-Truth Corpus & Retraining Pipeline (Option A)

**Date:** 2026-06-28
**Status:** Approved (design); pending implementation-plan
**Origin:** The v3.23.0 bundled ML model ships off by default — it fails its parity gate, and a seed-only retrain diagnostic showed a fingerprint-free retrain only *ties* the heuristic (F1 ~0.56 ≈ heuristic 0.556). Operator chose **Option A**: make ML a real project — build a proper ground-truth corpus from our own extractor and train a model that genuinely beats the heuristic, or honestly conclude it can't on this problem.

---

## Goal

Build an **offline dev/research pipeline** that curates a soft-404-rich, verified-ground-truth corpus, extracts features with Searchlight's *own* probe, trains a deterministic logistic-regression model (heuristic-as-feature + interaction terms), and decides — on a precision-first gate — whether the model beats the heuristic by enough to ship `useMl` on. If it clears, vendor the new model; if not, expand the corpus once (tier 2) or stop and keep ML off — reported honestly either way.

## Why this shape

The seed diagnostic established three things this design is built around:
1. The model already takes `heuristic_score` as a feature, so it has the heuristic as a **floor** — it can only beat the heuristic by learning the heuristic's **failure modes**, which requires soft-404-rich **ground-truth** labels (not heuristic/consensus labels, which cap the student at the teacher).
2. Raw accuracy is the wrong metric (imbalanced data rewards "always not-found"); the operator's pain is **false FOUNDs** → precision on the "found" class.
3. Don't over-invest before evidence — **tier** the corpus.

## Scope (what this is — and isn't)

- **An offline pipeline**, run on the build host, producing a vendored `model.json`. **No new in-app UI, IPC, or network-egress surface ships.** The app only swaps the bundled model and (if the gate clears) flips the `useMl` default.
- The in-app operator-labeled retrain UI (the original Plan 2 "collect/fit" feature) is **explicitly out of scope** here — it becomes a later "hybrid" refinement.
- Reuses the existing `src/shared/searchlight/signals.ts` + `scorer.ts` extractor **verbatim**, so train-time and infer-time features are identical by construction (the fidelity gap that sank the v3.23.0 port cannot recur).

## Global Constraints

- **Determinism (critical path).** Training fit is full-batch gradient descent, zero-initialized, fixed iteration count, L2-regularized, stable-ordered, **no RNG**. Train/test splits are index-derived (stratified k-fold = index mod k within each class). Identical corpus → bit-identical model. `determinism-auditor` gates `train.mjs`.
- **No label leakage.** `is_soft404_site` is an *evaluation-only* stratifier, **never a model feature**. Labels are independent of our scorer (API/manual verification), never derived from the heuristic or Maigret curated strings.
- **Charter.** Collection is the only egress and is **clearnet to public pages for known handles** (dataset-building, not target investigation); no telemetry; the corpus + intermediate datasets are dev artifacts, not shipped. The shipped app gains no new egress.
- **Reproducible artifacts.** `corpus.csv`, `dataset.csv`, `model.json`, and the eval report are committed (or hash-pinned) so any result is reproducible.
- **Attribution unchanged.** The retrained model supersedes the vendored Aliens_eye model; `THIRD_PARTY_LICENSES` keeps the MIT notice (the schema/approach derive from it).

---

## Architecture — five offline stages

Each stage is a focused script under `scripts/searchlight-ml/` reading/writing CSV/JSON so stages are independently runnable and inspectable.

### 1. Curate → `labels/corpus.csv`
Columns: `username, site, label (0/1), is_soft404_site (0/1), source` (how truth was established).
- **Positives** — handles verified to exist on a site, truth from: site API where available, else manual page-confirmation, else an operator-supplied known-account list. NOT from Maigret curated strings (those are the curated sites we're not targeting).
- **Negatives** — high-entropy never-registered handles (near-certain not-exist); a sample manually confirmed.
- **Soft-404 pre-scan** (`scripts/searchlight-ml/scan-soft404.mjs`) — probe each candidate site once with a known-fake high-entropy handle; a `200` that isn't a profile page tags the site `is_soft404_site=1`. Those sites get **both** a real and a fake handle (the hard labeled pairs) and are oversampled.
- **Target (tier 1):** ~100–200 sites, ~1–2k rows, soft-404-weighted, ~30–40% positive.

### 2. Collect → `data/dataset.csv`
- `scripts/searchlight-ml/collect.mjs` runs each `corpus.csv` row through Searchlight's **real two-phase extractor over clearnet** (imports `extractSignals`/`scoreSignals` from `src/shared/searchlight/`), emitting the **28 base features + the interaction terms + `heuristic_score`**, with `label` and `is_soft404_site` passed through.
- **Tor spot-check** (`scripts/searchlight-ml/transport-check.mjs`) — re-fetch a deterministic sample over the app's Tor SOCKS path; assert no feature beyond `response_time` drifts beyond tolerance, confirming the clearnet corpus is valid for Tor-time inference. Records the drift report.
- Polite collection: concurrency-capped, per-host rate-limited, resumable (skip rows already in `dataset.csv`).

### 3. Train → `model.json`
- `scripts/searchlight-ml/train.mjs`: standardize (mean/scale per feature from training data), fit logistic regression (full-batch GD, zero-init, fixed iters, L2), **no RNG**.
- **Features:** 28 base + interaction terms `heuristic_score × {og_type_profile, has_json_ld_person, error_keyword_count, error_section_count}` (4–6 total). L2 mandatory given ~1–2k samples.
- **Threshold calibration:** precision-first — pick the operating point on the validation PR curve where recall matches the heuristic's, then record `thresholds.found`/`not_found`.
- Output is the same **self-describing `model.json` schema** as today (extended `feature_schema` incl. interaction names; `mean`/`scale`/`coef`/`intercept`/`ml_weight`/`thresholds`/`training` metadata).

### 4. Evaluate → `eval-report.md` (the gate)
- `scripts/searchlight-ml/eval.mjs`: deterministic **stratified 5-fold CV** (folds = index mod 5 within each class). For each fold and pooled: compute **precision / recall / F1 on the "found" class** for (a) heuristic alone and (b) the ML blend, **at matched recall** (ML threshold tuned so `recall_ML ≈ recall_heuristic`), reported **overall AND on the soft-404 subset**. Emit PR curves.
- **GATE (must hold on the CV mean, both overall and soft-404 subset):**
  - `precision_ML ≥ precision_heuristic + 0.05`, AND
  - `F1_ML ≥ F1_heuristic − 0.02`.
- **Sample-size guard:** if the held-out soft-404 subset has `< 80` examples, the soft-404 result is **inconclusive → expand corpus (tier 2)**; a noisy pass is treated as a fail.

### 5. Ship (only if the gate clears)
- Vendor the new `model.json` into `resources/searchlight/`; **wire the shared interaction-feature builder (`features.ts`) into `interpret.ts` so inference computes the same interaction terms `train.mjs` used** (set them on the vector before `predict()`); re-point `test/searchlight-parity.test.ts` at the new model (parity here means "predict reproduces the model's eval-set decisions"); and flip the `searchlight.scorer.useMl` **default to true** in `src/shared/types.ts`.
- If the gate does **not** clear: keep `useMl` off, record the eval report, and either expand to tier 2 or stop — the README/release notes state plainly that ML stays off because it didn't beat the heuristic.

---

## Components / interfaces

- `scripts/searchlight-ml/scan-soft404.mjs` — `corpus.csv (unlabeled sites) → soft404 tags`.
- `scripts/searchlight-ml/collect.mjs` — `corpus.csv → dataset.csv` (via `extractSignals`/`scoreSignals`).
- `scripts/searchlight-ml/transport-check.mjs` — clearnet-vs-Tor feature-drift report on a sample.
- `scripts/searchlight-ml/train.mjs` — `dataset.csv → model.json` (deterministic LR + interactions).
- `scripts/searchlight-ml/eval.mjs` — `dataset.csv + model.json → eval-report.md` + gate verdict.
- `src/shared/searchlight/features.ts` (new, shared) — the interaction-term builder, imported by BOTH collect and the in-app `interpret.ts` so train/infer interaction features are identical (extends the verbatim-extractor guarantee to the interactions).

## Testing

- `test/searchlight-ml-train.test.ts` — fit determinism (identical dataset → bit-identical `coef`/`intercept`); known-separable toy dataset trains to ~100% in-sample.
- `test/searchlight-features.test.ts` — interaction-term builder is pure, deterministic, and produces the named features; matches between the collect path and the interpret path.
- `test/searchlight-eval.test.ts` — precision/recall/F1 + matched-recall threshold selection on a hand-checked fixture; the gate's pass/fail and the soft-404 sample-size guard fire correctly.
- Determinism: rerun train + eval twice on a fixture; outputs identical.

## Risks / honest flags

- **Curation labor** is the dominant cost; verified positives across 100–200 sites need API/manual checks or operator-supplied known-account lists.
- **The model may still not beat the heuristic.** The gate exists to detect exactly this; a negative result is a valid, reported outcome (ML stays off), not a failure to paper over.
- **Small soft-404 subset** → the sample-size guard prevents shipping on noise; tier 2 expansion is the remedy.

## Out of scope

- In-app operator-labeled retrain UI (the deferred "hybrid").
- Non-linear models / per-site fingerprint cache (revisit only if linear + interactions clears the gate and we want more).
