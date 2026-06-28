# Searchlight Adaptive Learning — "Learns Your Casework" Design Spec

**Date:** 2026-06-28
**Status:** Approved (design); pending implementation-plan
**Origin:** The v3.23.0 ML model ships off (a generic model only ties the heuristic, and neither the operator nor a central process can supply verified labels). Pivot: ship the labeling + training **into the app** so GhostExodus's real investigative verdicts become the training signal and the model **adapts locally to his own casework** — fully offline, encrypted, never phoning home.

---

## Goal

An in-app, **local-first adaptive detection model**: GhostExodus labels sweep results "real / not-real" in the flow of triage; the app accumulates an encrypted personal corpus, trains a deterministic local model on demand (his labels + the Aliens_eye seed as bootstrap volume), evaluates it against the heuristic on *his* held-out labels, and — only when it genuinely beats the heuristic — recommends enabling it, which he confirms. The model curates to his investigations over time. The heuristic does the soft-404 job throughout, so he loses nothing while it learns.

## Why this shape (decisions)

1. **Cold start — heuristic-only default + seed as bootstrap volume.** No active ML model ships. The heuristic runs by default. His labels train a local model; the Aliens_eye seed is mixed in *purely as extra volume* to fight early overfit, never trusted as a baseline. ML switches on only after the local model beats the heuristic on his held-out labels.
2. **Labeling — inline one-click thumbs + Maybe-prioritized (active learning).** Explicit labels (quality matters; implicit click-inference is too noisy). A one-click `✓ Real / ✗ Not real` on each result records its feature vector + verdict; the Maybe-band results (least certain) are surfaced/prioritized so scarce labels teach the model fastest.
3. **Train trigger — manual button + non-intrusive new-data nudge.** He clicks "Train"; the app shows exactly what changed. A gentle dismissable nudge appears once enough new labels accumulate. No silent background training.
4. **Enable gate — app evaluates + recommends, he confirms.** After each train the app runs the precision-at-matched-recall gate on his held-out labels and gives a **plain-language verdict** ("beats the built-in detector by +6% on your cases — enable?"). He confirms the flip. A regressing retrain **warns and won't silently persist**. No silent behavior change (operator-authority).

## Global Constraints

- **Zero new network egress.** All labeling, training, and evaluation is local CPU + local encrypted storage. The corpus and model **never leave his machine**; no telemetry. (Strongest charter alignment of any Searchlight feature.)
- **Encrypt-at-rest.** Every store (per-case vectors, global corpus, local model + meta) goes through the existing Searchlight secure-fs (vault). When the vault is locked, labeling/training are gracefully unavailable, like other Searchlight data.
- **Determinism.** Training/eval reuse the merged engine (`train-core`/`eval-core`: full-batch GD, zero-init, fixed iters, folds = index mod k, **no RNG**). Labels are **sorted by `resultId` before training** for stable order → identical corpus yields a bit-identical model and reproducible verdict.
- **Feature parity by construction.** Capture, train, and infer all call the same `rowToFeatures` / `buildInteractionFeatures` — no train/infer drift.
- **No silent behavior change.** ML enablement is his explicit confirm; a worse-than-heuristic retrain never auto-applies.
- **Curated Maigret sites stay authoritative.** Learning only ever touches the uncurated tail the scorer already governs.
- **Trust boundary.** The corpus file is shape-sanitized on load (same discipline as `.gic` import) against a tampered file. New IPC channels update the searchlight exact-set contract test.
- **ADHD-friendly UI (standing constraint — see the operator's UI note):** one clear next action at a time; bounded/chunked worklists not infinite backlogs; one-click + auto-advance; immediate visual feedback; plain language over raw metrics; visible progress to a milestone; non-nagging (ignore-without-consequence). These help every user; they help GhostExodus most.
- **Reuses the merged engine.** `train-core`, `eval-core`, `metrics`, `logreg`, `features`, `rowToFeatures`, and `model-store`'s userData-override hook are consumed as-is.
- **Spec dependency:** builds on `docs/superpowers/specs/2026-06-28-searchlight-ml-corpus-design.md` (the engine) and the v3.23.0 scorer.

---

## Architecture & data flow

1. **Vector capture (sweep time).** The two-phase probe computes each result's feature vector via `rowToFeatures`. Persist it per result into a **per-case** encrypted store `{caseDir}/learning/vectors.bin` (`resultId → {vector, siteName, status, ts}`), so a label can attach to a real vector even if he revisits the case later. This is the one genuinely new data path.
2. **Labeling.** A one-click verdict looks up the result's vector and appends `{resultId, vector, label, siteName, caseId, ts}` to the **global** corpus `userData/searchlight/learning/corpus.bin` (overwrite-by-`resultId`; re-labeling updates).
3. **Train (his button / nudge).** IPC `searchlight:trainModel` → load corpus, mix in the bundled seed as bootstrap volume, run `train-core` (deterministic) → write `userData/searchlight/learning/model.json` + `model-meta.json`.
4. **Eval + gate.** Immediately run `eval-core`/`metrics` — stratified CV on *his* labels — for precision-at-matched-recall vs the heuristic, with the soft-404 sample-size guard. Returns a verdict object.
5. **Enable.** App surfaces the plain-language verdict; on his confirm, `model-store` loads his local model as the override and `useMl` flips on. A regressing retrain warns; the prior good model stays until he acts.

## Components / interfaces

- `src/main/searchlight/learning/vector-store.ts` — per-case capture: `saveVectors(caseId, Map<resultId, CapturedVector>)`, `loadVectors(caseId)`.
- `src/main/searchlight/learning/corpus-store.ts` — global corpus: `appendLabel(entry)`, `loadCorpus()`, `removeLabel(resultId)`, shape-sanitize on load.
- `src/main/searchlight/learning/trainer.ts` — orchestrates `train-core` + seed bootstrap → model + meta; `evaluator.ts` — `eval-core`/`metrics` → verdict. **Seed projection:** the bundled seed CSV is 30 columns (incl. the two fingerprint features); his captured vectors are the 28 base features + interaction terms. The trainer **projects seed rows into his feature space** before mixing — drop the fingerprint columns, compute the interaction terms from the seed's existing base columns (`heuristic_score × og_type_profile`, etc.) — so seed and his labels share one feature schema. Without this projection the feature vectors mismatch and training is invalid.
- IPC (`src/shared/ipc-contracts.ts` + `register.ts`): `searchlight.labelResult`, `searchlight.learningStatus`, `searchlight.trainModel`, `searchlight.setMlEnabled` (+ contract-test update).
- Renderer: `src/renderer/modules/searchlight/panels/LearningPanel.tsx` (the Learning tab) + inline-thumbs additions to `SweepPanel.tsx` + active-learning queue selection (Maybe-band, bounded).

## Testing

- Corpus/vector store round-trip + dedup-by-`resultId` + tampered-file sanitization, through mock secure-fs.
- Vector capture matches `rowToFeatures`; a label attaches to the correct vector.
- Train+eval on a his-corpus fixture: deterministic (identical corpus → identical model); gate + sample-size guard fire; a worse-than-heuristic corpus yields a "don't enable / warn" verdict and never auto-persists.
- Enable flow: confirm → `model-store` loads local model + `useMl` on; regressing retrain doesn't auto-apply.
- LearningPanel state rendering (learning / ready-to-train / passing / on), bounded queue length cap, inline-thumb "labeled" state via jsdom (+ 98.css cascade check on new colored elements).
- Charter gates: no new egress (grep), no `Date.now`/RNG in new pure code, contract exact-set updated, all stores via secure-fs.

## Decomposition — two sequenced plans, one spec

- **Plan A — Engine wiring (headless):** vector capture + corpus store + train/eval IPC + the gate + enable logic. Fully testable without UI; reuses the merged engine.
- **Plan B — Learning UI:** the Learning tab, inline thumbs, the bounded active-learning queue, the nudge/verdict/enable surface (ADHD-friendly). Builds on Plan A.

## Out of scope / future

- Non-linear models / interaction-feature expansion beyond what the engine already builds (revisit only if the linear model plateaus on real data).
- Cross-user / shared models (the model is strictly local and personal by design).
- Auto-enable without confirmation (rejected — operator-authority / no silent change).
