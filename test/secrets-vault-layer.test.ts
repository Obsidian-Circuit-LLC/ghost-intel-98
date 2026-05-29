/**
 * Red-team #11 guard: on a weak keyring (safeStorage `basic_text` fallback), enabling the vault
 * must additionally protect secrets.enc with the DEK. On a strong keyring this layer is absent.
 * Here we simulate basic_text and assert the DEK layer is applied on enable, stripped on disable,
 * and that a locked vault surfaces an error rather than silently reading empty.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, rm } from 'node:fs/promises';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ga98-secrets-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // basic_text-style reversible obfuscation (NOT real crypto) — the point is it's weak, which
    // is exactly why the vault DEK layer matters on top of it.
    encryptString: (s: string) => Buffer.from(`BT:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^BT:/, ''),
    getSelectedStorageBackend: () => 'basic_text'
  }
}));

import * as vault from '../src/main/services/vault';
import { secretStore, rewrapSecretsForVault, getSecretBackend } from '../src/main/secrets';
import { secretsFile } from '../src/main/storage/paths';

afterEach(async () => {
  vault.lock();
  vault.endMigration();
  await rm('/tmp/ga98-secrets-test', { recursive: true, force: true });
  await vault.refreshEnabled();
});

describe('secrets.enc vault DEK layer (weak keyring)', () => {
  it('the test harness simulates a basic_text backend', () => {
    expect(getSecretBackend()).toBe('basic_text');
  });

  it('enable + weak keyring: secrets.enc is DEK-wrapped and round-trips', async () => {
    await vault.setup('a-long-passphrase');
    await secretStore.set('mail:pw', 's3cret-value');
    const raw = await readFile(secretsFile());
    expect(vault.isEncrypted(raw)).toBe(true);                 // DEK layer present
    expect(raw.includes(Buffer.from('s3cret-value'))).toBe(false); // not even the weak blob is exposed
    expect(await secretStore.get('mail:pw')).toBe('s3cret-value'); // unwraps DEK then safeStorage
  }, 30000);

  it('disable strips the DEK layer while the DEK is still loaded', async () => {
    await vault.setup('a-long-passphrase');
    await secretStore.set('mail:pw', 's3cret-value');
    vault.beginDisable();             // shouldEncrypt() → false
    await rewrapSecretsForVault();     // strips the DEK layer
    expect(vault.isEncrypted(await readFile(secretsFile()))).toBe(false);
    await vault.removeAuth();          // DEK gone
    expect(await secretStore.get('mail:pw')).toBe('s3cret-value'); // still readable (safeStorage only)
  }, 30000);

  it('locked vault: reading a DEK-wrapped secrets.enc throws rather than reading empty', async () => {
    await vault.setup('a-long-passphrase');
    await secretStore.set('mail:pw', 's3cret-value');
    vault.lock();
    await expect(secretStore.get('mail:pw')).rejects.toThrow();
  }, 30000);
});
