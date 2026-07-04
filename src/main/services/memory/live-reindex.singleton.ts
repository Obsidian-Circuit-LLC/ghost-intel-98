/**
 * Live-reindex singleton — wires the debounced `createLiveReindexer` (live-reindex.ts) to the
 * real indexer + real clock/timer, gated on `settings.ai.useMemory && settings.ai.autoReindex`.
 * Settings are re-read on every notification (so a toggle flip takes effect immediately without
 * restarting the app). Fire-and-forget: callers (save handlers) never await these calls.
 *
 * Reindex failures are best-effort (never break the caller's save), but per the ADHD-UI
 * constraint they must not be entirely silent either — `setErrorNotifier` lets the IPC wiring
 * layer (which owns the renderer window) plug in a rate-limited toast; live-reindex.ts already
 * throttles calls into it so a stuck failure doesn't spam a toast per keystroke-triggered save.
 */
import { settingsStore } from '../../storage/json-fs';
import { reindexCase as realReindexCase, reindexConversations as realReindexConversations, reindexLibrary as realReindexLibrary } from './indexer';
import { createLiveReindexer, type LiveReindexer, type LiveReindexScope } from './live-reindex';

let reindexer: LiveReindexer | null = null;

export type ReindexErrorNotifier = (scope: LiveReindexScope, err: unknown) => void;
// Mutable indirection so wiring can be set at IPC-registration time regardless of whether the
// reindexer singleton has already been constructed (getReindexer() memoizes deps once).
let errorNotifier: ReindexErrorNotifier | null = null;

function getReindexer(): LiveReindexer {
  if (!reindexer) {
    reindexer = createLiveReindexer({
      reindexCase: (caseId) => realReindexCase(caseId),
      reindexConversations: () => realReindexConversations(),
      reindexLibrary: () => realReindexLibrary(),
      now: () => Date.now(),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
      onError: (scope, err) => errorNotifier?.(scope, err)
    });
  }
  return reindexer;
}

async function gateOpen(): Promise<boolean> {
  try {
    const s = await settingsStore.read();
    return Boolean(s.ai.useMemory && s.ai.autoReindex);
  } catch {
    // best-effort: a settings read failure must never break the save path that triggered this
    return false;
  }
}

// Tracks in-flight gate checks so `flush()` (tests + shutdown) can wait for a just-issued
// notification's gate check to resolve before flushing the underlying debounced reindexer.
const pendingGateChecks = new Set<Promise<void>>();

function track(p: Promise<void>): void {
  pendingGateChecks.add(p);
  void p.finally(() => pendingGateChecks.delete(p));
}

export const liveReindex = {
  /** Notify that a case's notes/description/entities/attachments changed. Best-effort, debounced. */
  caseChanged(caseId: string): void {
    track(gateOpen().then((open) => { if (open) getReindexer().caseChanged(caseId); }));
  },

  /** Notify that the conversation log changed. Best-effort, debounced. */
  conversationsChanged(): void {
    track(gateOpen().then((open) => { if (open) getReindexer().conversationsChanged(); }));
  },

  /** Notify that the global document library changed (doc added/removed). Best-effort, debounced. */
  libraryChanged(): void {
    track(gateOpen().then((open) => { if (open) getReindexer().libraryChanged(); }));
  },

  /** Run any pending gate-checked + debounced reindexes now (tests + shutdown). */
  async flush(): Promise<void> {
    while (pendingGateChecks.size) {
      await Promise.all([...pendingGateChecks]);
    }
    if (reindexer) await reindexer.flush();
  },

  /** Wire (or clear, with null) a rate-limited notifier for debounced reindex failures. */
  setErrorNotifier(fn: ReindexErrorNotifier | null): void {
    errorNotifier = fn;
  }
};
