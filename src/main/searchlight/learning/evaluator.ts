/**
 * Corpus-aware evaluator for the Searchlight adaptive-learning engine.
 *
 * `evalFromCorpus` merges user-labelled corpus entries with seed rows and
 * delegates to the pure `evaluate` core from eval-core.ts — verbatim,
 * no reimplementation of CV or metric logic.
 *
 * Constraints:
 *   - No Math.random / no Date.now — evaluate enforces full determinism.
 *   - No network egress — no fetch / https / socksDial.
 *   - soft is carried from LabelEntry as the eval-only stratifier;
 *     it is NEVER placed in the feature vector.
 */

import type { EvalRow, EvalResult } from '@shared/searchlight/ml/eval-core';
import { DATASET_COLUMNS } from '@shared/searchlight/ml/collect-core';
import { evaluate } from '@shared/searchlight/ml/eval-core';
import type { SignalVector } from '@shared/searchlight/types';
import type { LabelEntry } from './corpus-store';

// ---------------------------------------------------------------------------
// evalFromCorpus
// ---------------------------------------------------------------------------

/**
 * Run K-fold stratified CV on corpus entries merged with seed rows.
 *
 * Corpus entries carry pre-computed feature vectors (DATASET_COLUMNS order) but
 * no SignalVector; the SignalVector is reconstructed from the feature vector so
 * the heuristic scorer can compute per-fold comparisons in the CV loop.
 *
 * Seed rows already carry both fields (features + vec) from projectSeedRow.
 *
 * Reuses `evaluate` and `DATASET_COLUMNS` from the merged engine verbatim —
 * no CV or metric math is reimplemented here.
 *
 * Pure: NO Date.now / Math.random — evaluate enforces this.
 * Identical (corpus, seed) always yields an identical EvalResult.
 */
export function evalFromCorpus(corpus: LabelEntry[], seed: EvalRow[]): EvalResult {
  // Convert corpus entries to EvalRow format.
  // The SignalVector is reconstructed from the pre-computed feature vector so
  // scoreSignals() in eval-core has the correct per-signal values.
  const corpusEvalRows: EvalRow[] = corpus.map((e) => {
    const vec: SignalVector = {};
    for (let i = 0; i < DATASET_COLUMNS.length; i++) {
      vec[DATASET_COLUMNS[i]] = e.features[i] ?? 0;
    }
    return { features: e.features, vec, label: e.label as number, soft: e.soft };
  });

  const rows: EvalRow[] = [...corpusEvalRows, ...seed];
  return evaluate(rows, DATASET_COLUMNS);
}
