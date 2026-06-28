/**
 * Pure view-model for the Searchlight adaptive-learning UI.
 *
 * Encodes the ADHD-friendly UX rules so the LearningPanel stays a thin shell:
 *   - bounded, prioritized labeling queue (one short chunk, not the whole sweep)
 *   - progress toward a concrete milestone
 *   - a single clear next action at any moment
 *   - plain-language verdict (NEVER raw precision/recall/F1)
 *
 * Pure module — no Date.now / no Math.random / no I/O.
 */

import type { SweepResult } from './types';
import type { LearningModelMeta } from '../ipc-contracts';

/** Labels needed before a model can be meaningfully evaluated (the gate's soft-404 minimum). */
export const MIN_LABELS = 80;
/** Max items shown in the labeling queue at once — a bounded, finite chunk. */
export const QUEUE_CAP = 10;

export type LearningState =
  | 'labeling'
  | 'ready_to_train'
  | 'ready_to_enable'
  | 'on'
  | 'needs_more';

export interface LearningStatus {
  labelCount: number;
  meta: LearningModelMeta | null;
  mlEnabled: boolean;
}

/**
 * The active-learning queue: unlabeled `maybe` results (the uncertain candidates
 * the model learns most from), strongest-first, capped to one bounded chunk.
 */
export function prioritizedQueue(results: SweepResult[], labeled: Set<string>): SweepResult[] {
  return results
    .filter((r) => r.status === 'maybe' && !labeled.has(r.id))
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
    .slice(0, QUEUE_CAP);
}

/** Progress toward the evaluation milestone, capped at 100%. */
export function progress(labelCount: number): { value: number; target: number; pct: number } {
  return {
    value: labelCount,
    target: MIN_LABELS,
    pct: Math.min(100, Math.round((labelCount / MIN_LABELS) * 100)),
  };
}

/**
 * The single next action + plain-language verdict for the current status.
 * Returns the ONE thing the user should do now and a sentence explaining where
 * they stand — no metrics, ever.
 */
export function nextAction(status: LearningStatus | null): {
  state: LearningState;
  label: string;
  verdict: string;
} {
  const labelCount = status?.labelCount ?? 0;
  const meta = status?.meta ?? null;
  const mlEnabled = status?.mlEnabled ?? false;

  if (labelCount < MIN_LABELS) {
    return {
      state: 'labeling',
      label: 'Label results to teach the detector',
      verdict: `Keep labeling — ${labelCount}/${MIN_LABELS} until your model can be checked.`,
    };
  }
  if (mlEnabled) {
    return {
      state: 'on',
      label: 'Retrain',
      verdict: 'ML is on — beating the built-in detector on your cases.',
    };
  }
  if (meta && meta.verdict.pass) {
    return {
      state: 'ready_to_enable',
      label: 'Enable — beats the built-in detector',
      verdict: 'Your model now beats the built-in detector on your cases.',
    };
  }
  if (meta && !meta.verdict.pass) {
    return {
      state: 'needs_more',
      label: 'Train again',
      verdict: "Not yet — your model doesn't beat the built-in detector. Label more, then retrain.",
    };
  }
  return {
    state: 'ready_to_train',
    label: 'Train now',
    verdict: 'You have enough labels — train to check if your model beats the built-in detector.',
  };
}
