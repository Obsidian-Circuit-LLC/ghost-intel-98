import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readdir } from 'node:fs/promises';
import { secureWriteFile, secureReadText } from '../src/main/storage/secure-fs';

// Vault is disabled in this unit context → secure-fs is plaintext passthrough; we're exercising the
// durable (fsync) write branch end-to-end, not encryption.
describe('secureWriteFile durable option', () => {
  it('round-trips a durable write and leaves no temp file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcs98-durable-'));
    const path = join(dir, 'consumed-prekeys.json');
    await secureWriteFile(path, JSON.stringify({ consumed: ['id1', 'id2'] }), { durable: true });
    expect(JSON.parse(await secureReadText(path))).toEqual({ consumed: ['id1', 'id2'] });
    // the temp+rename pattern must not leave a .tmp sidecar
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
    expect(entries).toContain('consumed-prekeys.json');
  });

  it('overwrites durably (consumption update)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcs98-durable-'));
    const path = join(dir, 'token.json');
    await secureWriteFile(path, JSON.stringify({ pending: true }), { durable: true });
    await secureWriteFile(path, JSON.stringify({ pending: false, consumedAt: 'x' }), { durable: true });
    expect(JSON.parse(await secureReadText(path))).toEqual({ pending: false, consumedAt: 'x' });
  });

  it('non-durable default still works (no opts)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcs98-durable-'));
    const path = join(dir, 'plain.txt');
    await secureWriteFile(path, 'hello');
    expect(await secureReadText(path)).toBe('hello');
  });
});
