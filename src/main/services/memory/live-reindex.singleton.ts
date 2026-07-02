/**
 * Live-reindex singleton — wires the debounced `createLiveReindexer` (live-reindex.ts) to the
 * real indexer + real clock/timer, gated on `settings.ai.useMemory && settings.ai.autoReindex`.
 * Settings are re-read on every notification (so a toggle flip takes effect immediately without
 * restarting the app). Fire-and-forget: callers (save handlers) never await these calls.
 */
import { settingsStore } from '../../storage/json-fs';
import { reindexCase as realReindexCase, reindexConversations as realReindexConversations } from './indexer';
import { createLiveReindexer, type LiveReindexer } from './live-reindex';

let reindexer: LiveReindexer | null = null;

function getReindexer(): LiveReindexer {
  if (!reindexer) {
    reindexer = createLiveReindexer({
      reindexCase: (caseId) => realReindexCase(caseId),
      reindexConversations: () => realReindexConversations(),
      now: () => Date.now(),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as NodeJS.Timeout)
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

  /** Run any pending gate-checked + debounced reindexes now (tests + shutdown). */
  async flush(): Promise<void> {
    while (pendingGateChecks.size) {
      await Promise.all([...pendingGateChecks]);
    }
    if (reindexer) await reindexer.flush();
  }
};
