/**
 * X Listening Station — collection run log (Enterprise port, Task A3).
 *
 * Rebuilds Enterprise's `startCollectionRun`/`finishCollectionRun` per-operation run records
 * (`electron/main.cjs:420-457`) onto OUR encrypted `XStore` (store.ts `runLog` sidecar). A run
 * record is OPERATIONAL telemetry — observed/added/duplicates, requested-vs-completed passes,
 * reachedEnd, stopReason, status — for the Change Intel COLLECTION RUN LOG (B1); it carries no
 * captured content and feeds NO evidence hash. No electron/network here; the store is an
 * injectable dep (production default is the lazily-resolved `prodXStore`, mirroring changes.ts),
 * so this module is quarantine-clean and unit-testable over an in-memory `makeXStore`.
 *
 * Determinism: `startedAt`/`endedAt` are the caller-supplied injected clock, never computed here;
 * the record holds no id/RNG. `duplicates = max(0, observed - added)` is derived exactly as
 * Enterprise `finishCollectionRun` (`main.cjs:453`), so a re-capture that hits stored ids records
 * the honest duplicate count rather than inventing one.
 */
import type { XRunLogRecord, XRunOperation, XStore } from './store';

async function resolveStore(store?: XStore): Promise<XStore> {
  if (store) return store;
  const { prodXStore } = await import('./store');
  return prodXStore();
}

/** The raw outcome of one capture/archive operation — the counts/flags a caller has on hand
 *  before `buildRunRecord` normalizes them into a persisted `XRunLogRecord`. */
export interface RunRecordInput {
  profileId: string;
  username: string;
  operation: XRunOperation;
  observed: number;
  added: number;
  /** Defaults to 1 (this port's single-scrape capture is one pass); the archive/network paths
   *  pass their real requested depth. */
  requestedPasses?: number;
  /** Defaults to 0; a completed capture sets it to `requestedPasses` (or its own real value). */
  completedPasses?: number;
  reachedEnd?: boolean;
  stopReason?: string;
  status?: 'complete' | 'error' | string;
  /** Injected-clock ISO — never computed here (determinism). */
  startedAt: string;
  endedAt: string;
}

/**
 * Build a normalized `XRunLogRecord` from a capture/archive outcome. Clamps every count
 * non-negative and derives `duplicates = max(0, observed - added)` exactly as Enterprise
 * `finishCollectionRun` (`main.cjs:453`) — the store never persists a negative or NaN count, and a
 * caller can never fabricate a duplicate total that disagrees with observed/added. `stopReason`
 * defaults to `'error'` for an error status, else `'complete'`.
 */
export function buildRunRecord(input: RunRecordInput): XRunLogRecord {
  const observed = Math.max(0, Math.floor(Number(input.observed) || 0));
  const added = Math.max(0, Math.floor(Number(input.added) || 0));
  const status = input.status ?? 'complete';
  return {
    profileId: String(input.profileId ?? ''),
    username: String(input.username ?? ''),
    operation: input.operation,
    observed,
    added,
    duplicates: Math.max(0, observed - added),
    requestedPasses: Math.max(0, Math.floor(Number(input.requestedPasses ?? 1) || 0)),
    completedPasses: Math.max(0, Math.floor(Number(input.completedPasses ?? 0) || 0)),
    reachedEnd: input.reachedEnd ?? false,
    stopReason: String(input.stopReason ?? (status === 'error' ? 'error' : 'complete')),
    status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  };
}

/**
 * Append one collection-run record to a case's encrypted `runLog` sidecar (capped to the newest
 * `X_MAX_RUN_LOG` by the store). The CALLER builds the record (from a capture/archive result, via
 * `buildRunRecord`) and supplies its injected clock. Returns the fresh append-order list.
 */
export async function recordCollectionRun(
  caseId: string,
  record: XRunLogRecord,
  store?: XStore,
): Promise<XRunLogRecord[]> {
  const s = await resolveStore(store);
  return s.runLog.append(caseId, record);
}
