import type { MaigretSiteEntry, RawCheckResult, SweepStatus } from './types';

export interface Interpretation {
  found: boolean;
  confidence: 'high' | 'medium' | 'low';
  status: SweepStatus;
}

const BLOCKED_CODES = new Set([403, 429, 503]);

export function interpretResult(
  site: MaigretSiteEntry,
  result: RawCheckResult,
  targetUrl: string
): Interpretation {
  if (result.error) {
    // TOR_UNAVAILABLE is an operator-actionable error; network failures are 'unknown'.
    const status: SweepStatus = result.error === 'TOR_UNAVAILABLE' ? 'error' : 'unknown';
    return { found: false, confidence: 'low', status };
  }

  // Anti-bot / rate-limit responses are NOT evidence of absence.
  if (BLOCKED_CODES.has(result.statusCode)) {
    return { found: false, confidence: 'low', status: 'blocked' };
  }

  const finalize = (found: boolean, confidence: 'high' | 'medium' | 'low'): Interpretation =>
    ({ found, confidence, status: found ? 'found' : 'not_found' });

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
    return finalize(result.statusCode === 200, 'low');
  }

  if (checkType === 'response_url') {
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
  return finalize(result.statusCode === 200, checkType === 'status_code' ? 'high' : 'low');
}
