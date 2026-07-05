/**
 * Mount-independent subscriber to the SP-6 run event stream.
 *
 * `run.onEvent` fans EVERY live run's events through one channel as `{runId, event}`.
 * This module subscribes exactly once (idempotent `startRunStream`) and folds each
 * event into the per-case store entry whose `runId` matches — the same pattern
 * Searchlight's sweep-stream singleton uses so a run's feed keeps accruing even while
 * the panel is unmounted on another module. Subscription lives here, not in a panel
 * effect, which is what makes the feed survive a tab-switch unmount.
 */

import { useInvestigationRunStore } from './investigation-run-store';

let off: (() => void) | null = null;

/** Subscribe once to the run event stream. Safe to call on every shell mount — self-guarding via an
 *  optional call, so a surface that hasn't bound the run channel (e.g. a graph-only test) no-ops
 *  instead of throwing, and without a bare-function truthiness test (which the always-defined api
 *  type would flag). */
export function startRunStream(): void {
  if (off) return; // already subscribed — idempotent
  const onEvent = window.api?.investigation?.run?.onEvent;
  off = onEvent?.(({ runId, event }) => {
    const { cases, applyEvent } = useInvestigationRunStore.getState();
    const caseId = Object.keys(cases).find((cid) => cases[cid].runId === runId);
    if (caseId) applyEvent(caseId, event);
    // Unknown runId (no case owns it) → drop; never throw.
  }) ?? null;
}

/** Test-only: tear down the subscription so a fresh `startRunStream` re-subscribes. */
export function __resetRunStreamForTest(): void {
  if (off) {
    off();
    off = null;
  }
}
