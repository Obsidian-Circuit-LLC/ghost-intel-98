/**
 * Tests for src/main/searchlight/learning/trainer.ts
 *
 * Tests:
 *   1. buildTrainRows — pure function, independently testable.
 *   2. Sort-stability: identical corpus in different insertion orders yields
 *      identical TrainRow[].
 *   3. trainFromCorpus — smoke-test (delegates to trainModel; just checks shape).
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron and secure-fs (trainer.ts uses deferred require('electron')
// for metaPath; writeLearningMeta calls secureWriteFile)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/mock/userData',
    getAppPath: () => '/mock/appPath',
  },
}));

vi.mock('../src/main/storage/secure-fs', () => ({
  secureWriteFile: vi.fn().mockResolvedValue(undefined),
}));

import { buildTrainRows, trainFromCorpus } from '../src/main/searchlight/learning/trainer';
import type { LabelEntry } from '../src/main/searchlight/learning/corpus-store';
import type { EvalRow } from '../src/shared/searchlight/ml/eval-core';
import { DATASET_COLUMNS } from '../src/shared/searchlight/ml/collect-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const N = DATASET_COLUMNS.length;

function makeEntry(resultId: string, label: 0 | 1 = 1): LabelEntry {
  return {
    resultId,
    features: Array.from({ length: N }, () => 0),
    label,
    soft: false,
    siteName: 'S',
    caseId: 'c1',
    ts: 1_000_000,
  };
}

function makeSeedRow(label: number): EvalRow {
  return { features: Array.from({ length: N }, () => 0), vec: {}, label, soft: false };
}

// ---------------------------------------------------------------------------
// buildTrainRows
// ---------------------------------------------------------------------------

describe('buildTrainRows', () => {
  it('returns empty array for empty corpus and empty seed', () => {
    const rows = buildTrainRows([], []);
    expect(rows).toHaveLength(0);
  });

  it('corpus entries appear before seed entries', () => {
    const corpus = [makeEntry('r1', 1)];
    const seed = [makeSeedRow(0)];
    const rows = buildTrainRows(corpus, seed);
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe(1);  // corpus entry
    expect(rows[1].label).toBe(0);  // seed entry
  });

  it('corpus rows are sorted by resultId (determinism)', () => {
    // Two orderings of the same corpus → identical TrainRow output.
    const e1 = makeEntry('aaa', 1);
    const e2 = makeEntry('bbb', 0);
    const e3 = makeEntry('zzz', 1);
    const ordA = buildTrainRows([e1, e2, e3], []);
    const ordB = buildTrainRows([e3, e1, e2], []);
    expect(ordA.map((r) => r.label)).toEqual(ordB.map((r) => r.label));
  });

  it('features are forwarded verbatim', () => {
    const feats = Array.from({ length: N }, (_, i) => i * 0.1);
    const entry: LabelEntry = { ...makeEntry('r1'), features: feats };
    const rows = buildTrainRows([entry], []);
    expect(rows[0].features).toEqual(feats);
  });

  it('does not mutate the original corpus array', () => {
    const corpus = [makeEntry('zzz'), makeEntry('aaa')];
    const original = corpus.map((e) => e.resultId);
    buildTrainRows(corpus, []);
    expect(corpus.map((e) => e.resultId)).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// trainFromCorpus (smoke test)
// ---------------------------------------------------------------------------

describe('trainFromCorpus', () => {
  it('returns an MlModel with the expected shape when trained on seed-only rows', () => {
    // Use only seed rows to avoid needing a corpus (cold-start scenario).
    const seed: EvalRow[] = [
      makeSeedRow(1),
      makeSeedRow(1),
      makeSeedRow(0),
      makeSeedRow(0),
    ];
    const model = trainFromCorpus([], seed);
    expect(model).toBeTruthy();
    expect(model.coef.length).toBe(N);
    expect(model.mean.length).toBe(N);
    expect(model.scale.length).toBe(N);
    expect(typeof model.intercept).toBe('number');
  });

  it('same corpus+seed yields the same model (bit-identical)', () => {
    const corpus = [makeEntry('r1', 1), makeEntry('r2', 0)];
    const seed: EvalRow[] = [makeSeedRow(1), makeSeedRow(0)];
    const m1 = trainFromCorpus(corpus, seed);
    const m2 = trainFromCorpus(corpus, seed);
    expect(m1.coef).toEqual(m2.coef);
    expect(m1.intercept).toBe(m2.intercept);
  });

  it('different corpus insertion orders yield the same model (sort invariant)', () => {
    const e1 = makeEntry('aaa', 1);
    const e2 = makeEntry('bbb', 0);
    const seed: EvalRow[] = [makeSeedRow(1), makeSeedRow(0)];
    const m1 = trainFromCorpus([e1, e2], seed);
    const m2 = trainFromCorpus([e2, e1], seed);
    expect(m1.coef).toEqual(m2.coef);
    expect(m1.intercept).toBe(m2.intercept);
  });
});
