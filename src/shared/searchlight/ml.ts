/**
 * Logistic-regression ML inference — pure, deterministic.
 * NO Date.now / Math.random — same input → identical output.
 *
 * Ported from Aliens_eye (© 2021 Aaron Thomas, MIT licence).
 * See THIRD_PARTY_LICENSES at the repo root.
 */

import type { MlModel, SignalVector } from './types';

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Run standardized logistic-regression inference.
 *
 * For each feature i in model.feature_schema:
 *   x_i = v[feature_schema[i]] ?? mean[i]   (missing → mean → z=0, neutral)
 *   z_i = (x_i − mean[i]) / scale[i]        (scale=0 guarded → use 1)
 *   accumulate coef[i] * z_i
 *
 * Returns sigmoid(Σ coef[i]·z_i + intercept) ∈ (0, 1).
 */
export function predict(v: SignalVector, m: MlModel): number {
  let sum = 0;
  for (let i = 0; i < m.feature_schema.length; i++) {
    const featureName = m.feature_schema[i];
    const x = v[featureName] !== undefined ? v[featureName] : m.mean[i];
    const s = m.scale[i] === 0 ? 1 : m.scale[i];
    const z = (x - m.mean[i]) / s;
    sum += m.coef[i] * z;
  }
  return sigmoid(sum + m.intercept);
}

/**
 * Blend ML probability and heuristic probability.
 *
 * blend = weight * ml + (1 − weight) * heuristic
 *
 * The weight comes from the model's ml_weight field (e.g. 0.6).
 */
export function blend(ml: number, heuristic: number, weight: number): number {
  return weight * ml + (1 - weight) * heuristic;
}
