// Pure, deterministic metrics for the ML precision-first gate.
// No Math.random / Date.now — all functions are referentially transparent.

/** Precision, recall, F1 for the positive class (label === 1). */
export function prf(pred: number[], y: number[]): { precision: number; recall: number; f1: number } {
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < pred.length; i++) {
    const p = pred[i], a = y[i];
    if (p === 1 && a === 1) tp++;
    else if (p === 1 && a !== 1) fp++;
    else if (p !== 1 && a === 1) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/**
 * Returns the highest threshold (from the candidate set of unique prob values)
 * at which recall ≥ targetRecall.  Scan from high→low; first threshold
 * where recall meets the target is the most precise operating point.
 * If no threshold achieves the target, returns the lowest unique prob (max recall).
 */
export function thresholdForRecall(probs: number[], y: number[], targetRecall: number): number {
  // Build sorted unique thresholds descending
  const unique = [...new Set(probs)].sort((a, b) => b - a);
  const positives = y.filter(v => v === 1).length;
  let best = unique[unique.length - 1]; // fallback: lowest threshold (highest recall)
  for (const t of unique) {
    let tp = 0, fn = 0;
    for (let i = 0; i < probs.length; i++) {
      if (y[i] === 1) { if (probs[i] >= t) tp++; else fn++; }
    }
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    void positives;
    if (recall >= targetRecall) { best = t; } else { break; }
  }
  return best;
}

/**
 * Stratified k-fold assignment.  The fold index for each row = running count
 * within its class, mod k.  Deterministic — no RNG.
 *
 * Example: y=[1,1,1,0,0,0], k=3 → [0,1,2,0,1,2]
 */
export function stratifiedFolds(y: number[], k: number): number[] {
  const counts = new Map<number, number>();
  return y.map(cls => {
    const c = counts.get(cls) ?? 0;
    counts.set(cls, c + 1);
    return c % k;
  });
}

export interface GateArgs {
  /** Heuristic precision on CV mean */
  precH: number;
  /** Heuristic F1 on CV mean */
  f1H: number;
  /** ML precision on CV mean */
  precM: number;
  /** ML F1 on CV mean */
  f1M: number;
  /** Number of soft-404 rows in the held-out subsets */
  softN: number;
}

/**
 * Gate verdict: pass iff
 *   - softN >= 80 (otherwise inconclusive)
 *   - precM >= precH + 0.05
 *   - f1M  >= f1H  - 0.02
 */
export function gateVerdict(args: GateArgs): { pass: boolean; reason: string } {
  const { precH, f1H, precM, f1M, softN } = args;
  if (softN < 80) {
    return { pass: false, reason: 'inconclusive: soft-404 subset < 80' };
  }
  if (precM >= precH + 0.05 && f1M >= f1H - 0.02) {
    return { pass: true, reason: `ML precision +${(precM - precH).toFixed(3)} over heuristic, F1 within tolerance` };
  }
  const reasons: string[] = [];
  if (precM < precH + 0.05) reasons.push(`precision margin ${(precM - precH).toFixed(3)} < 0.05`);
  if (f1M < f1H - 0.02) reasons.push(`F1 drop ${(f1H - f1M).toFixed(3)} > 0.02`);
  return { pass: false, reason: reasons.join('; ') };
}
