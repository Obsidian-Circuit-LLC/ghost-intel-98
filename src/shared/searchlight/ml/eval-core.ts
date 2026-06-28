/**
 * Pure evaluation core for the ML corpus pipeline.
 *
 * Implements 5-fold stratified cross-validation:
 *   Per fold → train on train-folds → evaluate heuristic + ML on held-out fold →
 *   aggregate means → precision-first gate verdict.
 *
 * Constraints:
 * - NO Date.now / Math.random — fully deterministic.
 * - is_soft404_site is evaluation-only (soft=boolean) and NEVER a model feature.
 * - Reuses trainModel / predictProba / scoreSignals / prf / thresholdForRecall /
 *   stratifiedFolds / gateVerdict verbatim; never reimplements metric logic.
 */

import type { SignalVector } from '../types';
import { trainModel } from './train-core';
import { predictProba, type LogRegModel } from './logreg';
import { scoreSignals } from '../scorer';
import { prf, thresholdForRecall, stratifiedFolds, gateVerdict, type GateArgs } from './metrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single dataset row ready for evaluation (output of the collect pipeline). */
export interface EvalRow {
  /** Raw feature vector (projected from DATASET_COLUMNS). */
  features: number[];
  /**
   * Signal vector for heuristic scoring (reconstructed from the feature columns
   * matching DATASET_COLUMNS base-signal keys).
   */
  vec: SignalVector;
  /** Ground-truth label: 1 = found, 0 = not_found. */
  label: number;
  /** True if this row's site is tagged soft-404-prone (from is_soft404_site column). */
  soft: boolean;
}

/**
 * Aggregated gate inputs: CV-mean precision/recall/F1 for heuristic + ML,
 * plus the total held-out soft-404 count (for the sample-size guard).
 */
export type GateInputs = GateArgs;

/** Return value of evaluate(). */
export interface EvalResult {
  /** Metrics across ALL held-out rows (mean over 5 folds). */
  overall: GateInputs;
  /** Metrics on the soft-404 subset of held-out rows (mean over 5 folds). */
  soft: GateInputs;
  /** Gate verdict — fails if either overall or soft sub-gate fails, or softN < 80. */
  verdict: ReturnType<typeof gateVerdict>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const K_FOLDS = 5;
/**
 * Recall target for precision-first threshold calibration.
 * The heuristic is calibrated at this recall; ML is then calibrated to the
 * same recall so precision is compared at a matched operating point.
 */
const TARGET_RECALL = 0.8;

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

/**
 * Run K-fold stratified CV, compute heuristic vs ML precision/F1 at matched
 * recall on both overall and soft-404 subsets, and return the gate verdict.
 *
 * Pure — NO Date.now / Math.random.
 * Identical (rows, featureNames) → identical EvalResult.
 *
 * @param rows        - Dataset rows with features, signal vec, label, soft flag.
 * @param featureNames - Ordered feature column names (must match rows[i].features length).
 */
export function evaluate(rows: EvalRow[], featureNames: string[]): EvalResult {
  const y = rows.map((r) => r.label);
  const folds = stratifiedFolds(y, K_FOLDS);

  // Per-fold accumulator arrays
  const overallPrecH: number[] = [];
  const overallF1H: number[] = [];
  const overallPrecM: number[] = [];
  const overallF1M: number[] = [];

  const softPrecH: number[] = [];
  const softF1H: number[] = [];
  const softPrecM: number[] = [];
  const softF1M: number[] = [];

  let totalSoftN = 0;

  for (let fold = 0; fold < K_FOLDS; fold++) {
    // Split into train and test subsets
    const trainRows = rows.filter((_, i) => folds[i] !== fold);
    const testRows = rows.filter((_, i) => folds[i] === fold);
    const testY = testRows.map((r) => r.label);

    // Train a model on the training folds (deterministic — no RNG).
    const model = trainModel(
      trainRows.map((r) => ({ features: r.features, label: r.label })),
      featureNames,
    );

    // Reconstruct LogRegModel shape from MlModel for predictProba.
    const logregModel: LogRegModel = {
      w: model.coef,
      b: model.intercept,
      mean: model.mean,
      scale: model.scale,
    };

    // Compute heuristic probabilities on the test fold.
    const hProbs = testRows.map((r) => scoreSignals(r.vec));

    // Compute ML probabilities on the test fold.
    const mlProbs = testRows.map((r) => predictProba(logregModel, r.features));

    // ---- Overall metrics ----

    // Heuristic: find precision-first threshold at TARGET_RECALL, then compute prf.
    const hThresh = thresholdForRecall(hProbs, testY, TARGET_RECALL);
    const hPred = hProbs.map((p) => (p >= hThresh ? 1 : 0));
    const hMetrics = prf(hPred, testY);

    // ML: match the heuristic's achieved recall, then compute prf.
    const mlThresh = thresholdForRecall(mlProbs, testY, hMetrics.recall);
    const mlPred = mlProbs.map((p) => (p >= mlThresh ? 1 : 0));
    const mlMetrics = prf(mlPred, testY);

    overallPrecH.push(hMetrics.precision);
    overallF1H.push(hMetrics.f1);
    overallPrecM.push(mlMetrics.precision);
    overallF1M.push(mlMetrics.f1);

    // ---- Soft-404 subset metrics ----

    const softTest = testRows.filter((r) => r.soft);
    const softCount = softTest.length;
    totalSoftN += softCount;

    if (softCount > 0) {
      const softY = softTest.map((r) => r.label);
      const softHProbs = softTest.map((r) => scoreSignals(r.vec));
      const softMlProbs = softTest.map((r) => predictProba(logregModel, r.features));

      const softHThresh = thresholdForRecall(softHProbs, softY, TARGET_RECALL);
      const softHPred = softHProbs.map((p) => (p >= softHThresh ? 1 : 0));
      const softHMetrics = prf(softHPred, softY);

      const softMlThresh = thresholdForRecall(softMlProbs, softY, softHMetrics.recall);
      const softMlPred = softMlProbs.map((p) => (p >= softMlThresh ? 1 : 0));
      const softMlMetrics = prf(softMlPred, softY);

      softPrecH.push(softHMetrics.precision);
      softF1H.push(softHMetrics.f1);
      softPrecM.push(softMlMetrics.precision);
      softF1M.push(softMlMetrics.f1);
    }
  }

  // Compute cross-fold means.
  const mean = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const overall: GateInputs = {
    precH: mean(overallPrecH),
    f1H: mean(overallF1H),
    precM: mean(overallPrecM),
    f1M: mean(overallF1M),
    softN: totalSoftN,
  };

  const soft: GateInputs = {
    precH: mean(softPrecH),
    f1H: mean(softF1H),
    precM: mean(softPrecM),
    f1M: mean(softF1M),
    softN: totalSoftN,
  };

  // ---- Gate verdict ----
  // Must pass BOTH overall AND soft sub-gates, plus the soft-404 sample-size guard.
  // gateVerdict checks softN first, then precision/F1 margins.
  // Soft gate is checked first — its failures (including size guard) take priority.
  const softVerdict = gateVerdict(soft);
  const overallVerdict = gateVerdict(overall);

  let verdict: ReturnType<typeof gateVerdict>;
  if (!softVerdict.pass) {
    // Soft sub-gate failed (size guard or metric margin) → report soft verdict.
    verdict = softVerdict;
  } else if (!overallVerdict.pass) {
    // Overall sub-gate failed.
    verdict = overallVerdict;
  } else {
    // Both pass.
    verdict = overallVerdict;
  }

  return { overall, soft, verdict };
}
