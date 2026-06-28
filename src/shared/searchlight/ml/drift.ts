/**
 * Feature-drift comparison for the clearnet-vs-Tor transport check.
 *
 * Lists the features whose value differs between two extractions of the same
 * page over different transports, excluding an ignore-list (e.g. response_time,
 * which legitimately varies by transport). A clean (empty) result is evidence
 * the clearnet-collected corpus is valid for Tor-time inference.
 *
 * Pure module — NO Date.now / Math.random.
 */

import type { SignalVector } from '../types';

const EPSILON = 1e-9;

export function featureDrift(
  clearnet: SignalVector,
  tor: SignalVector,
  ignore: string[] = [],
): { key: string; a: number; b: number }[] {
  const skip = new Set(ignore);
  // Sort keys for deterministic output order regardless of object insertion order.
  const keys = [...new Set([...Object.keys(clearnet), ...Object.keys(tor)])].sort();
  const out: { key: string; a: number; b: number }[] = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const a = clearnet[key] ?? 0;
    const b = tor[key] ?? 0;
    if (Math.abs(a - b) > EPSILON) out.push({ key, a, b });
  }
  return out;
}
