/**
 * Corpus-aware trainer for the Searchlight adaptive-learning engine.
 *
 * `trainFromCorpus` merges user-labelled corpus entries with seed rows and
 * delegates to the pure `trainModel` core from train-core.ts — verbatim,
 * no reimplementation of training math.
 *
 * Also owns LearningModelMeta (the metadata persisted after each retrain)
 * and the writeLearningMeta helper used by the orchestrator.
 *
 * Constraints:
 *   - No Math.random / no Date.now in training math (trainModel enforces this).
 *   - Date.now() is used ONLY for the trainedAt timestamp set by the orchestrator,
 *     never passed into this module.
 *   - No network egress — all persistence via secureWriteFile.
 *   - soft is an eval-only stratifier; never included in the feature vector.
 *   - Corpus rows are sorted by resultId before training so that identical corpus
 *     contents always yield a bit-identical model, regardless of insertion order.
 */

import { join } from 'node:path';
import type { MlModel } from '@shared/searchlight/types';
import type { EvalRow } from '@shared/searchlight/ml/eval-core';
import { DATASET_COLUMNS } from '@shared/searchlight/ml/collect-core';
import { trainModel } from '@shared/searchlight/ml/train-core';
import { secureWriteFile } from '../../storage/secure-fs';
import type { LabelEntry } from './corpus-store';

// ---------------------------------------------------------------------------
// LearningModelMeta — canonical definition (imported by orchestrator.ts)
// ---------------------------------------------------------------------------

/**
 * Metadata persisted alongside the model after each retrain cycle.
 * Written via writeLearningMeta regardless of verdict; lets the UI show the
 * latest gate result even when ML is disabled or the retrain failed.
 */
export interface LearningModelMeta {
  /** Unix-ms timestamp of the retrain (Date.now() set by the orchestrator). */
  trainedAt: number;
  /** Number of user-labelled entries in the corpus at training time. */
  labelCount: number;
  /** Gate verdict from the CV evaluation. */
  verdict: { pass: boolean; reason: string };
}

// ---------------------------------------------------------------------------
// Path helpers (deferred require so this module stays importable in Vitest)
// ---------------------------------------------------------------------------

/**
 * Absolute path to the retrain metadata JSON file in the user's app data directory.
 */
export function metaPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'searchlight', 'learning', 'meta.json');
}

// ---------------------------------------------------------------------------
// TrainRow — the shape trainModel expects
// ---------------------------------------------------------------------------

/** A single row for trainModel: feature vector + binary label. */
export interface TrainRow {
  features: number[];
  label: number;
}

// ---------------------------------------------------------------------------
// buildTrainRows (exported pure function — independently testable)
// ---------------------------------------------------------------------------

/**
 * Convert corpus entries and seed rows into the flat TrainRow[] that trainModel
 * expects.
 *
 * Corpus entries are sorted by resultId (lexicographic) BEFORE concatenation
 * with seed rows.  This is the global determinism invariant: identical
 * (corpus, seed) always yields identical TrainRow[] regardless of insertion order,
 * so the trained model is bit-identical for the same inputs.
 *
 * Pure function — no I/O, no Date.now, no Math.random.
 */
export function buildTrainRows(corpus: LabelEntry[], seed: EvalRow[]): TrainRow[] {
  // Sort corpus by resultId so row order is independent of insertion order.
  const sortedCorpus = [...corpus].sort((a, b) => a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0);
  const corpusRows: TrainRow[] = sortedCorpus.map((e) => ({
    features: e.features,
    label: e.label as number,
  }));
  const seedRows: TrainRow[] = seed.map((r) => ({ features: r.features, label: r.label }));
  return [...corpusRows, ...seedRows];
}

// ---------------------------------------------------------------------------
// Train
// ---------------------------------------------------------------------------

/**
 * Train a logistic-regression model from corpus entries merged with seed rows.
 *
 * Corpus entries supply the user-collected signal; seed rows supply the
 * vendored Aliens_eye baseline so the model does not overfit to a small corpus.
 *
 * Reuses `trainModel` and `DATASET_COLUMNS` from the merged engine verbatim —
 * no training math is reimplemented here.
 *
 * Pure relative to training: NO Date.now / Math.random — trainModel enforces
 * this. The same (corpus, seed) always produces the same MlModel because
 * buildTrainRows sorts corpus rows by resultId before concatenation.
 */
export function trainFromCorpus(corpus: LabelEntry[], seed: EvalRow[]): MlModel {
  const rows = buildTrainRows(corpus, seed);
  return trainModel(rows, DATASET_COLUMNS);
}

// ---------------------------------------------------------------------------
// Meta persistence
// ---------------------------------------------------------------------------

/**
 * Persist LearningModelMeta to the user's app data directory.
 * Called by the orchestrator after every retrain cycle (pass or fail) so the UI
 * can always show the latest gate result.
 */
export async function writeLearningMeta(meta: LearningModelMeta): Promise<void> {
  await secureWriteFile(metaPath(), JSON.stringify(meta));
}
