/**
 * Embeddings provider — turns text into vectors via the SAME bundled Ollama runtime the chat uses,
 * over its loopback /api/embeddings endpoint. No new dependency, no network egress beyond 127.0.0.1.
 * The implementation is injectable so the indexer/retriever can be unit-tested without a live model.
 */
import { LOCAL_AI_ENDPOINT } from '../local-ai-paths';
import { ensureRuntime } from '../local-ai';

export const EMBED_MODEL = 'nomic-embed-text';
export const EMBED_DIM = 768;

export type Embedder = (texts: string[]) => Promise<number[][]>;

/** Default embedder: ensure the runtime is up, then embed each text via /api/embeddings. */
const defaultEmbed: Embedder = async (texts) => {
  if (texts.length === 0) return [];
  await ensureRuntime();
  const out: number[][] = [];
  for (const prompt of texts) {
    const res = await fetch(`${LOCAL_AI_ENDPOINT}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`Embeddings: HTTP ${res.status} ${res.statusText} (is the "${EMBED_MODEL}" model present?)`);
    const body = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(body.embedding)) throw new Error('Embeddings: malformed response (no embedding array).');
    out.push(body.embedding);
  }
  return out;
};

let impl: Embedder = defaultEmbed;
export function setEmbedderForTest(fn: Embedder | null): void { impl = fn ?? defaultEmbed; }

export function embed(texts: string[]): Promise<number[][]> { return impl(texts); }
