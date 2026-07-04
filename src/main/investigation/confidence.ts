import type { EvidenceSignal, ConfidenceResult, ConfidenceBand, AttributionStatus } from '@shared/investigation-types';

/** Deterministic: sum signed weights → band; attribution from signal KINDS. No time/RNG. Machine-derived,
 *  never taken from the model (charter: confidence must be grounded in tool output). */
export function scoreConfidence(signals: EvidenceSignal[]): ConfidenceResult {
  const score = signals.reduce((s, x) => s + x.weight, 0);
  const hasContradiction = signals.some((s) => s.kind === 'contradiction');
  const authoritative = signals.some((s) => s.kind === 'authoritative-source');
  const corroborating = signals.filter((s) => s.kind === 'corroborating-source').length;
  const band: ConfidenceBand = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
  const attribution: AttributionStatus = hasContradiction
    ? 'unconfirmed'
    : authoritative && corroborating >= 1 ? 'attributed' : 'unattributed';
  return { band, attribution, score };
}
