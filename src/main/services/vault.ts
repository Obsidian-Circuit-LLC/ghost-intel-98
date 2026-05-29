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
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { dataRoot } from '../storage/paths';
import { withLock } from '../util/mutex';

// All auth.json mutations (setup/changePassword/removeAuth/markEnableComplete) and unlock serialize
// on this key so a concurrent disable can't resurrect a deleted file and changePassword can't race.
const AUTH_LOCK = 'vault-auth';

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
  /** True while an enable encrypt-pass is in flight or did not finish. Cleared only when the
   *  whole tree is confirmed encrypted. A set marker on boot means "resume the encrypt pass on
   *  next unlock" — so a crashed/partial enable can't masquerade as complete (red-team #3).
   *  Absent on vaults created before this field → treated as complete (back-compat). */
  migrating?: boolean;
}

let dek: Buffer | null = null;
// In-memory mirror of "auth.json exists", so the per-IPC lock gate is a cheap sync check
// instead of a stat() on every call. Kept truthful by setup/removeAuth + a boot refresh.
let enabledCache = false;
// Migration transition state. `migrating` is true during an enable OR disable sweep (the
// reminder ticker skips so it can't write concurrently). `disabling` is true ONLY during a
// disable sweep: the DEK is still loaded so decryptAll can read ciphertext, but new writes
// MUST NOT encrypt — otherwise a write racing decryptAll()→removeAuth() would orphan a file
// under a DEK we are about to destroy (red-team finding A).
let migrating = false;
let disabling = false;

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

/** True iff a fresh write should be encrypted: the DEK is loaded AND we're not tearing the
 *  vault down. secure-fs consults this synchronously, so no concurrent write can slip between
 *  the check and the encrypt. */
export function shouldEncrypt(): boolean { return dek !== null && !disabling; }
/** True while an enable/disable sweep is running — the reminder ticker skips on this. */
export function isMigrating(): boolean { return migrating; }
/** Mark the start of an enable sweep (writes still encrypt; ticker pauses). */
export function beginEnable(): void { migrating = true; }
/** Mark the start of a disable sweep (writes STOP encrypting; ticker pauses). */
export function beginDisable(): void { migrating = true; disabling = true; }
/** Clear all transition state. Idempotent; safe to call in a finally. */
export function endMigration(): void { migrating = false; disabling = false; }

/** Refresh + return the cached enabled flag. Call once at boot; setup/removeAuth keep it current.
 *  Never downgrades to false while a DEK is loaded: an unlocked vault is enabled by definition,
 *  so a renderer-reachable auth:status refresh can't desync the gate into "disabled" (#4). */
export async function refreshEnabled(): Promise<boolean> { enabledCache = (await isEnabled()) || dek !== null; return enabledCache; }
/** Cheap synchronous read of the enabled flag, for the per-IPC lock gate. */
export function isEnabledCached(): boolean { return enabledCache; }

/** True iff a prior enable did not finish encrypting (the migrating marker is still set). */
export async function isEnableIncomplete(): Promise<boolean> {
  try { return (await readAuth()).migrating === true; } catch { return false; }
}
/** Clear the enable-incomplete marker once the whole tree is confirmed encrypted. */
export async function markEnableComplete(): Promise<void> {
  return withLock(AUTH_LOCK, async () => {
    const a = await readAuth();
    if (a.migrating) { delete a.migrating; await writeAuth(a); }
  });
}

/** First-time setup: returns the one-time recovery key (shown once). Leaves the vault unlocked. */
export async function setup(password: string): Promise<{ recoveryKey: string }> {
  return withLock(AUTH_LOCK, async () => {
    if (await isEnabled()) throw new Error('Login is already enabled.');
    if (!password) throw new Error('Password required.');
    const newDek = randomBytes(32);
    const salt = randomBytes(16);
    const recoverySalt = randomBytes(16);
    const recoveryKey = makeRecoveryKey();
    const pwKek = deriveKey(password, salt);
    const rcKek = deriveKey(normalizeRecovery(recoveryKey), recoverySalt);
    const auth: AuthFile = {
      version: 1,
      kdf: { N: KDF.N, r: KDF.r, p: KDF.p },
      salt: salt.toString('base64'),
      wrappedDEK: wrap(pwKek, newDek),
      recoverySalt: recoverySalt.toString('base64'),
      recoveryWrappedDEK: wrap(rcKek, newDek),
      migrating: true // cleared by markEnableComplete() once encryptAll finishes the whole tree
    };
    pwKek.fill(0); rcKek.fill(0); // zeroize derived KEKs — they were only needed to wrap the DEK
    await writeAuth(auth);
    dek = newDek;
    enabledCache = true;
    return { recoveryKey };
  });
}

export async function unlock(password: string): Promise<void> {
  const a = await readAuth();
  const kek = deriveKey(password, Buffer.from(a.salt, 'base64'), a.kdf);
  // dek is assigned only if unwrap succeeds (throw happens inside), so a wrong password never
  // clobbers an existing unlocked DEK. Zeroize the KEK either way.
  try { dek = unwrap(kek, a.wrappedDEK); } catch { throw new Error('Incorrect password.'); } finally { kek.fill(0); }
}

export async function unlockWithRecovery(recoveryKey: string): Promise<void> {
  const a = await readAuth();
  const rkek = deriveKey(normalizeRecovery(recoveryKey), Buffer.from(a.recoverySalt, 'base64'), a.kdf);
  try { dek = unwrap(rkek, a.recoveryWrappedDEK); } catch { throw new Error('Incorrect recovery key.'); } finally { rkek.fill(0); }
}

/** Re-wrap the DEK under a new password (vault must be unlocked). Data is untouched. */
export async function changePassword(newPassword: string): Promise<void> {
  return withLock(AUTH_LOCK, async () => {
    if (!dek) throw new Error('Unlock first.');
    if (!(await isEnabled())) throw new Error('Login was disabled — nothing to change.'); // lost the race with disable
    if (!newPassword) throw new Error('Password required.');
    const a = await readAuth();
    const salt = randomBytes(16);
    const kek = deriveKey(newPassword, salt);
    a.salt = salt.toString('base64');
    a.wrappedDEK = wrap(kek, dek);
    kek.fill(0);
    await writeAuth(a);
  });
}

export function lock(): void { if (dek) { dek.fill(0); dek = null; } }

/** Disable login: delete auth.json and lock. The caller MUST decrypt all data first (the DEK
 *  is still needed for that and is zeroized here). After this, isEnabled() is false. */
export async function removeAuth(): Promise<void> {
  return withLock(AUTH_LOCK, async () => {
    await rm(authPath(), { force: true }); // throws only on a real IO failure, not ENOENT
    enabledCache = false;
    lock();
    endMigration();
  });
}

export function encryptBuffer(plain: Buffer): Buffer {
  // Random 96-bit GCM nonce per call under a single long-lived DEK. Safe only while the total
  // write count stays well under the ~2^32 birthday bound for random 96-bit nonces. For a
  // single-user offline case tool this is never approached; if data volume ever grows toward
  // that scale, switch to a persisted per-DEK counter or XChaCha20-Poly1305 (192-bit nonce).
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

/** Magic-prefix-only check for the cheap header probe (isEncryptedFile reads just the first
 *  MAGIC bytes, which can't satisfy isEncrypted's full-envelope length test). encryptBuffer
 *  always emits a >= (MAGIC+IV+TAG) blob, so a magic match on the head is a sound encrypted
 *  signal; a false positive would fail decryption loudly rather than be served as plaintext. */
export function hasMagicPrefix(head: Buffer): boolean {
  return head.length >= MAGIC.length && head.subarray(0, MAGIC.length).equals(MAGIC);
}
