import { describe, it, expect, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-vault-test' } }));

import * as vault from '../src/main/services/vault';

afterEach(async () => { vault.lock(); await rm('/tmp/ga98-vault-test', { recursive: true, force: true }); });

describe('vault (encrypt-at-rest crypto core)', () => {
  it('setup → round-trip → wrong password rejected → recovery key works', async () => {
    expect(await vault.isEnabled()).toBe(false);

    const { recoveryKey } = await vault.setup('correct horse battery');
    expect(recoveryKey).toMatch(/^[A-Z0-9-]+$/);
    expect(await vault.isEnabled()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);

    const plain = Buffer.from('secret case notes');
    const enc = vault.encryptBuffer(plain);
    expect(vault.isEncrypted(enc)).toBe(true);
    expect(enc.includes(plain)).toBe(false); // ciphertext must not contain plaintext
    expect(vault.decryptBuffer(enc).toString()).toBe('secret case notes');

    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    await expect(vault.unlock('WRONG')).rejects.toThrow();
    expect(vault.isUnlocked()).toBe(false);

    await vault.unlock('correct horse battery');
    expect(vault.isUnlocked()).toBe(true);
    expect(vault.decryptBuffer(enc).toString()).toBe('secret case notes'); // same DEK after re-unlock

    vault.lock();
    await vault.unlockWithRecovery(recoveryKey);
    expect(vault.decryptBuffer(enc).toString()).toBe('secret case notes');
  }, 30000);

  it('change password keeps the same data decryptable; old password stops working', async () => {
    await vault.setup('old-pass');
    const enc = vault.encryptBuffer(Buffer.from('data'));
    await vault.changePassword('new-pass');
    vault.lock();
    await expect(vault.unlock('old-pass')).rejects.toThrow();
    await vault.unlock('new-pass');
    expect(vault.decryptBuffer(enc).toString()).toBe('data');
  }, 30000);
});
