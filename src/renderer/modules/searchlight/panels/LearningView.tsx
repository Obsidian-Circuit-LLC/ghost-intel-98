/**
 * Presentational view for the Searchlight Learning tab.
 *
 * Pure props-in / callbacks-out — no store, no IPC — so it renders in tests via
 * renderToStaticMarkup and stays free of side effects. The container
 * (LearningPanel.tsx) owns the IPC + store wiring.
 *
 * ADHD-friendly: one clear next action, a bounded queue, plain-language verdict
 * (never raw metrics), and a visible progress milestone.
 */

import { nextAction, progress } from '@shared/searchlight/learning-view';
import type { LearningStatus } from '@shared/searchlight/learning-view';
import type { SweepResult } from '@shared/searchlight/types';

export interface LearningViewProps {
  status: LearningStatus | null;
  queue: SweepResult[];
  busy: boolean;
  /** Run the single primary action for the current state (train / enable / retrain). */
  onPrimary: () => void;
  /** Record a real(1)/not-real(0) label for a queued result. */
  onLabel: (resultId: string, label: 0 | 1) => void;
}

export function LearningView({ status, queue, busy, onPrimary, onLabel }: LearningViewProps): JSX.Element {
  const action = nextAction(status);
  const prog = progress(status?.labelCount ?? 0);

  return (
    <div className="sl-learning-root">
      <div className="sl-learning-toolbar">
        <span className="sl-learning-status-box">{action.verdict}</span>
        <div className="sl-learning-progress" title={`${prog.value}/${prog.target} labels`}>
          <div className="sl-learning-progress-fill" style={{ width: `${prog.pct}%` }} />
          <span className="sl-learning-progress-text">{prog.value}/{prog.target}</span>
        </div>
        {/* The single next action — only the labeling state has no button (the queue IS the action). */}
        {action.state !== 'labeling' && (
          <button className="sl-learning-train-btn" disabled={busy} onClick={onPrimary}>
            {busy ? 'Working…' : action.label}
          </button>
        )}
      </div>

      <div className="sl-learning-queue">
        {queue.length === 0 ? (
          <div className="sl-learning-empty">
            Nothing to review right now — run a sweep, or come back once more results come in.
          </div>
        ) : (
          <table className="sl-learning-maybe-table">
            <tbody>
              {queue.map((r) => (
                <tr key={r.id} className="sl-learning-maybe-row">
                  <td className="sl-learning-maybe-td">{r.siteName}</td>
                  <td className="sl-learning-maybe-td">
                    <span className="sl-learning-prob-badge">● {Math.round((r.probability ?? 0) * 100)}%</span>
                  </td>
                  <td className="sl-learning-maybe-td">
                    <button className="sl-learning-thumb sl-learning-real" title="Real match" onClick={() => onLabel(r.id, 1)}>
                      👍 Real
                    </button>
                    <button className="sl-learning-thumb sl-learning-fake" title="False positive" onClick={() => onLabel(r.id, 0)}>
                      👎 Not real
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
