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
// Import from canonical homes so the types are in scope for TrainGateDeps / runTrainAndGate.
import type { LabelEntry } from './corpus-store';
import type { LearningModelMeta } from './trainer';

// ---------------------------------------------------------------------------
// Re-exports from canonical homes (corpus-store.ts and trainer.ts)
// ---------------------------------------------------------------------------

// LabelEntry is canonically defined in corpus-store.ts (Task 5).
export type { LabelEntry } from './corpus-store';
// LearningModelMeta is canonically defined in trainer.ts (Task 6).
export type { LearningModelMeta } from './trainer';

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
