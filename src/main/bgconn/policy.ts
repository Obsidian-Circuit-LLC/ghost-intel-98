import { defaultSettings } from '../../shared/types';

export interface BgconnPolicy {
  idleTeardownAfterMs: number | null;
  maxReconnects: number;
  maxSessionAgeMs: number;
}

const D = defaultSettings.bgconn;
const okPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const okNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Coerce a possibly-malformed settings.bgconn into a policy with GUARANTEED-FINITE timers.
 *  A non-finite / missing / wrong-type field falls back to the fail-safe default rather than
 *  producing a NaN bound that would silently disable idle-teardown or max-session-age. */
export function coerceBgconnPolicy(raw: unknown): BgconnPolicy {
  const r = (raw ?? {}) as {
    idleTeardownAfterMinutes?: unknown; maxReconnects?: unknown; maxSessionAgeMinutes?: unknown;
  };
  const idleMin = r.idleTeardownAfterMinutes === null
    ? null
    : (okNonNegInt(r.idleTeardownAfterMinutes) ? r.idleTeardownAfterMinutes : D.idleTeardownAfterMinutes);
  const maxAgeMin = okPosInt(r.maxSessionAgeMinutes) ? r.maxSessionAgeMinutes : D.maxSessionAgeMinutes;
  const reconnects = okPosInt(r.maxReconnects) ? r.maxReconnects : D.maxReconnects;
  return {
    idleTeardownAfterMs: idleMin === null ? null : idleMin * 60_000,
    maxReconnects: reconnects,
    maxSessionAgeMs: maxAgeMin * 60_000
  };
}
