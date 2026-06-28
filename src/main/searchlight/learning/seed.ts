/**
 * Seed projection: maps rows from the Aliens_eye seed_dataset.csv format
 * into the app's DATASET_COLUMNS feature space.
 *
 * Constraints:
 * - NO Date.now / Math.random — fully deterministic.
 * - Reuses parseCsv, DATASET_COLUMNS, INTERACTION_KEYS, buildInteractionFeatures verbatim.
 * - Fingerprint columns (fingerprint_match_found, fingerprint_match_not_found) are silently
 *   dropped — they are absent from DATASET_COLUMNS and carry no transferable signal.
 * - `soft` (= http_200 === 1) is an eval-only stratifier; never placed in the feature vector.
 * - Zero new network egress — all I/O is caller-supplied text or secure-fs; no fetch/https.
 */

import { parseCsv } from '@shared/searchlight/ml/csv';
import { DATASET_COLUMNS } from '@shared/searchlight/ml/collect-core';
import { INTERACTION_KEYS, buildInteractionFeatures } from '@shared/searchlight/features';
import type { SignalVector } from '@shared/searchlight/types';
import type { EvalRow } from '@shared/searchlight/ml/eval-core';

/**
 * The ordered subset of DATASET_COLUMNS that the seed CSV provides directly.
 * Excludes interaction cross-terms (computed, not read from the CSV).
 * = CHEAP_SIGNAL_KEYS + BODY_SIGNAL_KEYS + ['heuristic_score'] (28 columns).
 *
 * Fingerprint columns (fingerprint_match_found, fingerprint_match_not_found) and
 * the `label` column appear in the seed CSV but are NOT in DATASET_COLUMNS,
 * so they are absent from this set and silently ignored during projection.
 */
const SEED_BASE_COLS: string[] = DATASET_COLUMNS.filter(
  (c) => !INTERACTION_KEYS.includes(c),
);

/**
 * Project one seed CSV row into the app feature space.
 *
 * Steps:
 *   1. Build a SignalVector from the 27 base signal columns + heuristic_score
 *      (fingerprint columns and label are silently ignored — not in DATASET_COLUMNS).
 *   2. Compute the 4 interaction cross-terms via buildInteractionFeatures.
 *   3. Project onto DATASET_COLUMNS order (zero-fill any absent column).
 *
 * Returns { features, vec, label, soft } matching the EvalRow shape.
 *
 * Pure function — same `row` always yields the same output.
 * NO Date.now / Math.random.
 */
export function projectSeedRow(row: Record<string, string>): {
  features: number[];
  vec: SignalVector;
  label: number;
  soft: boolean;
} {
  // Step 1: read the base columns (27 base signals + heuristic_score).
  // Columns absent from the seed row default to 0.
  const base: SignalVector = {};
  for (const col of SEED_BASE_COLS) {
    base[col] = Number(row[col] ?? 0);
  }

  // Step 2: compute interaction cross-terms (requires heuristic_score in base).
  const vec: SignalVector = buildInteractionFeatures(base);

  // Step 3: project onto the ordered DATASET_COLUMNS feature vector.
  const features: number[] = DATASET_COLUMNS.map((c) => vec[c] ?? 0);

  // label: 1 if label >= 0.5, else 0.
  const label: number = Number(row['label']) >= 0.5 ? 1 : 0;

  // soft: eval-only stratifier — true when http_200 === 1.
  // Never placed in the feature vector.
  const soft: boolean = Number(row['http_200']) === 1;

  return { features, vec, label, soft };
}

/**
 * Parse a seed CSV text and project every data row into EvalRow format.
 *
 * The first line of the CSV must be the header (no comment prefix).
 * parseCsv handles trailing newlines; no further sanitization is needed
 * for the seed — the Aliens_eye dataset is well-formed numeric data.
 */
export function loadSeedRows(csvText: string): EvalRow[] {
  const { rows } = parseCsv(csvText);
  return rows.map(projectSeedRow);
}
