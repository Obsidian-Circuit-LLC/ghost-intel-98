import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// sources.ts imports the real journal store (for entryPlainText) + briefcase + library store, all of
// which transitively reach electron/secure-fs at import; mock electron so the import resolves without
// a runtime. The store fns themselves are dependency-injected below, so no real fs is touched.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-journal-libsource-test' } }));

import { librarySources } from '../src/main/services/memory/library/sources';

const emptyLibrary = { list: async () => [], readText: async () => '' } as any;

describe('librarySources — journal block entries reach the index', () => {
  it('flattens an entry\'s blocks to indexable text (regression: not the dead body field)', async () => {
    // body is undefined post-migration; the text now lives in blocks. Before the fix, librarySources
    // read entry.body and silently dropped every block-model entry from the local-AI memory index.
    const entry = {
      id: 'j1', title: 'Op notes', createdAt: 'x', updatedAt: 'x',
      blocks: [
        { id: 'b1', kind: 'text', html: '<p>Traced <b>CombatBeat</b> to a second handle.</p>' },
        { id: 'b2', kind: 'image', assetRef: 'u.png', widthPct: 60, caption: 'the DM screenshot' }
      ]
    };
    const sources = await librarySources({
      library: emptyLibrary,
      briefcaseList: async () => [],
      briefcaseRead: async () => null as any,
      journalList: async () => [{ id: 'j1', title: 'Op notes', updatedAt: 'x', bytes: 1 }],
      journalRead: async () => entry as any
    });
    const j = sources.find((s) => s.key === 'journal:j1');
    expect(j).toBeTruthy();
    expect(j!.ref).toBe('Op notes');
    expect(j!.text).toContain('Traced CombatBeat to a second handle.');
    expect(j!.text).toContain('the DM screenshot'); // image caption is included
    expect(j!.text).not.toContain('<b>'); // markup stripped, not indexed as tags
  });

  it('skips an entry with no visible text', async () => {
    const sources = await librarySources({
      library: emptyLibrary,
      briefcaseList: async () => [],
      briefcaseRead: async () => null as any,
      journalList: async () => [{ id: 'j2', title: 'Empty', updatedAt: 'x', bytes: 0 }],
      journalRead: async () => ({ id: 'j2', title: 'Empty', createdAt: 'x', updatedAt: 'x',
        blocks: [{ id: 'b', kind: 'text', html: '<p></p>' }] } as any)
    });
    expect(sources.find((s) => s.key === 'journal:j2')).toBeUndefined();
  });
});
