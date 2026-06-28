/**
 * Tests the presentational LearningView (props-driven, no store/IPC) via
 * react-dom/server.renderToStaticMarkup — mirrors test/searchlight-sweep-badge.test.ts.
 * Asserts the single-next-action + plain-language verdict render correctly and
 * that NO raw ML metrics ever reach the user-facing markup.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LearningView } from '../src/renderer/modules/searchlight/panels/LearningView';
import type { SweepResult } from '../src/shared/searchlight/types';

const noop = (): void => {};
const r = (id: string, probability: number): SweepResult => ({
  id, jobId: 'j', siteName: 'GitHub', username: 'u', url: 'https://s.com/u', statusCode: 200,
  statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, category: 'x', tags: [],
  checkType: 'status_code', found: false, confidence: 'medium', status: 'maybe', probability, timestamp: 1,
});

function html(props: Parameters<typeof LearningView>[0]): string {
  return renderToStaticMarkup(createElement(LearningView, props));
}

describe('LearningView', () => {
  it('guides labeling via the verdict + progress while still labeling (no separate button)', () => {
    const out = html({ status: { labelCount: 40, meta: null, mlEnabled: false }, queue: [], busy: false, onPrimary: noop, onLabel: noop });
    expect(out).toContain('Keep labeling'); // plain-language next step
    expect(out).toContain('40/80'); // progress milestone (shown twice: verdict + bar)
    expect(out).toContain('Nothing to review'); // empty queue
    expect(out).not.toContain('sl-learning-train-btn'); // no primary button in the labeling state
  });

  it('recommends Enable on a passing verdict', () => {
    const meta = { trainedAt: 1, labelCount: 100, verdict: { pass: true, reason: '' } };
    const out = html({ status: { labelCount: 100, meta, mlEnabled: false }, queue: [], busy: false, onPrimary: noop, onLabel: noop });
    expect(out).toContain('Enable');
    expect(out).toContain('beats the built-in detector');
  });

  it('renders the bounded queue with thumbs and never leaks raw metrics', () => {
    const meta = { trainedAt: 1, labelCount: 100, verdict: { pass: false, reason: 'precision margin 0.02 < 0.05' } };
    const out = html({ status: { labelCount: 100, meta, mlEnabled: false }, queue: [r('q1', 0.5), r('q2', 0.45)], busy: false, onPrimary: noop, onLabel: noop });
    expect(out).toContain('GitHub');
    expect(out).toContain('Real');
    expect(out).toContain('Not real');
    expect(out).not.toMatch(/precision|recall|\bF1\b|0\.02/i);
  });
});
