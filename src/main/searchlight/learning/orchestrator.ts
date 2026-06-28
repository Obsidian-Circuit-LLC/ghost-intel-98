/**
 * Train + gate orchestrator for the Searchlight adaptive-learning engine.
 *
 * `runTrainAndGate` is the pure-ish core called by the `searchlight:trainModel`
 * IPC handler (register.ts). All I/O-capable dependencies are injected so the
 * function is unit-testable with mocks and the handler can supply the real
 * implementations (corpus-store, trainer, evaluator, model-store, secure-fs).
 *
 * Regression protection:
 *   A failing retrain when ML was already ENABLED must NOT replace the good
 *   active model. Only a PASSING verdict overwrites the override via setOverride.
 *
 * Constraints:
 *   - No Math.random / no RNG — fully deterministic (train/eval purity is
 *     enforced by train-core.ts / eval-core.ts).
 *   - Date.now() is used ONLY for the `trainedAt` timestamp — never in train/eval
 *     math.
 *   - No network egress — all persistence is via injected deps (secure-fs).
 */

import type { MlModel } from '@shared/searchlight/types';
import type { EvalRow, EvalResult } from '@shared/searchlight/ml/eval-core';

// ---------------------------------------------------------------------------
// Types produced by this module (re-exported for use by trainer.ts / handler)
// ---------------------------------------------------------------------------

/**
 * A single labelled entry in the personal corpus.
 * Produced by corpus-store.ts (Task 5); defined here for inter-module
 * independence until that module is committed and re-exported from there.
 */
export interface LabelEntry {
  /** UUID assigned by the sweep engine to the SweepResult. */
  resultId: string;
  /** Feature vector in DATASET_COLUMNS order. */
  features: number[];
  /** Ground-truth label: 1 = genuine profile found, 0 = false positive. */
  label: 0 | 1;
  /**
   * Soft-404 flag: true when the site returned HTTP 200 for the probe URL.
   * Eval-only stratifier — NEVER placed in the feature vector.
   */
  soft: boolean;
  /** Human-readable site name (e.g. "GitHub"). */
  siteName: string;
  /** ID of the case this label belongs to. */
  caseId: string;
  /** Unix-ms timestamp when the label was recorded. */
  ts: number;
}

/**
 * Metadata persisted alongside the model after each retrain cycle.
 * Written via the `writeMeta` dep regardless of verdict; lets the UI show the
 * latest gate result even when ML is disabled or the retrain failed.
 */
export interface LearningModelMeta {
  /** Unix-ms timestamp of the retrain (Date.now() at call time). */
  trainedAt: number;
  /** Number of user-labelled entries in the corpus at training time. */
  labelCount: number;
  /** Gate verdict from the CV evaluation. */
  verdict: { pass: boolean; reason: string };
}

// ---------------------------------------------------------------------------
// Injected dependency shape
// ---------------------------------------------------------------------------

export interface TrainGateDeps {
  /**
   * trainFromCorpus (Task 6): corpus + seed → MlModel.
   * Deterministic — reuses trainModel / DATASET_COLUMNS verbatim.
   */
  train: (corpus: LabelEntry[], seed: EvalRow[]) => MlModel;

  /**
   * evalFromCorpus (Task 7): corpus + seed → EvalResult.
   * Deterministic — reuses evaluate / DATASET_COLUMNS verbatim.
   */
  eval: (corpus: LabelEntry[], seed: EvalRow[]) => EvalResult;

  /**
   * setModelOverride from model-store.ts (Task 1).
   * Called ONLY when verdict.pass — protects the active model on regression.
   */
  setOverride: (m: MlModel | null) => Promise<void>;

  /**
   * Persist LearningModelMeta after a retrain cycle (always written).
   * Implementation: secureWriteFile(metaPath(), JSON.stringify(meta)).
   */
  writeMeta: (m: LearningModelMeta) => Promise<void>;

  /**
   * Whether the ML scorer is currently enabled in settings.
   * When true and verdict fails, this is a regression — the active model is
   * NOT replaced and a warning should be surfaced by the caller.
   */
  wasEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Core orchestrator
// ---------------------------------------------------------------------------

/**
 * Train a model from corpus + seed, evaluate it against the heuristic, and
 * conditionally apply the override.
 *
 * Returns `{ verdict, labelCount }` for the IPC handler to relay to the renderer.
 *
 * Behaviour matrix:
 *
 * | verdict.pass | wasEnabled | setOverride called? | writeMeta called? |
 * |:---:|:---:|:---:|:---:|
 * | true  | any  | yes (with new model) | yes |
 * | false | true | NO — regression guard | yes |
 * | false | false | NO | yes |
 */
export async function runTrainAndGate(
  corpus: LabelEntry[],
  seed: EvalRow[],
  deps: TrainGateDeps,
): Promise<{ verdict: { pass: boolean; reason: string }; labelCount: number }> {
  const model = deps.train(corpus, seed);
  const evalResult = deps.eval(corpus, seed);
  const { verdict } = evalResult;
  const labelCount = corpus.length;

  const meta: LearningModelMeta = {
    trainedAt: Date.now(), // timestamp only — not used in train/eval math
    labelCount,
    verdict,
  };

  if (verdict.pass) {
    // Gate passed: install the new model and record meta.
    await deps.setOverride(model);
    await deps.writeMeta(meta);
  } else {
    // Gate failed (either regression or first-time fail): write meta only.
    // When wasEnabled is true the caller should surface a regression warning;
    // the active model is preserved by not calling setOverride.
    await deps.writeMeta(meta);
  }

  return { verdict, labelCount };
}
