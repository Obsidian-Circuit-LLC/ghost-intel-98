/** Pure ADS-B back-off helpers — no I/O, fully unit-testable.
 *  Consumed by `src/main/services/livefeeds/adsb.ts`. */

/** Retry delay sequence in milliseconds: 500 ms, 1.5 s, 4 s. */
export function backoffDelaysMs(): number[] {
  return [500, 1500, 4000];
}

/** Classify an HTTP error status for a failed ADS-B fetch. */
export function classifyAdsbError(status: number): 'rate-limited' | 'unavailable' {
  return status === 429 ? 'rate-limited' : 'unavailable';
}

/** Typed error thrown by the ADS-B fetch service on a non-recoverable failure. */
export class AdsbError extends Error {
  readonly kind: 'rate-limited' | 'unavailable';
  readonly status: number;

  constructor(kind: 'rate-limited' | 'unavailable', status: number) {
    super(`ADS-B fetch failed: HTTP ${status} (${kind})`);
    this.name = 'AdsbError';
    this.kind = kind;
    this.status = status;
  }
}
