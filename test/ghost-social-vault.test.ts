/**
 * Ghost Social Media Manager — password vault (Phase 1, G1 + hardening #2).
 *
 * His AES-256-GCM + scrypt crypto is ported verbatim; the ONE hardening change is the
 * recovery-key export (a user-chosen save dialog, NEVER an auto-write to Desktop). These tests
 * pin:
 *   - setup → unlock(password) → lock → unlock(recovery) round-trip (the same key returns);
 *   - a wrong password / wrong recovery key returns false (never throws, never unlocks);
 *   - the ≥6-char password guard is enforced MAIN-side;
 *   - exportRecoveryKey routes through the injected save DIALOG and writes ONLY to the chosen
 *     path — a cancelled dialog writes nothing, and no Desktop path is ever touched.
 *
 * Fully in-memory: no electron, no fs — the vault's IO is injected.
 */
import { describe, it, expect, vi } from 'vitest';
import { GhostSocialVault, isValidRecoveryKeyFormat, type VaultIo } from '../src/main/ghost-social/vault';

const PATHS = { meta: '/mem/vault-meta.json', wrappedKey: '/mem/recovery-wrapped-key.enc' };

/** In-memory IO backed by a Map. `read` rejects for an absent path (like fs ENOENT). */
function memIo(): { io: VaultIo; files: Map<string, string> } {
  const files = new Map<string, string>();
  const io: VaultIo = {
    read: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(p) as string;
    },
    write: async (p, data) => {
      files.set(p, data);
    },
    exists: async (p) => files.has(p),
  };
  return { io, files };
}

describe('GhostSocialVault — setup / unlock / lock (his crypto, verbatim)', () => {
  it('setup returns a GSMM- recovery key, persists meta + wrapped key, and unlocks', async () => {
    const { io, files } = memIo();
    const vault = new GhostSocialVault(io, PATHS);

    expect(await vault.isConfigured()).toBe(false);
    const { recoveryKey } = await vault.setup('correct horse');
    expect(isValidRecoveryKeyFormat(recoveryKey)).toBe(true);
    expect(recoveryKey.startsWith('GSMM-')).toBe(true);
    expect(await vault.isConfigured()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
    expect(files.has(PATHS.meta)).toBe(true);
    expect(files.has(PATHS.wrappedKey)).toBe(true);
  });

  it('round-trips: setup → lock → unlock(password) → lock → unlock(recovery) yields the same key', async () => {
    const { io } = memIo();
    const vault = new GhostSocialVault(io, PATHS);
    const { recoveryKey } = await vault.setup('sup3r-secret');
    const keyAfterSetup = vault.getKey();
    expect(keyAfterSetup).not.toBeNull();

    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.getKey()).toBeNull();

    expect(await vault.unlock('sup3r-secret')).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
    expect(vault.getKey()!.equals(keyAfterSetup!)).toBe(true);

    vault.lock();
    expect(await vault.unlock(recoveryKey)).toBe(true);
    // Recovery unlock unwraps the SAME vault key as the password path.
    expect(vault.getKey()!.equals(keyAfterSetup!)).toBe(true);
  });

  it('rejects a wrong password and a wrong recovery key without unlocking', async () => {
    const { io } = memIo();
    const vault = new GhostSocialVault(io, PATHS);
    await vault.setup('the-real-password');
    vault.lock();

    expect(await vault.unlock('WRONG-password')).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
    expect(await vault.unlock('GSMM-DEAD-BEEF-DEAD-BEEF-DEAD-BEEF-DEAD-BEEF-DEAD-BEEF-DEAD-BEEF')).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('enforces the >=6 character password minimum MAIN-side', async () => {
    const { io } = memIo();
    const vault = new GhostSocialVault(io, PATHS);
    await expect(vault.setup('short')).rejects.toThrow(/at least 6/i);
    expect(await vault.isConfigured()).toBe(false);
  });
});

describe('GhostSocialVault — hardened recovery-key export (constraint #2)', () => {
  it('writes the key ONLY to the user-chosen save-dialog path, never to Desktop', async () => {
    const { io } = memIo();
    const vault = new GhostSocialVault(io, PATHS);
    const { recoveryKey } = await vault.setup('another-secret');

    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/home/op/keys/rk.txt' }));
    const writeFile = vi.fn(async () => {});
    const res = await vault.exportRecoveryKey(recoveryKey, { showSaveDialog, writeFile });

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ saved: true, filePath: '/home/op/keys/rk.txt' });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, contents] = writeFile.mock.calls[0];
    expect(writtenPath).toBe('/home/op/keys/rk.txt');
    expect(writtenPath.toLowerCase()).not.toContain('desktop');
    expect(contents).toContain(recoveryKey);
    expect(contents).toMatch(/keep this file private/i);
  });

  it('writes NOTHING when the save dialog is cancelled', async () => {
    const { io } = memIo();
    const vault = new GhostSocialVault(io, PATHS);
    const { recoveryKey } = await vault.setup('yet-another');

    const showSaveDialog = vi.fn(async () => ({ canceled: true }));
    const writeFile = vi.fn(async () => {});
    const res = await vault.exportRecoveryKey(recoveryKey, { showSaveDialog, writeFile });

    expect(res).toEqual({ saved: false });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('refuses to export a malformed recovery key', async () => {
    const { io } = memIo();
    const vault = new GhostSocialVault(io, PATHS);
    await vault.setup('secretpw');
    const writeFile = vi.fn(async () => {});
    await expect(
      vault.exportRecoveryKey('not-a-real-key', { showSaveDialog: vi.fn(), writeFile }),
    ).rejects.toThrow(/malformed/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
