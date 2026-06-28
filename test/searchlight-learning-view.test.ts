import { describe, it, expect } from 'vitest';
import { prioritizedQueue, progress, nextAction, MIN_LABELS, QUEUE_CAP } from '../src/shared/searchlight/learning-view';
import type { SweepResult } from '../src/shared/searchlight/types';

const r = (id: string, status: SweepResult['status'], probability?: number): SweepResult => ({
  id, jobId: 'j', siteName: 'S', username: 'u', url: 'https://s.com/u', statusCode: 200,
  statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, category: 'x', tags: [],
  checkType: 'status_code', found: false, confidence: 'medium', status, probability, timestamp: 1,
});

describe('prioritizedQueue', () => {
  it('returns only unlabeled maybe results, sorted by probability desc, capped', () => {
    const results = [r('a', 'found', 0.9), r('b', 'maybe', 0.4), r('c', 'maybe', 0.52), r('d', 'not_found')];
    const q = prioritizedQueue(results, new Set(['x']));
    expect(q.map((x) => x.id)).toEqual(['c', 'b']);
    const many = Array.from({ length: 20 }, (_, i) => r('m' + i, 'maybe', i / 20));
    expect(prioritizedQueue(many, new Set()).length).toBe(QUEUE_CAP);
  });

  it('excludes already-labeled results', () => {
    expect(prioritizedQueue([r('b', 'maybe', 0.4)], new Set(['b']))).toHaveLength(0);
  });
});

describe('progress', () => {
  it('maps label count to the MIN_LABELS target', () => {
    expect(progress(40)).toEqual({ value: 40, target: MIN_LABELS, pct: 50 });
    expect(progress(200).pct).toBe(100); // capped at 100
  });
});

describe('nextAction', () => {
  it('drives the single-next-action state machine', () => {
    expect(nextAction(null).state).toBe('labeling');
    expect(nextAction({ labelCount: 10, meta: null, mlEnabled: false }).state).toBe('labeling');
    expect(nextAction({ labelCount: 100, meta: null, mlEnabled: false }).state).toBe('ready_to_train');
    const pass = { trainedAt: 1, labelCount: 100, verdict: { pass: true, reason: '' } };
    expect(nextAction({ labelCount: 100, meta: pass, mlEnabled: false }).state).toBe('ready_to_enable');
    expect(nextAction({ labelCount: 100, meta: pass, mlEnabled: true }).state).toBe('on');
  });

  it('uses plain language only — never raw metrics', () => {
    const fail = { trainedAt: 1, labelCount: 100, verdict: { pass: false, reason: 'precision margin 0.02 < 0.05' } };
    const v = nextAction({ labelCount: 100, meta: fail, mlEnabled: false });
    expect(v.verdict).not.toMatch(/precision|recall|F1|0\.0/i);
    expect(v.label.length).toBeGreaterThan(0);
  });
});
