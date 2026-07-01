/**
 * Live reindex scheduler — debounces repeated case/conversation change notifications into a
 * single reindex call so a burst of saves (e.g. autosave-on-keystroke) doesn't hammer the
 * embedder. Best-effort: a failing reindex is swallowed (never breaks the caller's save path).
 * Clock + timer are injected for determinism (no Date.now/setTimeout in this module directly).
 */

export interface LiveReindexDeps {
  reindexCase(caseId: string): Promise<unknown>;
  reindexConversations(): Promise<unknown>;
  now(): number;                 // injected clock (determinism)
  schedule(fn: () => void, ms: number): unknown; // injected timer
  cancel(handle: unknown): void;
}

export interface LiveReindexer {
  caseChanged(caseId: string): void;   // debounced → reindexCase
  conversationsChanged(): void;         // debounced → reindexConversations
  flush(): Promise<void>;               // run pending now (tests + shutdown)
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function createLiveReindexer(deps: LiveReindexDeps, debounceMs: number = DEFAULT_DEBOUNCE_MS): LiveReindexer {
  const pendingCases = new Map<string, unknown>(); // caseId -> timer handle
  let pendingConversations: unknown | null = null; // timer handle or null
  const inFlight: Promise<unknown>[] = [];

  const runCase = (caseId: string): void => {
    pendingCases.delete(caseId);
    const p = Promise.resolve()
      .then(() => deps.reindexCase(caseId))
      .catch(() => { /* best-effort: swallow reindex errors */ });
    inFlight.push(p);
  };

  const runConversations = (): void => {
    pendingConversations = null;
    const p = Promise.resolve()
      .then(() => deps.reindexConversations())
      .catch(() => { /* best-effort: swallow reindex errors */ });
    inFlight.push(p);
  };

  return {
    caseChanged(caseId: string): void {
      const existing = pendingCases.get(caseId);
      if (existing !== undefined) deps.cancel(existing);
      const handle = deps.schedule(() => runCase(caseId), debounceMs);
      pendingCases.set(caseId, handle);
    },

    conversationsChanged(): void {
      if (pendingConversations !== null) deps.cancel(pendingConversations);
      pendingConversations = deps.schedule(() => runConversations(), debounceMs);
    },

    async flush(): Promise<void> {
      // Fire any still-pending timers immediately, then wait for everything in flight.
      for (const [caseId, handle] of [...pendingCases.entries()]) {
        deps.cancel(handle);
        runCase(caseId);
      }
      if (pendingConversations !== null) {
        deps.cancel(pendingConversations);
        runConversations();
      }
      // Drain inFlight, including any promises pushed while awaiting (best-effort loop).
      while (inFlight.length) {
        const batch = inFlight.splice(0, inFlight.length);
        await Promise.all(batch);
      }
    }
  };
}
