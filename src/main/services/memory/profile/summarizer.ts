/**
 * Rolling per-scope summary: a short prose paragraph the assistant keeps up to date about a
 * scope (global vault, a case, a subject) as conversations settle. `mergeSummary` is the pure,
 * deterministic fold — no clock/RNG beyond the injected `now`, safe to unit-test exhaustively.
 * `summarizeTurns` is the LLM glue that distills a batch of turns into the next addition; it is
 * explicitly best-effort (loopback Ollama only, per the memory charter) and must never throw —
 * a failure here must never break a chat, so it swallows and falls back to the prior summary.
 */

export interface RollingSummary {
  scope: string;
  text: string;
  updatedAt: number;
}

const DEFAULT_MAX_CHARS = 1200;

/**
 * Fold `addition` onto `prev`, capping the result at `maxChars`. When capping is required the
 * OLDEST content is dropped first (front of the string) so the newest material — the addition,
 * and whatever tail of `prev` still fits — is what survives. The cut point is snapped forward to
 * the next whitespace boundary so the result never starts mid-word.
 */
export function mergeSummary(
  prev: string,
  addition: string,
  now: number,
  maxChars: number = DEFAULT_MAX_CHARS
): RollingSummary {
  const prevTrim = prev.trim();
  const addTrim = addition.trim();
  const merged = prevTrim && addTrim ? `${prevTrim} ${addTrim}` : prevTrim || addTrim;

  return { scope: '', text: capToSafeBoundary(merged, maxChars), updatedAt: now };
}

function capToSafeBoundary(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;

  const sliced = text.slice(text.length - maxChars);
  const boundary = sliced.search(/\s/);
  // No whitespace at all in the slice (one giant token) → nothing safe to trim past; keep as-is.
  if (boundary === -1) return sliced;
  return sliced.slice(boundary + 1);
}

/** Minimal LLM seam — the real implementation wraps the loopback Ollama endpoint; tests inject a fake. */
export interface SummarizerClient {
  complete(prompt: string): Promise<string>;
}

function buildSummaryPrompt(prevSummary: string, turns: string): string {
  return (
    'You maintain a short rolling summary of durable facts learned about the user across ' +
    'conversations. Update the summary below given the new conversation turns. Keep it concise ' +
    'prose, no preamble.\n\n' +
    `Prior summary:\n${prevSummary || '(none yet)'}\n\n` +
    `New turns:\n${turns}\n\n` +
    'Updated summary:'
  );
}

/**
 * Best-effort distillation of `turns` into an updated summary via an injected LLM client.
 * Never throws: any client failure (network down, bad response, etc.) falls back to returning
 * `prevSummary` unchanged so the caller's flow (learning after a conversation) is never broken.
 */
export async function summarizeTurns(client: SummarizerClient, prevSummary: string, turns: string): Promise<string> {
  try {
    const result = await client.complete(buildSummaryPrompt(prevSummary, turns));
    return typeof result === 'string' ? result : prevSummary;
  } catch {
    return prevSummary;
  }
}
