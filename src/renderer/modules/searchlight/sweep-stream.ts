/**
 * Mount-independent sweep stream manager. Subscriptions live here, not in a panel
 * effect, so a running sweep keeps filling the store while the Sweep tab is unmounted.
 */
import type { SweepResult } from '@shared/searchlight/types';
import { useSearchlightStore } from './store';

export interface SweepStreamDeps {
  onSweepResult(cb: (r: SweepResult) => void): () => void;
  onSweepDone(cb: (f: { jobId: string; status: string }) => void): () => void;
  appendResult(caseId: string, jobId: string, r: SweepResult): void;
  finishJob(caseId: string, jobId: string, status: 'completed' | 'cancelled'): void;
}

export interface SweepStreamManager {
  start(caseId: string, jobId: string): void;
  stop(jobId: string): void;
  active(): string[];
}

export function createSweepStreamManager(deps: SweepStreamDeps): SweepStreamManager {
  const jobs = new Map<string, { caseId: string; offResult: () => void; offDone: () => void }>();

  return {
    start(caseId, jobId) {
      if (jobs.has(jobId)) return; // idempotent
      const offResult = deps.onSweepResult((r) => {
        if (!jobs.has(jobId)) return; // stopped — ignore late/in-flight events
        if (r.jobId !== jobId) return;
        deps.appendResult(caseId, jobId, r);
      });
      const offDone = deps.onSweepDone((f) => {
        if (!jobs.has(jobId)) return; // stopped — ignore late/in-flight events
        if (f.jobId !== jobId) return;
        const status = f.status === 'cancelled' ? 'cancelled' : 'completed';
        deps.finishJob(caseId, jobId, status);
        this.stop(jobId);
      });
      jobs.set(jobId, { caseId, offResult, offDone });
    },
    stop(jobId) {
      const entry = jobs.get(jobId);
      if (!entry) return;
      entry.offResult();
      entry.offDone();
      jobs.delete(jobId);
    },
    active() {
      return [...jobs.keys()];
    },
  };
}

/** Default singleton wired to the real IPC surface + the renderer store. */
export const sweepStream: SweepStreamManager = createSweepStreamManager({
  onSweepResult: (cb) => window.api.searchlight.onSweepResult(cb),
  onSweepDone: (cb) => window.api.searchlight.onSweepDone(cb),
  appendResult: (caseId, jobId, r) => useSearchlightStore.getState().appendSweepResult(caseId, jobId, r),
  finishJob: (caseId, jobId, status) => useSearchlightStore.getState().finishSweepJob(caseId, jobId, status),
});
