import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-backup-test' } }));

import { createBackup, restoreBackup } from '../src/main/services/backup';
import { dataRoot } from '../src/main/storage/paths';
import { ensureWithin } from '../src/main/security/validate';

const ROOT = '/tmp/ga98-backup-test';

afterAll(async () => { await rm(ROOT, { recursive: true, force: true }); });

describe('backup create / restore', () => {
  it('round-trips files through a .ga98 zip', async () => {
    const dr = dataRoot();
    await mkdir(join(dr, 'cases', 'abc'), { recursive: true });
    await writeFile(join(dr, 'settings.json'), '{"soundEnabled":true}');
    await writeFile(join(dr, 'cases', 'abc', 'case.json'), '{"id":"abc","title":"Test"}');

    const bk = join(ROOT, 'backup.ga98');
    await createBackup(bk);
    await rm(dr, { recursive: true, force: true });

    const r = await restoreBackup(bk);
    expect(r.files).toBeGreaterThanOrEqual(2);
    expect(await readFile(join(dr, 'settings.json'), 'utf8')).toContain('soundEnabled');
    expect(await readFile(join(dr, 'cases', 'abc', 'case.json'), 'utf8')).toContain('Test');
  });
});

describe('Zip-Slip guard (ensureWithin — used by restore/import)', () => {
  const root = '/tmp/ga98-backup-test/GhostAccess98';
  it('accepts paths inside the root', () => {
    expect(ensureWithin(root, join(root, 'cases/abc/case.json'))).toContain('case.json');
  });
  it('rejects entries that escape the root', () => {
    expect(() => ensureWithin(root, join(root, '../evil.txt'))).toThrow();
    expect(() => ensureWithin(root, join(root, '../../etc/passwd'))).toThrow();
    expect(() => ensureWithin(root, '/etc/passwd')).toThrow();
  });
});
