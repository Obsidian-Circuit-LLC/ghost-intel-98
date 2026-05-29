/**
 * SecretStore backed by Electron's safeStorage (DPAPI on Windows, Keychain on macOS,
 * libsecret/KWallet on Linux — with a documented `basic_text` fallback that we WARN about).
 *
 * Safety properties added in v1.0.1:
 *  - Distinct error class for "encryption backend unavailable" vs "blob unreadable" vs ENOENT
 *  - Refuses to write when the prior read failed to decrypt — refuses to silently destroy
 *    secrets that may still be recoverable (e.g. by restoring the OS keyring)
 *  - Per-call temp suffix so concurrent writes don't clobber the same .tmp
 *  - Single async mutex around read-modify-write spans
 *  - getBackend() returns the OS backend label so the UI can warn on `basic_text`
 */

import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SecretStore } from '../storage/interface';
import { secretsFile } from '../storage/paths';
import { withLock } from '../util/mutex';
import * as vault from '../services/vault';

type Blob = Record<string, string>;

/** secrets.enc is normally keyring-bound (DPAPI/Keychain/libsecret). On Linux without a real
 *  keyring, safeStorage falls back to `basic_text` — trivially reversible obfuscation. In that
 *  case ONLY, and while the vault is enabled, we additionally wrap the blob with the vault DEK so
 *  enabling encryption actually protects stored credentials too (red-team #11). On a strong
 *  backend this is a no-op and the on-disk format is byte-identical to before. */
function weakKeyringBackend(): boolean {
  return getSecretBackend() === 'basic_text';
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super('OS keyring is unavailable. Cannot read or write encrypted secrets.');
    this.name = 'SecretsUnavailableError';
  }
}

export class SecretsCorruptedError extends Error {
  constructor(reason: string) {
    super(`secrets.enc could not be decrypted (${reason}). Refusing to overwrite — rename the file to secrets.enc.broken to start fresh.`);
    this.name = 'SecretsCorruptedError';
  }
}

let blobUnreadable: SecretsCorruptedError | null = null;

async function readBlob(): Promise<Blob> {
  let buf: Buffer;
  try {
    buf = await readFile(secretsFile());
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      blobUnreadable = null;
      return {};
    }
    throw err;
  }
  // Optional vault DEK layer (weak-keyring hardening). Magic-byte detected so plaintext-keyring
  // and DEK-wrapped blobs coexist across an enable/disable transition.
  if (vault.isEncrypted(buf)) {
    if (!vault.isUnlocked()) {
      blobUnreadable = new SecretsCorruptedError('vault locked — unlock to read secrets');
      throw blobUnreadable;
    }
    try {
      buf = vault.decryptBuffer(buf);
    } catch (err) {
      blobUnreadable = new SecretsCorruptedError(`vault decrypt failed (${(err as Error).message})`);
      throw blobUnreadable;
    }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    blobUnreadable = new SecretsCorruptedError('encryption backend not available');
    throw new SecretsUnavailableError();
  }
  try {
    const plain = safeStorage.decryptString(buf);
    const parsed = JSON.parse(plain) as Blob;
    blobUnreadable = null;
    return parsed;
  } catch (err) {
    blobUnreadable = new SecretsCorruptedError((err as Error).message);
    throw blobUnreadable;
  }
}

async function writeBlob(blob: Blob): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecretsUnavailableError();
  }
  if (blobUnreadable) {
    // Refuse to silently overwrite a blob that may still be recoverable.
    throw blobUnreadable;
  }
  const dir = dirname(secretsFile());
  await mkdir(dir, { recursive: true });
  let enc: Buffer = safeStorage.encryptString(JSON.stringify(blob));
  // On a weak keyring, add the vault DEK layer (defence in depth). shouldEncrypt() is false during
  // a disable sweep, so this naturally strips the DEK layer back off before the DEK is destroyed.
  if (weakKeyringBackend() && vault.shouldEncrypt()) enc = vault.encryptBuffer(enc);
  const tmp = `${secretsFile()}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, enc);
  await rename(tmp, secretsFile());
}

/** Re-apply the current DEK-layer policy to secrets.enc — called when the vault is enabled
 *  (adds the layer on a weak keyring) and when disabled (shouldEncrypt() is false → strips it
 *  while the DEK is still loaded). No-op if no secrets file exists or on a strong keyring. */
export async function rewrapSecretsForVault(): Promise<void> {
  if (!weakKeyringBackend()) return; // DEK layer only applies on a weak keyring — no-op otherwise
  return withLock('secrets', async () => {
    try {
      await readFile(secretsFile()); // existence probe — nothing to rewrap if absent
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    const blob = await readBlob(); // unwraps the DEK layer if present (vault must be unlocked)
    await writeBlob(blob);         // re-applies current policy (wrap iff weak + shouldEncrypt)
  });
}

export const secretStore: SecretStore = {
  async get(key) {
    return withLock('secrets', async () => {
      // Lets corruption errors propagate; unavailability bubbles too so callers can tell
      // "OS keyring locked" apart from "key genuinely not set".
      const blob = await readBlob();
      return blob[key] ?? null;
    });
  },
  async set(key, value) {
    return withLock('secrets', async () => {
      const blob = await readBlob(); // may throw SecretsUnavailableError / SecretsCorruptedError
      blob[key] = value;
      await writeBlob(blob);
    });
  },
  async delete(key) {
    return withLock('secrets', async () => {
      const blob = await readBlob();
      if (key in blob) {
        delete blob[key];
        await writeBlob(blob);
      }
    });
  }
};

/** Returns the OS safeStorage backend label (or 'unavailable') for UI warnings. */
export function getSecretBackend(): string {
  if (!safeStorage.isEncryptionAvailable()) return 'unavailable';
  // Linux-only API in Electron ≥15; on Win/macOS returns the default backend name.
  if (process.platform === 'linux') {
    try {
      const fn = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend;
      return fn ? fn() : 'unknown';
    } catch {
      return 'unknown';
    }
  }
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  return 'unknown';
}
