/**
 * Chat stream stall-watchdog. Electron-free so it unit-tests in isolation.
 *
 * Root cause it addresses: the assistant's streaming loop (`streamOllama`/`streamOpenAi` in `ai.ts`)
 * awaited `reader.read()` with no inactivity bound. Its only AbortSignal fired on explicit user
 * cancel, so when Ollama accepted a request and then silently stalled mid-generation (common under
 * VRAM pressure — e.g. right after an upload loads the embed model or forces a chat-model swap),
 * `reader.read()` blocked forever, nothing threw, and the `done` event was never emitted. The UI
 * "stopped responding" until the app was restarted (which aborts the session).
 *
 * `readWithIdleTimeout` puts a wall-clock ceiling on a single read: if no data arrives within `ms`,
 * it cancels the reader (freeing the socket) and rejects. The caller re-arms it per read, so the
 * ceiling is *per-gap*, not per-request — a healthy stream that keeps producing tokens never trips
 * it. A tripped read throws up to the chat catch, which emits `{error, done:true}` and the UI
 * recovers with a clear message instead of hanging.
 */

/** Default per-gap idle ceiling. Generous enough to survive a cold model load (first token can lag
 *  tens of seconds while Ollama loads a multi-GB model), still bounded so a truly stuck generation
 *  surfaces an error rather than hanging forever. Between tokens, gaps are sub-second, so a healthy
 *  stream never approaches this. */
export const CHAT_IDLE_TIMEOUT_MS = 120_000;

/** Minimal structural result shape (avoids the DOM-lib `ReadableStreamReadResult`, absent from the
 *  main-process tsconfig lib). Compatible with what `ReadableStreamDefaultReader.read()` returns. */
export interface ReadChunk<T> { value?: T; done: boolean }

/** Minimal shape of the stream reader we depend on (a subset of ReadableStreamDefaultReader). */
export interface IdleReader<T> {
  read(): Promise<ReadChunk<T>>;
  cancel?(reason?: unknown): Promise<void>;
}

/**
 * Await one `reader.read()` but reject if it produces nothing within `ms`. On timeout the reader is
 * cancelled (best-effort — closes the underlying HTTP body) before rejecting, so a stalled socket is
 * not leaked. On a timely read the timer is cleared and the chunk passes through unchanged.
 */
export function readWithIdleTimeout<T>(
  reader: IdleReader<T>,
  ms: number = CHAT_IDLE_TIMEOUT_MS
): Promise<ReadChunk<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Free the socket, then surface the stall. cancel() rejection is irrelevant — we're erroring out.
      void reader.cancel?.(new Error('idle timeout')).catch(() => {});
      reject(new Error(`The model stopped responding (no output for ${Math.round(ms / 1000)}s). It may be overloaded or stuck — try again.`));
    }, ms);
  });
  return Promise.race([reader.read(), idle]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
