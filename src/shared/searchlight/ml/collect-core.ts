/**
 * Pure core for the ML corpus collection pipeline.
 *
 * Constraints:
 * - NO Date.now / Math.random — fully deterministic.
 * - Reuses extractSignals / weightedSum / buildInteractionFeatures verbatim;
 *   never reimplements feature logic.
 * - is_soft404_site is an evaluation label and NEVER appears in DATASET_COLUMNS
 *   (no label leakage — the gate is in Global Constraints).
 */

import type { MaigretSiteEntry, RawCheckResult, SignalVector } from '../types';
import { extractSignals } from '../signals';
import { weightedSum } from '../scorer';
import { buildInteractionFeatures, INTERACTION_KEYS } from '../features';

// ---------------------------------------------------------------------------
// DATASET_COLUMNS
//
// Ordered feature-name list used as the CSV header for dataset.csv.
// Includes:
//   1. All computable cheap signals (always present in every row).
//   2. All body signals (present when the probe fetched a body; zero-filled otherwise).
//   3. heuristic_score — the raw weighted sum (not sigmoid-clamped), set after
//      extractSignals so the corpus model trains on the same range as inference.
//   4. Four interaction features: heuristic_score × structural signal.
//
// Trailing evaluation columns (`label`, `is_soft404_site`) are NOT in this array;
// the collector appends them separately so they stay out of the feature matrix.
// ---------------------------------------------------------------------------

/** Cheap signals — always present in every collected row. */
const CHEAP_SIGNAL_KEYS: string[] = [
  'http_200',
  'http_3xx',
  'http_404',
  'http_4xx',
  'http_5xx',
  'has_username_in_path',
  'is_homepage',
  'has_auth_pattern',
  'redirect_count',
  'response_time',
  'content_length',
];

/** Body signals — present when the probe fetched a body; zero-filled otherwise. */
const BODY_SIGNAL_KEYS: string[] = [
  'title_has_username',
  'meta_has_username',
  'username_in_canonical',
  'og_type_profile',
  'has_json_ld_person',
  'error_keyword_count',
  'positive_keyword_count',
  'meta_error_keyword_count',
  'meta_positive_keyword_count',
  'profile_section_count',
  'error_section_count',
  'img_count',
  'input_count',
  'form_count',
  'link_count',
  'text_length',
];

/**
 * Ordered feature columns for dataset.csv.
 * Does NOT include evaluation labels (`label`, `is_soft404_site`).
 */
export const DATASET_COLUMNS: string[] = [
  ...CHEAP_SIGNAL_KEYS,
  ...BODY_SIGNAL_KEYS,
  'heuristic_score',
  ...INTERACTION_KEYS,
];

// ---------------------------------------------------------------------------
// rowToFeatures
// ---------------------------------------------------------------------------

/**
 * Build the full feature vector for a single corpus row:
 *   1. extractSignals → base signal vector.
 *   2. Set heuristic_score = weightedSum(v) (the RAW linear combination,
 *      NOT the sigmoid probability — the model's mean/scale standardize
 *      the raw sum just as it was at training time).
 *   3. buildInteractionFeatures(v) → append four heuristic × signal cross-terms.
 *
 * Pure function — same inputs always yield the same output.
 * Does NOT mutate `raw`.
 */
export function rowToFeatures(
  site: MaigretSiteEntry,
  raw: RawCheckResult,
  targetUrl: string,
): SignalVector {
  const v: SignalVector = extractSignals(site, raw, targetUrl);
  v.heuristic_score = weightedSum(v);
  return buildInteractionFeatures(v);
}

/**
 * Zero-fill a feature vector for all DATASET_COLUMNS that are missing.
 * Used by the orchestrator when writing body-less rows to dataset.csv.
 */
export function zeroFill(v: SignalVector): Record<string, number> {
  const row: Record<string, number> = {};
  for (const col of DATASET_COLUMNS) {
    row[col] = v[col] ?? 0;
  }
  return row;
}
