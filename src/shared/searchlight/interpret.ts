import type { MaigretSiteEntry, RawCheckResult, SweepStatus, ScorerCtx } from './types';
import { extractSignals } from './signals';
import { scoreSignals, weightedSum, classify } from './scorer';
import { predict, blend } from './ml';

export interface Interpretation {
  found: boolean;
  confidence: 'high' | 'medium' | 'low';
  status: SweepStatus;
  probability?: number;
}

const BLOCKED_CODES = new Set([403, 429, 503]);

export function interpretResult(
  site: MaigretSiteEntry,
  result: RawCheckResult,
  targetUrl: string,
  ctx?: ScorerCtx
): Interpretation {
  if (result.error) {
    // TOR_UNAVAILABLE is an operator-actionable error; network failures are 'unknown'.
    const status: SweepStatus = result.error === 'TOR_UNAVAILABLE' ? 'error' : 'unknown';
    return { found: false, confidence: 'low', status };
  }

  // Anti-bot / rate-limit responses are NOT evidence of absence — unless the site
  // declares ignore403 (403 is a normal response there; interpret by content).
  if (BLOCKED_CODES.has(result.statusCode) && !(result.statusCode === 403 && site.ignore403)) {
    return { found: false, confidence: 'low', status: 'blocked' };
  }

  const finalize = (found: boolean, confidence: 'high' | 'medium' | 'low'): Interpretation =>
    ({ found, confidence, status: found ? 'found' : 'not_found' });

  /**
   * Route a fallback branch through the structural scorer (heuristic or
   * ML-blended, depending on ctx.useMl).
   *
   * When useMl is true and a model is loaded:
   *   1. Compute heuristic score and store as v.heuristic_score (the model
   *      expects this as feature #30, trained against the same scorer).
   *   2. Run standardized logistic-regression inference via predict().
   *   3. Blend: prob = model.ml_weight·ml + (1−ml_weight)·heuristic.
   *
   * When useMl is false or no model is available, use heuristic alone.
   * Either way the result is classified against ctx.thresholds.
   */
  const scoreAndClassify = (): Interpretation => {
    const v = extractSignals(site, result, targetUrl);
    const heuristic = scoreSignals(v);
    let prob = heuristic;
    if (ctx!.useMl && ctx!.model) {
      // Set heuristic_score in the vector BEFORE ML inference so the model
      // receives the feature it was trained with: the RAW weighted sum
      // (training range ≈ -15..70), NOT the sigmoid probability. The model's
      // mean/scale for this feature (≈12.5/29.0) standardize the raw sum.
      v.heuristic_score = weightedSum(v);
      const ml = predict(v, ctx!.model);
      prob = blend(ml, heuristic, ctx!.model.ml_weight);
    }
    const { status, confidence } = classify(prob, ctx!.thresholds);
    return { found: status === 'found', confidence, status, probability: prob };
  };

  const { checkType, presenseStrs, absenceStrs } = site;

  if (checkType === 'message') {
    const body = result.body ?? '';
    if (!body && result.statusCode !== 200) return finalize(false, 'low');
    if (absenceStrs.length > 0 && absenceStrs.some((s) => body.includes(s))) {
      return { found: false, confidence: 'high', status: 'not_found' };
    }
    if (presenseStrs.length > 0) {
      if (presenseStrs.every((s) => body.includes(s))) return finalize(true, 'high');
      if (presenseStrs.some((s) => body.includes(s))) return finalize(true, 'medium');
      return finalize(false, 'medium');
    }
    // Fallback: message site with no curating strings at all — route through scorer if ctx present.
    if (ctx && absenceStrs.length === 0 && presenseStrs.length === 0) return scoreAndClassify();
    return finalize(result.statusCode === 200, 'low');
  }

  if (checkType === 'response_url') {
    // Fallback: route through scorer if ctx present (scorer is more comprehensive).
    if (ctx) return scoreAndClassify();
    // Legacy path (no ctx).
    const tail = targetUrl.replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';
    if (!tail) {
      // No username segment to compare against; rely on status code alone, low confidence.
      return finalize(result.statusCode === 200, 'low');
    }
    let redirected = false;
    if (result.redirectUrl) {
      try {
        redirected = !new URL(result.redirectUrl, targetUrl).pathname.toLowerCase().includes(tail);
      } catch {
        redirected = false;
      }
    }
    return finalize(result.statusCode === 200 && !redirected, 'medium');
  }

  // status_code and unknown fall back to the status code.
  // Route through scorer if ctx present.
  if (ctx) return scoreAndClassify();
  return finalize(result.statusCode === 200, checkType === 'status_code' ? 'high' : 'low');
}
