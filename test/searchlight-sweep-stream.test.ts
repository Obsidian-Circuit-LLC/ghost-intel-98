import { describe, it, expect, vi } from 'vitest';
import { createSweepStreamManager } from '../src/renderer/modules/searchlight/sweep-stream';

function fakeDeps() {
  let resultCb: ((r: any) => void) | null = null;
  let doneCb: ((f: any) => void) | null = null;
  const offResult = vi.fn();
  const offDone = vi.fn();
  return {
    emitResult: (r: any) => resultCb?.(r),
    emitDone: (f: any) => doneCb?.(f),
    offResult,
    offDone,
    appended: [] as any[],
    finished: [] as any[],
    deps: {
      onSweepResult(cb: any) { resultCb = cb; return offResult; },
      onSweepDone(cb: any) { doneCb = cb; return offDone; },
      appendResult(caseId: string, jobId: string, r: any) { this._a.push({ caseId, jobId, r }); },
      finishJob(caseId: string, jobId: string, status: string) { this._f.push({ caseId, jobId, status }); },
      _a: [] as any[],
      _f: [] as any[],
    },
  };
}

describe('sweep stream manager', () => {
  it('routes only matching-jobId results into the store while active', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    f.emitResult({ jobId: 'job-A', id: 'r1' });
    f.emitResult({ jobId: 'job-OTHER', id: 'r2' }); // ignored
    expect((f.deps as any)._a).toEqual([{ caseId: 'case-1', jobId: 'job-A', r: { jobId: 'job-A', id: 'r1' } }]);
    expect(mgr.active()).toContain('job-A');
  });

  it('finishes and auto-detaches on the done event for that job', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    f.emitDone({ jobId: 'job-A', status: 'completed' });
    expect((f.deps as any)._f).toEqual([{ caseId: 'case-1', jobId: 'job-A', status: 'completed' }]);
    expect(mgr.active()).not.toContain('job-A');
    expect(f.offResult).toHaveBeenCalled();
    expect(f.offDone).toHaveBeenCalled();
  });

  it('stop() unsubscribes and drops the job', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    mgr.stop('job-A');
    expect(mgr.active()).toEqual([]);
    f.emitResult({ jobId: 'job-A', id: 'r1' }); // no longer routed
    expect((f.deps as any)._a).toEqual([]);
  });

  it('start() is idempotent per jobId (no double subscription)', () => {
    const f = fakeDeps();
    const mgr = createSweepStreamManager(f.deps as any);
    mgr.start('case-1', 'job-A');
    mgr.start('case-1', 'job-A');
    expect(mgr.active()).toEqual(['job-A']);
  });
});
