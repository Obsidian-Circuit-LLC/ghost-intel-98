/**
 * Pure training core for the ML corpus pipeline.
 *
 * Constraints:
 * - NO Date.now / Math.random — bit-identical output for identical input.
 * - Thresholds calibrated precision-first at TARGET_RECALL for both classes.
 * - is_soft404_site is evaluation-only and NEVER appears in featureNames
 *   (no label leakage — enforced by the caller).
 */

import type { MlModel } from '../types';
import { fit, predictProba } from './logreg';
import { thresholdForRecall } from './metrics';

/** Default recall target for precision-first threshold calibration. */
const TARGET_RECALL = 0.8;

export interface TrainRow {
  features: number[];
  label: number;
}

/**
 * Train a logistic-regression model on labelled feature rows.
 *
 * Returns a self-describing MlModel with version '3.0.0-corpus'.
 * ml_weight is 1.0 (pure-ML; heuristic_score is a feature, no separate blend).
 *
 * Threshold calibration (precision-first):
 *   thresholds.found     = highest threshold where positive-class recall >= targetRecall.
 *   thresholds.not_found = symmetric mirror on the negative class:
 *                          1 - thresholdForRecall on the inverted problem.
 *
 * targetRecall defaults to TARGET_RECALL (0.8) when called without the argument,
 * but callers SHOULD pass the heuristic's actual achieved recall so that the shipped
 * model thresholds are calibrated at the heuristic's operating point — not at a
 * hardcoded constant that may differ from where the heuristic actually operates.
 *
 * Determinism guarantee: no Math.random / Date.now used anywhere in this call graph.
 * Identical (rows, featureNames, targetRecall) → bit-identical return value.
 */
export function trainModel(
  rows: TrainRow[],
  featureNames: string[],
  targetRecall: number = TARGET_RECALL,
): MlModel {
  const X = rows.map((r) => r.features);
  const y = rows.map((r) => r.label);

  // Fit logistic regression model (deterministic — no RNG).
  const logregModel = fit(X, y);
  const { w, b, mean, scale } = logregModel;

  // Compute in-sample predicted probabilities.
  const probs = rows.map((r) => predictProba(logregModel, r.features));

  // Found threshold: highest threshold where positive-class recall >= targetRecall.
  const foundThreshold = thresholdForRecall(probs, y, targetRecall);

  // Not-found threshold: symmetric — invert probs and labels, find the same
  // kind of recall-meeting threshold for the negative class, then un-invert.
  const invProbs = probs.map((p) => 1 - p);
  const invLabels = y.map((l) => 1 - l);
  const notFoundThreshold = 1 - thresholdForRecall(invProbs, invLabels, targetRecall);

  // Training metadata (recorded for auditing; never used as a feature).
  const positives = y.filter((l) => l === 1).length;
  const negatives = y.filter((l) => l === 0).length;

  return {
    version: '3.0.0-corpus',
    feature_schema: featureNames,
    mean,
    scale,
    coef: w,
    intercept: b,
    ml_weight: 1.0,
    thresholds: {
      found: foundThreshold,
      not_found: notFoundThreshold,
    },
    training: {
      samples: rows.length,
      positives,
      negatives,
    },
  };
}
