/**
 * Tests for runTrainAndGate — the pure orchestrator that trains + gates ML
 * and applies regression protection.
 *
 * All deps are injected and mocked here; no corpus-store, trainer, or evaluator
 * modules are required at test time.
 *
 * Scenarios:
 *  1. Passing verdict → setOverride called with the trained model + meta written.
 *  2. Failing verdict + wasEnabled:true → REGRESSION: setOverride NOT called, meta written.
 *  3. Failing verdict + wasEnabled:false → no override, meta written.
 *  4. Corpus length is reported as labelCount.
 */

import { describe, it, expect, vi } from 'vitest';
import { runTrainAndGate } from '../src/main/searchlight/learning/orchestrator';
import type { LabelEntry } from '../src/main/searchlight/learning/orchestrator';
import type { MlModel } from '../src/shared/searchlight/types';
import type { EvalResult } from '../src/shared/searchlight/ml/eval-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVerdict(pass: boolean) {
  return {
    pass,
    reason: pass ? 'all gates passed' : 'insufficient soft-404 samples (< 80)',
  };
}

function makeEvalResult(pass: boolean): EvalResult {
  const gate = { precH: 0, f1H: 0, precM: 0, f1M: 0, softN: pass ? 100 : 10 };
  return { overall: gate, soft: gate, verdict: makeVerdict(pass), perFold: [] };
}

const MOCK_MODEL: MlModel = {
  version: '3.0.0-corpus',
  feature_schema: ['feat_a'],
  mean: [0],
  scale: [1],
  coef: [0.5],
  intercept: -0.1,
  ml_weight: 1.0,
  thresholds: { found: 0.6, not_found: 0.3 },
};

const SAMPLE_ENTRY: LabelEntry = {
  resultId: 'r1',
  features: [0.5],
  label: 1,
  soft: false,
  siteName: 'example',
  caseId: 'case-1',
  ts: 1_000_000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTrainAndGate', () => {
  it('passing verdict — setOverride called with the trained model and meta written', async () => {
    const setOverride = vi.fn<[MlModel | null], Promise<void>>().mockResolvedValue(undefined);
    const writeMeta = vi.fn().mockResolvedValue(undefined);

    const result = await runTrainAndGate([], [], {
      train: () => MOCK_MODEL,
      eval: () => makeEvalResult(true),
      setOverride,
      writeMeta,
      wasEnabled: false,
    });

    expect(result.verdict.pass).toBe(true);
    expect(setOverride).toHaveBeenCalledOnce();
    expect(setOverride).toHaveBeenCalledWith(MOCK_MODEL);
    expect(writeMeta).toHaveBeenCalledOnce();
    expect(result.labelCount).toBe(0);
  });

  it('failing verdict + wasEnabled:true — regression protected: setOverride NOT called, meta written', async () => {
    const setOverride = vi.fn<[MlModel | null], Promise<void>>().mockResolvedValue(undefined);
    const writeMeta = vi.fn().mockResolvedValue(undefined);

    const result = await runTrainAndGate([], [], {
      train: () => MOCK_MODEL,
      eval: () => makeEvalResult(false),
      setOverride,
      writeMeta,
      wasEnabled: true,
    });

    expect(result.verdict.pass).toBe(false);
    expect(setOverride).not.toHaveBeenCalled();
    expect(writeMeta).toHaveBeenCalledOnce();
  });

  it('failing verdict + wasEnabled:false — no override, meta written', async () => {
    const setOverride = vi.fn<[MlModel | null], Promise<void>>().mockResolvedValue(undefined);
    const writeMeta = vi.fn().mockResolvedValue(undefined);

    const result = await runTrainAndGate([], [], {
      train: () => MOCK_MODEL,
      eval: () => makeEvalResult(false),
      setOverride,
      writeMeta,
      wasEnabled: false,
    });

    expect(result.verdict.pass).toBe(false);
    expect(setOverride).not.toHaveBeenCalled();
    expect(writeMeta).toHaveBeenCalledOnce();
  });

  it('labelCount equals corpus.length', async () => {
    const corpus: LabelEntry[] = [SAMPLE_ENTRY, { ...SAMPLE_ENTRY, resultId: 'r2', label: 0 }];

    const { labelCount } = await runTrainAndGate(corpus, [], {
      train: () => MOCK_MODEL,
      eval: () => makeEvalResult(true),
      setOverride: vi.fn().mockResolvedValue(undefined),
      writeMeta: vi.fn().mockResolvedValue(undefined),
      wasEnabled: false,
    });

    expect(labelCount).toBe(2);
  });

  it('writeMeta receives trainedAt (timestamp), labelCount, and verdict', async () => {
    const writeMeta = vi.fn().mockResolvedValue(undefined);

    const before = Date.now();
    await runTrainAndGate([SAMPLE_ENTRY], [], {
      train: () => MOCK_MODEL,
      eval: () => makeEvalResult(true),
      setOverride: vi.fn().mockResolvedValue(undefined),
      writeMeta,
      wasEnabled: false,
    });
    const after = Date.now();

    const [meta] = writeMeta.mock.calls[0] as [{ trainedAt: number; labelCount: number; verdict: { pass: boolean } }];
    expect(meta.trainedAt).toBeGreaterThanOrEqual(before);
    expect(meta.trainedAt).toBeLessThanOrEqual(after);
    expect(meta.labelCount).toBe(1);
    expect(meta.verdict.pass).toBe(true);
  });
});
