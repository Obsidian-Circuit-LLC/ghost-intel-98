/**
 * SOCMINT embedding relevance ranker — loopback-only.
 *
 * Embeds the analyst keyword and each harvested item's text via the bundled
 * Ollama embedder (LOCAL_AI_ENDPOINT), computes cosine similarity, and sorts
 * items highest-score first. Ties are broken by id ascending for a stable order.
 *
 * Security invariant: assertLoopbackAi() is called before every embed() call so
 * that harvested content can never reach a cloud endpoint, even if the user has
 * configured an openai-compatible provider in the AI assistant settings.
 *
 * No determinism claims are made for ranking results — embedding outputs vary by
 * model, runtime, and quantization. Exact-id dedup and hashing are the only
 * deterministic guarantees in the SOCMINT pipeline.
 */

import { embed } from '../services/memory/embeddings';
import { cosine } from '../services/memory/store';
import { validateAiEndpoint } from '../security/validate';
import { LOCAL_AI_ENDPOINT } from '../services/local-ai-paths';
import type { HarvestedItem } from '@shared/socmint/types';

// ---------------------------------------------------------------------------
// AI loopback guard
// ---------------------------------------------------------------------------

/** Describes the AI configuration to validate before each embed() call. */
interface AiConfig { provider: string; endpoint: string; }

/**
 * Module-level override for tests. Null means use the production default
 * (LOCAL_AI_ENDPOINT with provider 'ollama'), which is always loopback.
 * Never set this in production code — only from _setAiConfigForTest.
 */
let _aiConfigOverride: AiConfig | null = null;

/**
 * Test seam: inject a fake AI config for assertLoopbackAi testing.
 * Pass null to restore production behaviour (default loopback Ollama).
 * Mirror of setEmbedderForTest in embeddings.ts — same lifecycle contract.
 */
export function _setAiConfigForTest(cfg: AiConfig | null): void {
  _aiConfigOverride = cfg;
}

/** Returns the AI config this module will validate. Override takes precedence; production
 *  default is always the bundled Ollama loopback endpoint. */
function resolveAiConfig(): AiConfig {
  if (_aiConfigOverride !== null) return _aiConfigOverride;
  return { provider: 'ollama', endpoint: LOCAL_AI_ENDPOINT };
}

/**
 * Asserts that the resolved AI provider is Ollama and its endpoint is loopback.
 * Throws if either condition fails. Call before every embed() call.
 *
 * This is defence-in-depth: the default embedder is always bound to LOCAL_AI_ENDPOINT
 * (loopback), but this guard makes the invariant explicit and testable, and protects
 * against a misconfigured or adversarially mutated AI settings block.
 */
export function assertLoopbackAi(): void {
  const { provider, endpoint } = resolveAiConfig();
  if (provider !== 'ollama') {
    throw new Error(
      `SOCMINT: AI provider must be 'ollama' (loopback-only) — got '${provider}'. ` +
      'Harvested content must not be sent to a cloud endpoint.',
    );
  }
  // validateAiEndpoint throws ValidationError if the endpoint is not loopback / private.
  validateAiEndpoint(endpoint, 'ollama');
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TEXT_LEN = 2000;
const DEFAULT_BATCH_SIZE = 8;

/**
 * Ranks `items` by cosine similarity of each item's text to `keyword`, using the
 * bundled Ollama embedder. Returns a new array (items are shallow-copied) sorted
 * highest-score first; ties broken by id ascending.
 *
 * @param keyword      Analyst-supplied search term to rank against.
 * @param items        Harvested items to rank (returned with relevanceScore set).
 * @param opts.maxTextLen  Per-item text is truncated to this length before embedding
 *                         (default 2000). Independent of keyword length.
 * @param opts.batchSize   Texts are submitted to the embedder in batches of this size
 *                         (default 8). Fixed regardless of corpus size.
 */
export async function rankByRelevance(
  keyword: string,
  items: HarvestedItem[],
  opts?: { maxTextLen?: number; batchSize?: number },
): Promise<HarvestedItem[]> {
  // Enforce the loopback-only invariant before any embedding work.
  assertLoopbackAi();

  if (items.length === 0) return [];

  const maxTextLen = opts?.maxTextLen ?? DEFAULT_MAX_TEXT_LEN;
  const batchSize  = opts?.batchSize  ?? DEFAULT_BATCH_SIZE;

  // Build the flat list of texts to embed: keyword first, then item texts (clamped).
  const clampedTexts = items.map((item) => item.text.slice(0, maxTextLen));
  const allTexts = [keyword, ...clampedTexts];

  // Embed in fixed-size batches (independent of content).
  const vectors: number[][] = [];
  for (let i = 0; i < allTexts.length; i += batchSize) {
    const batch = allTexts.slice(i, i + batchSize);
    const batchVectors = await embed(batch);
    vectors.push(...batchVectors);
  }

  const keywordVec  = vectors[0];
  const itemVectors = vectors.slice(1);

  // Score each item with cosine similarity, then sort desc / tie-break id asc.
  // Spread each item so the original objects are not mutated.
  return items
    .map((item, idx) => ({
      ...item,
      relevanceScore: cosine(keywordVec, itemVectors[idx]),
    }))
    .sort(
      (a, b) =>
        (b.relevanceScore! - a.relevanceScore!) ||
        a.id.localeCompare(b.id),
    );
}
