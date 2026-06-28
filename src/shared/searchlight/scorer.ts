/**
 * Heuristic structural scorer — NO Date.now / Math.random.
 * Same input → identical output (determinism invariant).
 *
 * Weights lifted from Aliens_eye detector.py baseline.
 * http_200 and has_username_in_path are adjusted downward from the
 * upstream prose values so a body-less 200 (cheap-signal-only vector)
 * lands in the Maybe band under the model's calibrated thresholds
 * (found=0.5559, not_found=0.3224) — that Maybe verdict is the
 * escalation trigger for the adaptive two-phase probe.
 */

import type { SignalVector } from './types';

/**
 * Aliens_eye sigmoid scale (not re-derived — verbatim from upstream so
 * heuristic_score matches the distribution the model was trained against).
 */
export const SIGMOID_SCALE = 6;

/**
 * Per-signal weights.  All keys are exported so callers can inspect or
 * override via the optional `weights` argument to `scoreSignals`.
 *
 * Adjustment notes (vs. detector.py prose):
 *   - http_200: 5 → 1   (a bare 200 is genuinely ambiguous; must land in
 *                         Maybe band so the adaptive probe fetches the body)
 *   - has_username_in_path: 2 → 0.2  (username is always in the path for
 *                                      Maigret-style URLs; not discriminating
 *                                      without corroborating body signals)
 *
 * Body-signal weights (profile_section_count, positive_keyword_count) are
 * held at the upstream detector.py baseline pending Task 9 parity gate.
 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  http_200: 1,
  http_404: -10,
  http_5xx: -3,
  http_4xx: -2,
  http_3xx: -1,
  og_type_profile: 6,
  has_json_ld_person: 5,
  meta_has_username: 5,
  username_in_canonical: 4,
  profile_section_count: 4,
  error_section_count: -3,
  meta_error_keyword_count: -3,
  meta_positive_keyword_count: 2,
  error_keyword_count: -2,
  positive_keyword_count: 1.5,
  title_has_username: 3,
  has_username_in_path: 0.2,
  has_auth_pattern: -4,
  img_count: 0.1,
  form_count: -0.5,
  input_count: -0.3,
  link_count: 0.02,
  redirect_count: -2,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute a 0..1 heuristic probability from a signal vector.
 *
 * score = sigmoid( Σ weights[k]·(v[k] ?? 0) / SIGMOID_SCALE )
 *
 * Keys absent from `v` contribute zero (not present = neutral for cheap
 * signals; ML layer handles body-signal absence via mean imputation).
 */
export function scoreSignals(
  v: SignalVector,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): number {
  let sum = 0;
  for (const [key, w] of Object.entries(weights)) {
    const val = v[key] ?? 0;
    sum += w * val;
  }
  return sigmoid(sum / SIGMOID_SCALE);
}

/**
 * Map a probability to a status + confidence.
 *
 * Thresholds:
 *   prob >= t.found      → 'found'
 *   prob <  t.notFound   → 'not_found'
 *   otherwise            → 'maybe'
 *
 * Confidence is derived from the distance to the nearest crossed boundary:
 *   > 0.20  → 'high'
 *   < 0.07  → 'low'
 *   else    → 'medium'
 */
export function classify(
  prob: number,
  t: { found: number; notFound: number },
): { status: 'found' | 'maybe' | 'not_found'; confidence: 'high' | 'medium' | 'low' } {
  let status: 'found' | 'maybe' | 'not_found';
  let distance: number;

  if (prob >= t.found) {
    status = 'found';
    distance = prob - t.found;
  } else if (prob < t.notFound) {
    status = 'not_found';
    distance = t.notFound - prob;
  } else {
    status = 'maybe';
    // Distance to the nearest band boundary
    distance = Math.min(t.found - prob, prob - t.notFound);
  }

  let confidence: 'high' | 'medium' | 'low';
  if (distance > 0.2) {
    confidence = 'high';
  } else if (distance < 0.07) {
    confidence = 'low';
  } else {
    confidence = 'medium';
  }

  return { status, confidence };
}
