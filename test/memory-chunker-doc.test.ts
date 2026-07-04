import { describe, it, expect } from 'vitest';
import { chunkText, type ChunkKind } from '../src/main/services/memory/chunker';
describe("chunker 'doc' kind", () => {
  it('chunks a doc source with kind doc', () => {
    const kind: ChunkKind = 'doc';
    const out = chunkText(kind, 'report.pdf', 'hello world '.repeat(200));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].kind).toBe('doc');
  });
});
