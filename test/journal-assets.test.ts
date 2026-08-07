import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/reports-store.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-journal-assets-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { putAsset, getAsset } from '../src/main/storage/journal-assets';
import { ensureJournalAssetInput } from '../src/main/security/validate';

describe('journal asset store', () => {
  it('round-trips png bytes encrypted, ref is uuid.png', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const ref = await putAsset(bytes, 'image/png');
    expect(ref).toMatch(/^[0-9a-f-]{36}\.png$/);
    const got = await getAsset(ref);
    expect(got?.mime).toBe('image/png');
    expect(Buffer.compare(got!.bytes, bytes)).toBe(0);
  });
  it('getAsset rejects a path-traversal ref', async () => {
    await expect(getAsset('../journal.json')).resolves.toBeNull(); // ensureFileName throws → caught → null
  });
  it('ensureJournalAssetInput enforces png/jpeg + 25MB', () => {
    expect(() => ensureJournalAssetInput({ bytes: [1], mime: 'image/gif' })).toThrow();
    expect(() => ensureJournalAssetInput({ bytes: new Array(26 * 1024 * 1024).fill(0), mime: 'image/png' })).toThrow();
    expect(ensureJournalAssetInput({ bytes: [1, 2], mime: 'image/jpeg' }).mime).toBe('image/jpeg');
  });
});
