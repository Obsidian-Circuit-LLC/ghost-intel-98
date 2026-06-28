/**
 * Learning tab container: wires the personal-corpus IPC + the active case's
 * sweep results into the presentational LearningView.
 *
 * - Loads learning status on mount (label count, last-train verdict, ML on/off).
 * - Builds the bounded active-learning queue from the active case's results.
 * - Labels go to the main process (which attaches the captured feature vector).
 * - The single primary action trains / enables / retrains per the view-model.
 *
 * No silent change: enabling ML is the user's explicit click on a passing verdict.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchlightStore } from '../store';
import { LearningView } from './LearningView';
import { nextAction, prioritizedQueue } from '@shared/searchlight/learning-view';
import type { LearningStatus } from '@shared/searchlight/learning-view';

export default function LearningPanel(): JSX.Element {
  const store = useSearchlightStore();
  const activeCaseId = store.activeCaseId;
  const activeCase = store.cases.find((c) => c.id === activeCaseId);

  const allResults = useMemo(
    () => activeCase?.searches.flatMap((j) => j.results) ?? [],
    [activeCase],
  );

  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [labeled, setLabeled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await window.api.searchlight.learningStatus();
    setStatus(s);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const queue = useMemo(() => prioritizedQueue(allResults, labeled), [allResults, labeled]);

  const onLabel = useCallback(
    async (resultId: string, label: 0 | 1) => {
      if (!activeCaseId) return;
      const r = allResults.find((x) => x.id === resultId);
      await window.api.searchlight.labelResult({ resultId, label, siteName: r?.siteName ?? '', caseId: activeCaseId });
      setLabeled((prev) => new Set(prev).add(resultId)); // immediate feedback: drops out of the queue
      void refresh();
    },
    [activeCaseId, allResults, refresh],
  );

  const onPrimary = useCallback(async () => {
    const action = nextAction(status);
    setBusy(true);
    try {
      if (action.state === 'ready_to_enable') {
        await window.api.searchlight.setMlEnabled(true);
      } else if (action.state === 'ready_to_train' || action.state === 'needs_more' || action.state === 'on') {
        await window.api.searchlight.trainModel();
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [status, refresh]);

  return <LearningView status={status} queue={queue} busy={busy} onPrimary={onPrimary} onLabel={onLabel} />;
}
