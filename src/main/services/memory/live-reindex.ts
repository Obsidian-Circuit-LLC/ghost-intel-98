/**
 * Live reindex scheduler — debounces repeated case/conversation change notifications into a
 * single reindex call so a burst of saves (e.g. autosave-on-keystroke) doesn't hammer the
 * embedder. Best-effort: a failing reindex is swallowed (never breaks the caller's save path).
 * Clock + timer are injected for determinism (no Date.now/setTimeout in this module directly).
 *
 * A reindex failure is never re-thrown (the caller's save path must stay silent-safe), but it is
 * NOT silently dropped either: `deps.onError` (optional) is invoked so the wiring layer can
 * surface a user-facing signal. Because a stuck failure would otherwise refire on every
 * debounced retry (e.g. every keystroke-triggered autosave), `onError` calls themselves are
 * rate-limited via the injected clock so the user gets at most one notification per
 * `ERROR_NOTIFY_MIN_INTERVAL_MS`, not a toast per keystroke.
 */

export type LiveReindexScope = 'case' | 'conversations' | 'library';

export interface LiveReindexDeps {
  reindexCase(caseId: string): Promise<unknown>;
  reindexConversations(): Promise<unknown>;
  // Optional so existing callers/tests that construct a LiveReindexDeps without it keep
  // compiling — libraryChanged() only reads it when actually invoked.
  reindexLibrary?(): Promise<unknown>;
  now(): number;                 // injected clock (determinism)
  schedule(fn: () => void, ms: number): unknown; // injected timer
  cancel(handle: unknown): void;
  // Optional: called (rate-limited, see ERROR_NOTIFY_MIN_INTERVAL_MS) when a debounced reindex
  // rejects. The reindex itself is still swallowed either way — this is purely a notification hook.
  onError?(scope: LiveReindexScope, err: unknown): void;
}

/** Minimum spacing between onError notifications, so a stuck failure doesn't spam a toast per keystroke. */
export const ERROR_NOTIFY_MIN_INTERVAL_MS = 30_000;

export interface LiveReindexer {
  caseChanged(caseId: string): void;   // debounced → reindexCase
  conversationsChanged(): void;         // debounced → reindexConversations
  libraryChanged(): void;               // debounced → reindexLibrary
  flush(): Promise<void>;               // run pending now (tests + shutdown)
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function createLiveReindexer(deps: LiveReindexDeps, debounceMs: number = DEFAULT_DEBOUNCE_MS): LiveReindexer {
  const pendingCases = new Map<string, unknown>(); // caseId -> timer handle
  let pendingConversations: unknown | null = null; // timer handle or null
  let pendingLibrary: unknown | null = null;       // timer handle or null
  const inFlight: Promise<unknown>[] = [];

  // Rate-limits deps.onError so a persistently-failing reindex (e.g. the embed engine down)
  // notifies at most once per ERROR_NOTIFY_MIN_INTERVAL_MS instead of once per debounce cycle.
  let lastErrorNotifyAt = -Infinity;
  const notifyError = (scope: LiveReindexScope, err: unknown): void => {
    if (!deps.onError) return;
    const t = deps.now();
    if (t - lastErrorNotifyAt < ERROR_NOTIFY_MIN_INTERVAL_MS) return;
    lastErrorNotifyAt = t;
    try {
      deps.onError(scope, err);
    } catch { /* the notifier itself must never break the best-effort reindex path */ }
  };

  const runCase = (caseId: string): void => {
    pendingCases.delete(caseId);
    const p = Promise.resolve()
      .then(() => deps.reindexCase(caseId))
      .catch((err) => { notifyError('case', err); /* best-effort: swallow reindex errors */ });
    inFlight.push(p);
  };

  const runConversations = (): void => {
    pendingConversations = null;
    const p = Promise.resolve()
      .then(() => deps.reindexConversations())
      .catch((err) => { notifyError('conversations', err); /* best-effort: swallow reindex errors */ });
    inFlight.push(p);
  };

  const runLibrary = (): void => {
    pendingLibrary = null;
    const p = Promise.resolve()
      .then(() => (deps.reindexLibrary ? deps.reindexLibrary() : undefined))
      .catch((err) => { notifyError('library', err); /* best-effort: swallow reindex errors */ });
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

    libraryChanged(): void {
      if (pendingLibrary !== null) deps.cancel(pendingLibrary);
      pendingLibrary = deps.schedule(() => runLibrary(), debounceMs);
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
      if (pendingLibrary !== null) {
        deps.cancel(pendingLibrary);
        runLibrary();
      }
      // Drain inFlight, including any promises pushed while awaiting (best-effort loop).
      while (inFlight.length) {
        const batch = inFlight.splice(0, inFlight.length);
        await Promise.all(batch);
      }
    }
  };
}
