import type { MaigretSiteEntry, RawCheckResult, SweepStatus, ScorerCtx } from './types';
import { extractSignals } from './signals';
import { scoreSignals, classify } from './scorer';

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
   * Route a fallback branch through the structural heuristic scorer.
   * Only called when ctx is present; ctx is guaranteed non-null at call sites.
   */
  const scoreAndClassify = (): Interpretation => {
    const v = extractSignals(site, result, targetUrl);
    const prob = scoreSignals(v);
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
    // Fallback: message site with no curating strings — route through scorer if ctx present.
    if (ctx) return scoreAndClassify();
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
