import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/journal-assets.test.ts / test/journal.test.ts). A dedicated dir keeps this corpus isolated.
const DIR = '/tmp/ga98-journal-blocks-test';
vi.mock('electron', () => ({ app: { getPath: () => DIR } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import * as journal from '../src/main/storage/journal';
import { ensureJournalEntry } from '../src/main/security/validate';

const journalFile = (): string => join(DIR, 'GhostAccess98', 'journal.json');

beforeEach(async () => {
  await journal._resetForTest();
});

describe('journal blocks migration', () => {
  it('reads a legacy plain-text body as ONE escaped text block', async () => {
    // Seed a legacy record (body string, no blocks) directly into journal.json — the on-disk shape
    // every entry had before the block-editor model shipped. No vault key configured in this test
    // harness, so secure-fs writes plaintext and a plain fs write round-trips through the same seam.
    const legacy = {
      id: 'legacy-id',
      title: 'Legacy',
      body: 'a <b>x</b> & y',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    await mkdir(join(DIR, 'GhostAccess98'), { recursive: true });
    await writeFile(journalFile(), JSON.stringify([legacy]), 'utf8');

    const e = await journal.read('legacy-id');
    expect(e!.blocks).toHaveLength(1);
    expect(e!.blocks[0].kind).toBe('text');
    // escaped, NOT interpreted as HTML:
    expect((e!.blocks[0] as any).html).toContain('&lt;b&gt;');
    expect((e!.blocks[0] as any).html).not.toContain('<b>');
  });

  it('round-trips a blocks entry', async () => {
    const saved = await journal.save({
      id: 'n1', title: 'T', blocks: [
        { id: 'b1', kind: 'text', html: '<b>hi</b>' },
        { id: 'b2', kind: 'image', assetRef: 'uuid.png', widthPct: 60, caption: '' }
      ]
    } as any);
    expect(saved.blocks).toHaveLength(2);
    const read = await journal.read('n1');
    expect(read!.blocks).toHaveLength(2);
  });

  it('ensureJournalEntry rejects a path-traversal image ref', () => {
    expect(() => ensureJournalEntry({
      id: 'x', title: 'T', blocks: [
        { id: 'b', kind: 'image', assetRef: '../../secret', widthPct: 60, caption: '' }]
    })).toThrow();
  });

  it('ensureJournalEntry rejects an unknown block kind and over-large blocks JSON', () => {
    expect(() => ensureJournalEntry({ id: 'x', title: 'T', blocks: [{ id: 'b', kind: 'script' } as any] })).toThrow();
    const hugeHtml = 'x'.repeat(3 * 1024 * 1024); // 3 MB single block — over the 2 MB total bound
    expect(() => ensureJournalEntry({ id: 'x', title: 'T', blocks: [{ id: 'b', kind: 'text', html: hugeHtml }] })).toThrow();
  });
});
