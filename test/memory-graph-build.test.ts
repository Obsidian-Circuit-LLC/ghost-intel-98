import { describe, it, expect } from 'vitest';
import { buildNodes } from '../src/main/services/memory/graph/build';
import type { MemoryShard } from '../src/main/services/memory/store';

const shard = (caseId: string, title: string, chunks: any[]): MemoryShard =>
  ({ version: 1, model: 'nomic-embed-text', caseId, title, sources: {}, chunks });

describe('graph build', () => {
  it('makes one doc node per library doc source, vector = mean of its chunks', () => {
    const lib = shard('__library__', 'Library', [
      { id: 'doc:1#0', sourceKey: 'doc:1', kind: 'doc', ref: 'a.txt', text: 'x', vector: [1, 0] },
      { id: 'doc:1#1', sourceKey: 'doc:1', kind: 'doc', ref: 'a.txt', text: 'y', vector: [3, 0] }
    ]);
    const nodes = buildNodes({ shards: [lib], profile: [] });
    const doc = nodes.find((n) => n.kind === 'doc');
    expect(doc?.label).toBe('a.txt');
    expect(doc?.vector).toEqual([2, 0]); // mean
  });
});
