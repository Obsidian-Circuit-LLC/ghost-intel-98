/**
 * Tests for src/main/searchlight/learning/evaluator.ts
 *
 * Tests:
 *   1. evalFromCorpus — determinism: identical (corpus, seed) yields identical EvalResult.
 *   2. Sort-stability: different corpus insertion orders yield the same EvalResult.
 *   3. Smoke-test with enough rows for the 5-fold CV to run.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron (paths.ts is imported transitively)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/mock/userData',
    getAppPath: () => '/mock/appPath',
  },
}));

vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadText: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  secureWriteFile: vi.fn().mockResolvedValue(undefined),
}));

import { evalFromCorpus } from '../src/main/searchlight/learning/evaluator';
import type { LabelEntry } from '../src/main/searchlight/learning/corpus-store';
import type { EvalRow } from '../src/shared/searchlight/ml/eval-core';
import { DATASET_COLUMNS } from '../src/shared/searchlight/ml/collect-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const N = DATASET_COLUMNS.length;

function makeEntry(resultId: string, label: 0 | 1, soft = false): LabelEntry {
  return {
    resultId,
    // Give each entry a slightly distinct feature vector so the model has signal.
    features: DATASET_COLUMNS.map((c) => {
      if (c === 'http_200') return label === 1 ? 1 : 0;
      if (c === 'heuristic_score') return label === 1 ? 10 : -5;
      return 0;
    }),
    label,
    soft,
    siteName: 'S',
    caseId: 'c1',
    ts: 1_000_000,
  };
}

function makeSeedRow(label: number, soft = false): EvalRow {
  const features = DATASET_COLUMNS.map((c) => {
    if (c === 'http_200') return label === 1 ? 1 : 0;
    if (c === 'heuristic_score') return label === 1 ? 10 : -5;
    return 0;
  });
  const vec: Record<string, number> = {};
  DATASET_COLUMNS.forEach((c, i) => { vec[c] = features[i]; });
  return { features, vec, label, soft };
}

/**
 * Build a reasonably-sized dataset so all 5 folds have at least one positive
 * and one negative sample (needed for stratifiedFolds to work).
 */
function buildDataset(n = 100) {
  const corpus: LabelEntry[] = [];
  const seed: EvalRow[] = [];
  for (let i = 0; i < n; i++) {
    const label: 0 | 1 = i % 2 === 0 ? 1 : 0;
    const soft = i % 5 === 0;
    corpus.push(makeEntry(`r${String(i).padStart(4, '0')}`, label, soft));
    seed.push(makeSeedRow(label, soft));
  }
  return { corpus, seed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evalFromCorpus determinism', () => {
  it('same (corpus, seed) yields identical EvalResult', () => {
    const { corpus, seed } = buildDataset(60);
    const r1 = evalFromCorpus(corpus, seed);
    const r2 = evalFromCorpus(corpus, seed);
    expect(r1.verdict.pass).toBe(r2.verdict.pass);
    expect(r1.overall.precH).toBe(r2.overall.precH);
    expect(r1.overall.precM).toBe(r2.overall.precM);
    expect(r1.perFold.length).toBe(r2.perFold.length);
  });

  it('different corpus insertion orders yield identical EvalResult (sort invariant)', () => {
    const { corpus, seed } = buildDataset(60);
    const shuffled = [...corpus].reverse();
    const r1 = evalFromCorpus(corpus, seed);
    const r2 = evalFromCorpus(shuffled, seed);
    expect(r1.verdict.pass).toBe(r2.verdict.pass);
    expect(r1.overall.precH).toBeCloseTo(r2.overall.precH, 10);
    expect(r1.overall.precM).toBeCloseTo(r2.overall.precM, 10);
  });

  it('returns an EvalResult with 5 perFold entries', () => {
    const { corpus, seed } = buildDataset(60);
    const result = evalFromCorpus(corpus, seed);
    expect(result.perFold.length).toBe(5);
  });

  it('verdict.pass is a boolean', () => {
    const { corpus, seed } = buildDataset(60);
    const result = evalFromCorpus(corpus, seed);
    expect(typeof result.verdict.pass).toBe('boolean');
    expect(typeof result.verdict.reason).toBe('string');
  });

  it('does not mutate the original corpus array', () => {
    const { corpus, seed } = buildDataset(20);
    const originalOrder = corpus.map((e) => e.resultId);
    evalFromCorpus(corpus, seed);
    expect(corpus.map((e) => e.resultId)).toEqual(originalOrder);
  });
});
