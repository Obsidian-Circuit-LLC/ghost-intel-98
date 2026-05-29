/**
 * At-rest encryption vault (operator-approved design, 2026-05-29).
 *
 * Envelope encryption: a random 256-bit Data Encryption Key (DEK) encrypts all case data with
 * AES-256-GCM (per-blob random 96-bit nonce + 128-bit tag). The DEK is wrapped by a
 * Key-Encryption-Key derived from the master password via scrypt (N=2^17, r=8, p=1), and a
 * second wrapping by a one-time recovery key. auth.json holds {salt, kdf, wrappedDEK,
 * recoverySalt, recoveryWrappedDEK} — safe in the clear (a wrong password fails the GCM tag,
 * which IS the verifier). Password change re-wraps the DEK; no data is re-encrypted.
 *
 * The DEK lives in memory only while unlocked. encryptBuffer/decryptBuffer are used by the
 * storage IO layer; blobs are prefixed with a magic header so plaintext vs ciphertext is
 * detectable (safe migration + mixed states).
 */
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { dataRoot } from '../storage/paths';

const KDF = { N: 1 << 17, r: 8, p: 1, keylen: 32, maxmem: 160 * 1024 * 1024 } as const;
const MAGIC = Buffer.from('GA98ENC1');
const IV_LEN = 12;
const TAG_LEN = 16;

interface Wrapped { iv: string; tag: string; ct: string }
interface AuthFile {
  version: 1;
  kdf: { N: number; r: number; p: number };
  salt: string;
  wrappedDEK: Wrapped;
  recoverySalt: string;
  recoveryWrappedDEK: Wrapped;
}

let dek: Buffer | null = null;

function authPath(): string { return join(dataRoot(), 'auth.json'); }

function deriveKey(secret: string, salt: Buffer, kdf: { N: number; r: number; p: number } = KDF): Buffer {
  return scryptSync(Buffer.from(secret, 'utf8'), salt, KDF.keylen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: KDF.maxmem });
}

function wrap(kek: Buffer, data: Buffer): Wrapped {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function unwrap(kek: Buffer, w: Wrapped): Buffer {
  const d = createDecipheriv('aes-256-gcm', kek, Buffer.from(w.iv, 'base64'));
  d.setAuthTag(Buffer.from(w.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(w.ct, 'base64')), d.final()]); // throws on wrong key (bad tag)
}

/** Human-transcribable recovery key: 20 random bytes → 5-char groups. */
function makeRecoveryKey(): string {
  const s = randomBytes(20).toString('base64').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 25);
  return (s.match(/.{1,5}/g) ?? [s]).join('-');
}
function normalizeRecovery(k: string): string { return k.replace(/[^a-z0-9]/gi, '').toUpperCase(); }

async function readAuth(): Promise<AuthFile> {
  return JSON.parse(await readFile(authPath(), 'utf8')) as AuthFile;
}
async function writeAuth(a: AuthFile): Promise<void> {
  const p = authPath();
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(a, null, 2), 'utf8');
  await rename(tmp, p);
}

export async function isEnabled(): Promise<boolean> {
  try { await readFile(authPath()); return true; } catch { return false; }
}
export function isUnlocked(): boolean { return dek !== null; }

/** First-time setup: returns the one-time recovery key (shown once). Leaves the vault unlocked. */
export async function setup(password: string): Promise<{ recoveryKey: string }> {
  if (await isEnabled()) throw new Error('Login is already enabled.');
  if (!password) throw new Error('Password required.');
  const newDek = randomBytes(32);
  const salt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const recoveryKey = makeRecoveryKey();
  const auth: AuthFile = {
    version: 1,
    kdf: { N: KDF.N, r: KDF.r, p: KDF.p },
    salt: salt.toString('base64'),
    wrappedDEK: wrap(deriveKey(password, salt), newDek),
    recoverySalt: recoverySalt.toString('base64'),
    recoveryWrappedDEK: wrap(deriveKey(normalizeRecovery(recoveryKey), recoverySalt), newDek)
  };
  await writeAuth(auth);
  dek = newDek;
  return { recoveryKey };
}

export async function unlock(password: string): Promise<void> {
  const a = await readAuth();
  const kek = deriveKey(password, Buffer.from(a.salt, 'base64'), a.kdf);
  try { dek = unwrap(kek, a.wrappedDEK); } catch { throw new Error('Incorrect password.'); }
}

export async function unlockWithRecovery(recoveryKey: string): Promise<void> {
  const a = await readAuth();
  const rkek = deriveKey(normalizeRecovery(recoveryKey), Buffer.from(a.recoverySalt, 'base64'), a.kdf);
  try { dek = unwrap(rkek, a.recoveryWrappedDEK); } catch { throw new Error('Incorrect recovery key.'); }
}

/** Re-wrap the DEK under a new password (vault must be unlocked). Data is untouched. */
export async function changePassword(newPassword: string): Promise<void> {
  if (!dek) throw new Error('Unlock first.');
  if (!newPassword) throw new Error('Password required.');
  const a = await readAuth();
  const salt = randomBytes(16);
  a.salt = salt.toString('base64');
  a.wrappedDEK = wrap(deriveKey(newPassword, salt), dek);
  await writeAuth(a);
}

export function lock(): void { if (dek) { dek.fill(0); dek = null; } }

export function encryptBuffer(plain: Buffer): Buffer {
  if (!dek) throw new Error('Vault is locked.');
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

export function decryptBuffer(data: Buffer): Buffer {
  if (!dek) throw new Error('Vault is locked.');
  const iv = data.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = data.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN);
  const ct = data.subarray(MAGIC.length + IV_LEN + TAG_LEN);
  const d = createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export function isEncrypted(data: Buffer): boolean {
  return data.length >= MAGIC.length + IV_LEN + TAG_LEN && data.subarray(0, MAGIC.length).equals(MAGIC);
}
