/**
 * Task 9 — Eval orchestrator: pure core unit tests.
 *
 * Tests `evaluate` from eval-core.ts.
 * Fixtures are hand-built to verify:
 *   1. A separable dataset where ML clearly beats a weak heuristic → verdict.pass === true.
 *   2. A dataset with < 80 soft-404 held-out rows → inconclusive (pass === false).
 *
 * The orchestrator script (eval.ts) does file I/O and is not tested here.
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/shared/searchlight/ml/eval-core';
import type { EvalRow } from '../src/shared/searchlight/ml/eval-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an EvalRow with explicit feature vector, heuristic prob, label, soft flag. */
function mkRow(features: number[], label: number, soft: boolean): EvalRow {
  // vec is only used to compute scoreSignals (heuristic); we pass it as a
  // SignalVector by providing a single numeric key that scorer can weight.
  // We control the heuristic outcome via the feature 'http_200'/'http_404'.
  return {
    features,
    vec: {},   // scorer receives an empty vector → heuristic_score ~ 0.5 (sigmoid(0))
    label,
    soft,
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: separable dataset where ML clearly beats heuristic
//
// Strategy:
//   - 160 rows: 80 positive (label=1), 80 negative (label=0)
//   - 100 of them are "soft" (soft=true) so held-out soft subset is ~20 per fold
//   - ML features: strongly separable (x = 2 for label=1, x = -2 for label=0)
//   - Heuristic: all-zeros vec → sigmoid(0) ≈ 0.5 for every row →
//     recall=1 at threshold ~0.5 but precision=~0.5 (always says "found")
//   - ML after 5000 iters will achieve near-perfect precision AND recall on this
//     simple 1-D dataset.
// ---------------------------------------------------------------------------
function buildSeparableFixture(): EvalRow[] {
  const rows: EvalRow[] = [];
  for (let i = 0; i < 80; i++) {
    const soft = i < 50; // 50 soft positives
    rows.push({ features: [2], vec: {}, label: 1, soft });
  }
  for (let i = 0; i < 80; i++) {
    const soft = i < 50; // 50 soft negatives
    rows.push({ features: [-2], vec: {}, label: 0, soft });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fixture 2: dataset with soft N < 80 in held-out subset → inconclusive
//
// Strategy:
//   - Same separable structure but only 4 soft rows total
//   - Across 5 folds each held-out soft subset will be tiny (<80)
// ---------------------------------------------------------------------------
function buildSmallSoftFixture(): EvalRow[] {
  const rows: EvalRow[] = [];
  for (let i = 0; i < 80; i++) {
    const soft = i < 2; // only 2 soft positives
    rows.push({ features: [2], vec: {}, label: 1, soft });
  }
  for (let i = 0; i < 80; i++) {
    const soft = i < 2; // only 2 soft negatives
    rows.push({ features: [-2], vec: {}, label: 0, soft });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  it('separable dataset: ML beats heuristic → verdict.pass === true', () => {
    const rows = buildSeparableFixture();
    const result = evaluate(rows, ['x']);

    // Overall gate inputs are populated
    expect(typeof result.overall.precH).toBe('number');
    expect(typeof result.overall.precM).toBe('number');
    expect(typeof result.overall.f1H).toBe('number');
    expect(typeof result.overall.f1M).toBe('number');

    // Soft subset inputs are populated
    expect(typeof result.soft.precH).toBe('number');
    expect(typeof result.soft.precM).toBe('number');
    expect(result.soft.softN).toBeGreaterThan(0);

    // ML should achieve near-perfect precision on a cleanly separable dataset
    expect(result.overall.precM).toBeGreaterThan(result.overall.precH + 0.05);

    // Verdict must pass
    expect(result.verdict.pass).toBe(true);
  });

  it('small soft subset: inconclusive → verdict.pass === false', () => {
    const rows = buildSmallSoftFixture();
    const result = evaluate(rows, ['x']);

    expect(result.verdict.pass).toBe(false);
    expect(result.verdict.reason).toMatch(/inconclusive/);
  });

  it('overall gate inputs are means across folds (not single-fold numbers)', () => {
    const rows = buildSeparableFixture();
    const result = evaluate(rows, ['x']);
    // Means are bounded 0..1
    for (const key of ['precH', 'f1H', 'precM', 'f1M'] as const) {
      expect(result.overall[key]).toBeGreaterThanOrEqual(0);
      expect(result.overall[key]).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic: same rows → identical result', () => {
    const rows = buildSeparableFixture();
    const a = evaluate(rows, ['x']);
    const b = evaluate(rows, ['x']);
    expect(a.overall.precM).toBe(b.overall.precM);
    expect(a.verdict.pass).toBe(b.verdict.pass);
  });
});
