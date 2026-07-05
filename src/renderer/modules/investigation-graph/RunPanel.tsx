/**
 * RunPanel — the per-case run cockpit's 5-state machine (spec §4).
 *
 *   unavailable — `run.available()` false (core today): a calm "reasoning pack" card,
 *                 NO dead Start button.
 *   idle        — brain present, no active run: seed multi-select + objective + budget
 *                 preset; one primary Start, disabled until ≥1 seed AND a non-empty
 *                 objective; calls run.start(caseId, seedIds, objective, budget).
 *   running     — the live feed (rendered plain-language by run-feed) is the centre of
 *                 gravity; Pause/Resume + Stop (with reason) + a compact Authorized-targets
 *                 control (addScope/removeScope). Controls call the request→event fns.
 *   ask         — the run parked on a question: the prompt is THE one action (Send →
 *                 run.answer); nothing else competes while an ask is pending.
 *   terminal    — stopped/done: final status line + Open report (→ onOpenReport(runId)).
 *
 * All run UI state lives in the per-case store (investigation-run-store) so a tab-switch
 * unmount never loses the feed or runId. This component only holds transient form input
 * (selected seeds, objective, budget choice, stop reason, answer/scope drafts) locally.
 */

import { useState } from 'react';
import type { EntityType } from '@shared/types';
import type { RunBudget } from '@shared/investigation-types';
import {
  useInvestigationRunStore,
  emptyRunEntry,
  type RunEntry,
} from '../../state/investigation-run-store';

export type SeedNode = { id: string; value: string; type: EntityType };

export type BudgetPresetName = 'Quick' | 'Standard' | 'Deep';

/** Concrete RunBudget behind each preset. Exported so the run form and tests share one source. */
export const BUDGET_PRESETS: Record<BudgetPresetName, RunBudget> = {
  Quick: { maxPivots: 8, maxDepth: 2, maxWallClockMs: 60_000, maxTokens: 50_000 },
  Standard: { maxPivots: 20, maxDepth: 3, maxWallClockMs: 180_000, maxTokens: 150_000 },
  Deep: { maxPivots: 50, maxDepth: 4, maxWallClockMs: 600_000, maxTokens: 500_000 },
};

export interface RunPanelProps {
  caseId: string;
  /** Scene nodes offered as seeds (click-to-add). */
  nodes: SeedNode[];
  /** Jump to the Report section pre-scoped to this run (terminal state). */
  onOpenReport: (runId?: string) => void;
}

export function RunPanel({ caseId, nodes, onOpenReport }: RunPanelProps): JSX.Element {
  const entry: RunEntry = useInvestigationRunStore((s) => s.cases[caseId]) ?? emptyRunEntry();
  const beginRun = useInvestigationRunStore((s) => s.beginRun);

  const { available, status, runId, feed, pendingAsk } = entry;

  if (available === false) return <UnavailableCard />;
  if (available === null) {
    return (
      <div className="run-panel run-panel--checking">
        <p className="run-panel__muted">Checking for the reasoning pack…</p>
      </div>
    );
  }

  if (status === 'stopped' || status === 'done') {
    return <TerminalView feed={feed} status={status} runId={runId} onOpenReport={onOpenReport} />;
  }
  if (pendingAsk) {
    return <AskView runId={runId} question={pendingAsk} />;
  }
  if (status === 'running' || status === 'paused') {
    return <RunningView status={status} runId={runId} feed={feed} />;
  }
  return <IdleForm caseId={caseId} nodes={nodes} beginRun={beginRun} />;
}

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

function UnavailableCard(): JSX.Element {
  return (
    <div className="run-panel run-panel--unavailable">
      <div className="run-panel__card">
        <h4 className="run-panel__title">Autonomous runs need the reasoning pack</h4>
        <p>
          Once installed, Ghost Intel 98 investigates a seed on its own — fanning out across
          transforms and growing the graph live. For now you can explore the graph and open the
          report.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Idle — start form
// ---------------------------------------------------------------------------

function IdleForm({
  caseId,
  nodes,
  beginRun,
}: {
  caseId: string;
  nodes: SeedNode[];
  beginRun: (caseId: string, runId: string) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const [objective, setObjective] = useState('');
  const [preset, setPreset] = useState<BudgetPresetName>('Standard');
  const [starting, setStarting] = useState(false);

  const toggleSeed = (id: string): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const canStart = selected.length >= 1 && objective.trim().length > 0 && !starting;

  const start = async (): Promise<void> => {
    if (!canStart) return;
    setStarting(true);
    try {
      const runId = await window.api.investigation.run.start(
        caseId,
        selected,
        objective.trim(),
        BUDGET_PRESETS[preset],
      );
      beginRun(caseId, runId);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="run-panel run-panel--idle">
      <fieldset className="run-panel__seeds">
        <legend>Seeds</legend>
        {nodes.length === 0 ? (
          <p className="run-panel__muted">No entities in the graph yet — add one to seed a run.</p>
        ) : (
          <ul className="run-panel__seed-list">
            {nodes.map((n) => {
              const on = selected.includes(n.id);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    data-seed-id={n.id}
                    aria-pressed={on}
                    className={on ? 'run-panel__seed run-panel__seed--on' : 'run-panel__seed'}
                    onClick={() => toggleSeed(n.id)}
                  >
                    {on ? '☑ ' : '☐ '}
                    {n.value} <span className="run-panel__seed-type">({n.type})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <label className="run-panel__field">
        <span>Objective</span>
        <input
          id="run-objective"
          type="text"
          value={objective}
          placeholder="e.g. Map the infrastructure behind this domain"
          onChange={(e) => setObjective(e.target.value)}
        />
      </label>

      <fieldset className="run-panel__budget">
        <legend>Budget</legend>
        {(Object.keys(BUDGET_PRESETS) as BudgetPresetName[]).map((name) => (
          <label key={name} className="run-panel__budget-opt">
            <input
              type="radio"
              name="run-budget"
              value={name}
              checked={preset === name}
              onChange={() => setPreset(name)}
            />
            {name}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="run-panel__primary"
        disabled={!canStart}
        onClick={() => void start()}
      >
        {starting ? 'Starting…' : 'Start investigation'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running (and paused)
// ---------------------------------------------------------------------------

function RunningView({
  status,
  runId,
  feed,
}: {
  status: 'running' | 'paused';
  runId: string | null;
  feed: RunEntry['feed'];
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [scopeTarget, setScopeTarget] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  const actionCount = feed.filter((l) => l.severity === 'action').length;

  const pauseOrResume = async (): Promise<void> => {
    if (!runId) return;
    if (status === 'paused') {
      setHint('Resuming…');
      await window.api.investigation.run.resume(runId);
    } else {
      setHint('Pausing…');
      await window.api.investigation.run.pause(runId);
    }
  };

  const stop = async (): Promise<void> => {
    if (!runId) return;
    setHint('Stopping…');
    await window.api.investigation.run.stop(runId, reason.trim() || 'Stopped by analyst');
  };

  const addScope = async (): Promise<void> => {
    if (!runId || !scopeTarget.trim()) return;
    await window.api.investigation.run.addScope(runId, scopeTarget.trim());
    setScopeTarget('');
  };

  return (
    <div className="run-panel run-panel--running">
      <div className="run-panel__status">
        {status === 'paused' ? 'Paused' : 'Running'} · {actionCount} action
        {actionCount === 1 ? '' : 's'}
        {hint ? <span className="run-panel__hint"> — {hint}</span> : null}
      </div>

      <ul className="run-panel__feed" aria-label="Run activity">
        {feed.map((line, i) => (
          <li key={i} className={`run-panel__feed-line run-panel__feed-line--${line.severity}`}>
            {line.text}
          </li>
        ))}
      </ul>

      <div className="run-panel__controls">
        <button type="button" onClick={() => void pauseOrResume()}>
          {status === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <input
          id="run-stop-reason"
          type="text"
          value={reason}
          placeholder="Reason"
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="button" onClick={() => void stop()}>
          Stop
        </button>
      </div>

      <div className="run-panel__scope">
        <input
          id="run-scope-target"
          type="text"
          value={scopeTarget}
          placeholder="Authorize a target (e.g. evil.tld)"
          onChange={(e) => setScopeTarget(e.target.value)}
        />
        <button type="button" onClick={() => void addScope()}>
          Authorize
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

function AskView({ runId, question }: { runId: string | null; question: string }): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (): Promise<void> => {
    if (!runId || !answer.trim() || sending) return;
    setSending(true);
    try {
      await window.api.investigation.run.answer(runId, answer.trim());
      setAnswer('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="run-panel run-panel--ask">
      <h4 className="run-panel__title">The investigation needs your input</h4>
      <p className="run-panel__question">{question}</p>
      <textarea
        id="run-answer"
        rows={3}
        value={answer}
        placeholder="Your answer…"
        onChange={(e) => setAnswer(e.target.value)}
      />
      <button
        type="button"
        className="run-panel__primary"
        disabled={!answer.trim() || sending}
        onClick={() => void send()}
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

function TerminalView({
  feed,
  status,
  runId,
  onOpenReport,
}: {
  feed: RunEntry['feed'];
  status: 'stopped' | 'done';
  runId: string | null;
  onOpenReport: (runId?: string) => void;
}): JSX.Element {
  // The final feed line carries the stop/done reason (run-feed formats it).
  const last = feed.length > 0 ? feed[feed.length - 1].text : status === 'done' ? 'Done' : 'Stopped';

  return (
    <div className="run-panel run-panel--terminal">
      <div className="run-panel__status run-panel__status--terminal">{last}</div>
      <button
        type="button"
        className="run-panel__primary"
        onClick={() => onOpenReport(runId ?? undefined)}
      >
        Open report
      </button>
    </div>
  );
}
