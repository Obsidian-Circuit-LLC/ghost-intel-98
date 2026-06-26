/**
 * Task 6: Embedding relevance ranking — loopback-only guard.
 *
 * Tests:
 *  1. rankByRelevance: items ranked by cosine similarity to keyword, descending.
 *  2. rankByRelevance: equal-score items tie-break by id ascending (stable order).
 *  3. rankByRelevance: relevanceScore is set on each returned item.
 *  4. rankByRelevance: does not mutate original items.
 *  5. rankByRelevance: item text clamped to maxTextLen before embedding.
 *  6. rankByRelevance: embeds in fixed batchSize chunks regardless of input.
 *  7. rankByRelevance: returns [] for empty input.
 *  8. assertLoopbackAi: does not throw for loopback Ollama config.
 *  9. assertLoopbackAi: throws when provider is not ollama.
 * 10. assertLoopbackAi: throws when endpoint is a cloud (non-loopback) URL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setEmbedderForTest } from '@main/services/memory/embeddings';
import {
  rankByRelevance,
  assertLoopbackAi,
  _setAiConfigForTest,
} from '@main/socmint/rank';
import type { HarvestedItem } from '@shared/socmint/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, text: string, overrides: Partial<HarvestedItem> = {}): HarvestedItem {
  return {
    id,
    platform: 'telegram',
    authorHandle: '@test',
    authorId: '123',
    text,
    channelId: '-100',
    channelLabel: 'Test Channel',
    messageId: id,
    publishedAt: '2026-01-01T00:00:00Z',
    harvestedAt: '2026-01-01T00:00:01Z',
    url: 'https://t.me/test/1',
    provenance: { collectorVersion: '1.0.0', jobId: 'job1', caseId: 'case1' },
    ...overrides,
  };
}

// Controlled embedder — maps specific text strings to 2-D vectors.
// keyword  →  [1, 0]
// "apple"  →  [0.9, 0.1]  (high similarity to keyword)
// "cherry" →  [0.5, 0.5]  (moderate similarity)
// "banana" →  [0.1, 0.9]  (low similarity)
// anything else → [0, 0]   (zero vector → cosine returns 0)
const CONTROLLED_VECS: Record<string, number[]> = {
  keyword:       [1,   0  ],
  'apple text':  [0.9, 0.1],
  'cherry text': [0.5, 0.5],
  'banana text': [0.1, 0.9],
};

function controlledEmbedder(texts: string[]): Promise<number[][]> {
  return Promise.resolve(texts.map((t) => CONTROLLED_VECS[t] ?? [0, 0]));
}

// ---------------------------------------------------------------------------
// rankByRelevance
// ---------------------------------------------------------------------------

describe('rankByRelevance — ordering', () => {
  beforeEach(() => {
    setEmbedderForTest(controlledEmbedder);
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434' });
  });

  afterEach(() => {
    setEmbedderForTest(null);
    _setAiConfigForTest(null);
  });

  it('returns an empty array for empty input', async () => {
    const result = await rankByRelevance('keyword', []);
    expect(result).toEqual([]);
  });

  it('ranks items by cosine similarity descending', async () => {
    const items = [
      makeItem('b', 'banana text'),
      makeItem('a', 'apple text'),
      makeItem('c', 'cherry text'),
    ];
    const ranked = await rankByRelevance('keyword', items);
    // cosine: apple > cherry > banana
    expect(ranked[0].id).toBe('a');
    expect(ranked[1].id).toBe('c');
    expect(ranked[2].id).toBe('b');
  });

  it('sets relevanceScore on each returned item', async () => {
    const items = [makeItem('a', 'apple text'), makeItem('b', 'banana text')];
    const ranked = await rankByRelevance('keyword', items);
    for (const item of ranked) {
      expect(typeof item.relevanceScore).toBe('number');
    }
    // apple gets a higher score than banana
    const a = ranked.find((i) => i.id === 'a')!;
    const b = ranked.find((i) => i.id === 'b')!;
    expect(a.relevanceScore!).toBeGreaterThan(b.relevanceScore!);
  });

  it('does not mutate original items (relevanceScore absent before, still absent after)', async () => {
    const item = makeItem('a', 'apple text');
    expect(item.relevanceScore).toBeUndefined();
    await rankByRelevance('keyword', [item]);
    expect(item.relevanceScore).toBeUndefined();
  });
});

describe('rankByRelevance — tie-break by id asc', () => {
  beforeEach(() => {
    // All unknown texts map to [0,0] → equal cosine (0) → force tie-break
    setEmbedderForTest(controlledEmbedder);
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434' });
  });

  afterEach(() => {
    setEmbedderForTest(null);
    _setAiConfigForTest(null);
  });

  it('tie-breaks by id ascending when all cosine scores are equal', async () => {
    const items = [
      makeItem('z-item', 'unknown z'),
      makeItem('a-item', 'unknown a'),
      makeItem('m-item', 'unknown m'),
    ];
    const ranked = await rankByRelevance('keyword', items);
    expect(ranked[0].id).toBe('a-item');
    expect(ranked[1].id).toBe('m-item');
    expect(ranked[2].id).toBe('z-item');
  });
});

describe('rankByRelevance — maxTextLen', () => {
  afterEach(() => {
    setEmbedderForTest(null);
    _setAiConfigForTest(null);
  });

  it('clamps item text to maxTextLen before embedding', async () => {
    const captured: string[][] = [];
    setEmbedderForTest((texts) => {
      captured.push([...texts]);
      return Promise.resolve(texts.map(() => [0, 0]));
    });
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434' });

    const longText = 'x'.repeat(5000);
    await rankByRelevance('keyword', [makeItem('a', longText)], { maxTextLen: 100 });

    // The batch contains keyword + one item text; item text must be ≤ 100 chars
    const allTexts = captured.flat();
    const itemTexts = allTexts.filter((t) => t !== 'keyword');
    for (const t of itemTexts) {
      expect(t.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('rankByRelevance — batchSize', () => {
  afterEach(() => {
    setEmbedderForTest(null);
    _setAiConfigForTest(null);
  });

  it('embeds in fixed batchSize chunks (1 keyword + n items split into ceil batches)', async () => {
    const batchSizes: number[] = [];
    setEmbedderForTest((texts) => {
      batchSizes.push(texts.length);
      return Promise.resolve(texts.map(() => [1, 0]));
    });
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434' });

    // 1 keyword + 9 items = 10 texts; batchSize=4 → batches of sizes [4, 4, 2]
    const items = Array.from({ length: 9 }, (_, i) => makeItem(`item-${i}`, `text ${i}`));
    await rankByRelevance('keyword', items, { batchSize: 4 });

    expect(batchSizes).toEqual([4, 4, 2]);
  });
});

// ---------------------------------------------------------------------------
// assertLoopbackAi
// ---------------------------------------------------------------------------

describe('assertLoopbackAi', () => {
  afterEach(() => {
    _setAiConfigForTest(null);
  });

  it('does not throw for loopback Ollama endpoint', () => {
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'http://127.0.0.1:11434' });
    expect(() => assertLoopbackAi()).not.toThrow();
  });

  it('does not throw for localhost Ollama endpoint', () => {
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'http://localhost:11434' });
    expect(() => assertLoopbackAi()).not.toThrow();
  });

  it('throws when provider is openai-compatible (not ollama)', () => {
    _setAiConfigForTest({ provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1' });
    expect(() => assertLoopbackAi()).toThrow();
  });

  it('throws when provider is none', () => {
    _setAiConfigForTest({ provider: 'none', endpoint: 'http://127.0.0.1:11434' });
    expect(() => assertLoopbackAi()).toThrow();
  });

  it('throws when provider is ollama but endpoint is a public cloud URL', () => {
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'https://api.openai.com/v1' });
    expect(() => assertLoopbackAi()).toThrow();
  });

  it('throws when provider is ollama but endpoint is a non-loopback https URL', () => {
    _setAiConfigForTest({ provider: 'ollama', endpoint: 'https://myserver.example.com:11434' });
    expect(() => assertLoopbackAi()).toThrow();
  });
});
