/**
 * Best-effort profile-item extraction: distill a batch of conversation turns into candidate
 * `MemoryItem` facts via an injected LLM client (loopback Ollama only, per the memory charter).
 * `parseCandidates` is the pure, tolerant parser — it never throws, and returns `[]` on anything
 * it cannot make sense of, so a malformed/creative model response degrades to "learned nothing"
 * rather than corrupting the profile. `extractItems` is the thin best-effort glue: a network
 * failure or a throwing client must never break the calling chat.
 */
import type { ReconcileCandidate } from './reconcile';

export interface ExtractorClient {
  complete(prompt: string): Promise<string>;
}

function textOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed ? trimmed : undefined;
  }
  if (entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string') {
    const trimmed = (entry as { text: string }).text.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function fromArray(parsed: unknown[], scope: string, provenance: string[]): ReconcileCandidate[] {
  const out: ReconcileCandidate[] = [];
  for (const entry of parsed) {
    const text = textOf(entry);
    if (text) out.push({ scope, text, provenance: [...provenance] });
  }
  return out;
}

function fromJsonLines(raw: string, scope: string, provenance: string[]): ReconcileCandidate[] {
  const out: ReconcileCandidate[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const text = textOf(parsed);
      if (text) out.push({ scope, text, provenance: [...provenance] });
    } catch {
      // not a JSON line — skip it rather than fail the whole batch
    }
  }
  return out;
}

/**
 * Tolerant parse of a model completion into candidates: tries a single JSON array first, then
 * falls back to JSON-lines (one JSON value per line). Anything else — prose, empty input, plain
 * garbage — parses to `[]` rather than throwing.
 */
export function parseCandidates(raw: string, scope: string, provenance: string[]): ReconcileCandidate[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return fromArray(parsed, scope, provenance);
  } catch {
    // fall through to JSON-lines
  }

  return fromJsonLines(trimmed, scope, provenance);
}

function buildExtractionPrompt(turns: string): string {
  return (
    'Extract durable facts worth remembering long-term about the user from the conversation turns ' +
    'below (preferences, identities, recurring context — not one-off trivia). Respond with ONLY a ' +
    'JSON array of short fact strings, e.g. ["Uses Tor-only egress"]. If there is nothing durable ' +
    'to remember, respond with [].\n\n' +
    `Conversation turns:\n${turns}\n\n` +
    'JSON array:'
  );
}

/**
 * Best-effort extraction: never throws. A client failure (loopback Ollama unreachable, bad
 * response, etc.) or an unparsable completion both degrade to `[]` — the caller's learning flow
 * must never break a chat.
 */
export async function extractItems(
  client: ExtractorClient,
  turns: string,
  scope: string,
  provenance: string[]
): Promise<ReconcileCandidate[]> {
  try {
    const raw = await client.complete(buildExtractionPrompt(turns));
    return parseCandidates(typeof raw === 'string' ? raw : '', scope, provenance);
  } catch {
    return [];
  }
}
