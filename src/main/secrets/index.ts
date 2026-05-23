/**
 * SecretStore backed by Electron's safeStorage (OS-level encryption: Keychain on macOS,
 * DPAPI on Windows, libsecret on Linux). One encrypted JSON blob on disk; never plaintext.
 */

import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretStore } from '../storage/interface';
import { secretsFile } from '../storage/paths';

type Blob = Record<string, string>;

async function readBlob(): Promise<Blob> {
  try {
    const buf = await readFile(secretsFile());
    if (!safeStorage.isEncryptionAvailable()) return {};
    const plain = safeStorage.decryptString(buf);
    return JSON.parse(plain) as Blob;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeBlob(blob: Blob): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this OS — refusing to write secrets in plaintext.');
  }
  const dir = dirname(secretsFile());
  await mkdir(dir, { recursive: true });
  const enc = safeStorage.encryptString(JSON.stringify(blob));
  const tmp = `${secretsFile()}.${process.pid}.tmp`;
  await writeFile(tmp, enc);
  await rename(tmp, secretsFile());
}

export const secretStore: SecretStore = {
  async get(key) {
    const blob = await readBlob();
    return blob[key] ?? null;
  },
  async set(key, value) {
    const blob = await readBlob();
    blob[key] = value;
    await writeBlob(blob);
  },
  async delete(key) {
    const blob = await readBlob();
    if (key in blob) {
      delete blob[key];
      await writeBlob(blob);
    }
  }
};
