/**
 * Regression guards for encrypt-at-rest red-team findings (2026-05-29 verification pass).
 * Each test originally REPRODUCED a bug; it now asserts the FIXED behaviour so the fix
 * can't silently regress.
 *
 *  A — disable race: a write between decryptAll() and removeAuth() must NOT re-encrypt under
 *      a DEK about to be destroyed (would orphan the file). Fixed by the vault `disabling`
 *      flag → secureWriteFile stops encrypting before decryptAll runs.
 *  B — migration tmp orphan: an abandoned *.tmp (crash debris) must not survive enable as a
 *      plaintext leak. Fixed by cleanupOrphanTemps() at the head of encryptAll().
 *  C — GCM IV is random per write (informational): confirms no fixed/reused nonce. The lack of
 *      a global counter is an accepted, documented limitation for single-user data volumes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-redteam-test' } }));

import * as vault from '../src/main/services/vault';
import { encryptAll, decryptAll } from '../src/main/storage/encryption-migrate';
import { secureWriteFile, secureReadFile } from '../src/main/storage/secure-fs';

const ROOT = '/tmp/ga98-redteam-test';
const DATA = join(ROOT, 'GhostAccess98');

afterEach(async () => {
  vault.lock();
  vault.endMigration();
  await rm(ROOT, { recursive: true, force: true });
  await vault.refreshEnabled(); // auth.json is gone now → resets enabledCache to false between tests
});

describe('RED TEAM repros (now regression guards)', () => {
  // FINDING A (FIXED): once the disable transition begins, no write re-encrypts, so removeAuth
  // never strands ciphertext under a destroyed DEK.
  it('disable: a write during the disable transition stays plaintext (no orphan)', async () => {
    await mkdir(join(DATA, 'cases', 'c1'), { recursive: true });
    await vault.setup('pw');
    const f = join(DATA, 'cases', 'c1', 'case.json');
    await secureWriteFile(f, JSON.stringify({ id: 'c1', title: 'T' }));
    expect(vault.isEncrypted(await readFile(f))).toBe(true);

    vault.beginDisable();          // the disable handler sets this BEFORE decryptAll
    await decryptAll();
    expect(vault.isEncrypted(await readFile(f))).toBe(false);

    // concurrent write while the DEK is still loaded but we are disabling → MUST be plaintext
    const sidecar = join(DATA, 'cases', 'c1', 'timeline.json');
    await secureWriteFile(sidecar, JSON.stringify([{ id: 'e1' }]));
    expect(vault.isEncrypted(await readFile(sidecar))).toBe(false);

    await vault.removeAuth();      // DEK zeroized, vault disabled
    // the sidecar is plaintext → readable forever, no data loss
    const readBack = await secureReadFile(sidecar);
    expect(JSON.parse(readBack.toString('utf8'))).toEqual([{ id: 'e1' }]);
  }, 30000);

  // FINDING B (FIXED): an orphaned *.tmp is removed by encryptAll, not left plaintext.
  it('migration tmp orphan is purged on enable (no plaintext leak)', async () => {
    await mkdir(join(DATA, 'cases', 'c1'), { recursive: true });
    const f = join(DATA, 'cases', 'c1', 'notes.txt');
    await writeFile(f, 'PLAINTEXT SECRET', 'utf8');
    const orphan = join(DATA, 'cases', 'c1', 'notes.txt.mig.999.deadbeef.tmp');
    await writeFile(orphan, 'PLAINTEXT SECRET', 'utf8');

    await vault.setup('pw');
    await encryptAll();
    expect(vault.isEncrypted(await readFile(f))).toBe(true);
    // the orphan must be gone (ENOENT), not lingering as cleartext
    await expect(readFile(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30000);

  // FINDING 3 (FIXED): enable carries a completion marker, cleared only when the sweep finishes,
  // so a crashed/partial enable can't masquerade as complete (it resumes on next unlock).
  it('enable completion marker is set on setup and cleared only when the sweep finishes', async () => {
    await mkdir(join(DATA, 'cases', 'c1'), { recursive: true });
    await writeFile(join(DATA, 'cases', 'c1', 'case.json'), JSON.stringify({ id: 'c1' }), 'utf8');
    await vault.setup('pw');
    expect(await vault.isEnableIncomplete()).toBe(true);   // marker set, tree not yet confirmed
    const r = await encryptAll();
    expect(r.failed).toEqual([]);
    await vault.markEnableComplete();
    expect(await vault.isEnableIncomplete()).toBe(false);   // cleared once fully encrypted
  }, 30000);

  // FINDING 4 (FIXED): secure-fs refuses to write plaintext into an enabled-but-locked tree, so a
  // stale gate / bug can't corrupt the encrypted corpus with cleartext.
  it('secureWriteFile refuses to write while enabled-but-locked', async () => {
    await vault.setup('pw');
    vault.lock(); // enabled (auth.json exists) but locked (DEK gone)
    await expect(
      secureWriteFile(join(DATA, 'cases', 'c1', 'x.json'), 'plaintext')
    ).rejects.toMatchObject({ code: 'EVAULTLOCKED' });
  }, 30000);

  // FINDING C (informational): GCM IV is a random 96-bit nonce per write under one DEK.
  it('GCM IV is random per write (no fixed/reused nonce)', async () => {
    await vault.setup('pw');
    const a = vault.encryptBuffer(Buffer.from('same'));
    const b = vault.encryptBuffer(Buffer.from('same'));
    const ivA = a.subarray(8, 20).toString('hex');
    const ivB = b.subarray(8, 20).toString('hex');
    expect(ivA).not.toBe(ivB);
  });
});
