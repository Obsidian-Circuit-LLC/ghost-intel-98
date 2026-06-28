/**
 * Interaction-feature builder for the ML corpus pipeline.
 *
 * Pure module — NO Date.now / Math.random.
 * Same input → identical output (determinism invariant).
 *
 * Each interaction feature is (heuristic_score × structural_signal).
 * Requires v.heuristic_score to have been set by the caller (scorer layer).
 */

import type { SignalVector } from './types';

/**
 * Fixed [interaction_key, source_signal] mapping table.
 * Order is stable and defines INTERACTION_KEYS.
 */
const INTERACTION_TABLE: [string, string][] = [
  ['heuristic_x_og_type',      'og_type_profile'],
  ['heuristic_x_json_ld',      'has_json_ld_person'],
  ['heuristic_x_error_kw',     'error_keyword_count'],
  ['heuristic_x_error_section','error_section_count'],
];

/** Ordered list of interaction feature names produced by buildInteractionFeatures. */
export const INTERACTION_KEYS: string[] = INTERACTION_TABLE.map(([k]) => k);

/**
 * Return a NEW SignalVector = v plus four heuristic × signal interaction features.
 * Does NOT mutate the input vector.
 *
 * @param v - SignalVector with heuristic_score already set by the scoring layer.
 */
export function buildInteractionFeatures(v: SignalVector): SignalVector {
  const h = v.heuristic_score ?? 0;
  const interactions: SignalVector = {};
  for (const [key, signal] of INTERACTION_TABLE) {
    interactions[key] = h * (v[signal] ?? 0);
  }
  return { ...v, ...interactions };
}
