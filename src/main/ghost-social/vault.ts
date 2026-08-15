/**
 * Ghost Social Media Manager (hardened GI98 port) — password vault.
 *
 * His AES-256-GCM + scrypt vault crypto is ported VERBATIM (Global Constraint #1): the
 * scrypt parameters (N=16384, r=8, p=1, 32-byte key), the aes-256-gcm envelope, the
 * recovery-wrapped-key scheme, and the `GSMM-…` recovery-key format are byte-for-byte his.
 * DO NOT weaken any of it.
 *
 * The ONE hardening change is the recovery-key EXPORT (Global Constraint #2): his
 * `vault:saveRecoveryKey` auto-writes the key in PLAINTEXT to `~/Desktop`. That is replaced
 * by a user-initiated save dialog to a user-CHOSEN path, with an explicit warning in the file
 * body — the key is NEVER silently dropped into a discoverable location. (Displaying it
 * on-screen for the user to copy is the renderer's job; this module only writes where the
 * user pointed the dialog.)
 *
 * Every electron/fs dependency is injected, so the whole vault round-trips in a unit test with
 * an in-memory IO and no electron runtime.
 */

import crypto from 'node:crypto';
import type { VaultMeta } from '@shared/ghost-social/types';

/** The recovery-key prefix (his `GSMM-`). A value beginning with this is treated as a recovery
 *  key on unlock; anything else is treated as the password. */
export const RECOVERY_KEY_PREFIX = 'GSMM-';

/** His minimum password length (`vault:setup` guard). */
export const MIN_PASSWORD_LENGTH = 6;

// ── his crypto, verbatim ─────────────────────────────────────────────────────

/** scrypt password/recovery-key → 32-byte key. His exact parameters (N=16384, r=8, p=1). */
function derive(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** aes-256-gcm encrypt → `{iv,tag,ct}` base64 JSON string (his envelope). */
function encrypt(data: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  });
}

/** aes-256-gcm decrypt of his `{iv,tag,ct}` envelope. Throws on a wrong key (GCM tag mismatch). */
function decrypt(payload: string, key: Buffer): string {
  const p = JSON.parse(payload) as { iv: string; tag: string; ct: string };
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(p.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(p.ct, 'base64')), decipher.final()]).toString('utf8');
}

/** Generate a fresh `GSMM-XXXX-…` recovery key (his format: 24 random bytes, hex, grouped by 4). */
function generateRecoveryKey(): string {
  const raw = crypto.randomBytes(24).toString('hex').toUpperCase();
  return `${RECOVERY_KEY_PREFIX}${raw.match(/.{1,4}/g)!.join('-')}`;
}

/** Whether a submitted value is (shaped like) a recovery key rather than a password. */
export function isRecoveryKeyValue(value: string): boolean {
  return typeof value === 'string' && value.startsWith(RECOVERY_KEY_PREFIX);
}

/** Defensive format check before an export writes a key to disk — his keys are `GSMM-` + hex
 *  groups separated by dashes, bounded length. Rejects anything else (never write junk). */
export function isValidRecoveryKeyFormat(value: string): boolean {
  return typeof value === 'string' && /^GSMM-[0-9A-F]{4}(?:-[0-9A-F]{4}){1,15}$/.test(value);
}

// ── injectable IO ────────────────────────────────────────────────────────────

/** File IO the vault needs. Production wires this to secure-fs (encrypt-at-rest under the GI98
 *  app vault); tests wire it to an in-memory map. `read` rejects when the path is absent. */
export interface VaultIo {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** The two on-disk vault artifacts (meta + recovery-wrapped key). */
export interface VaultFilePaths {
  meta: string;
  wrappedKey: string;
}

/** Result of a native save dialog (mirrors electron's `dialog.showSaveDialog` shape). */
export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

/** IO for the hardened recovery-key export: a save dialog + a guarded write. The vault supplies
 *  the file body; the caller supplies where (and refuses symlinks / never defaults to Desktop). */
export interface RecoveryExportIo {
  showSaveDialog(defaultName: string): Promise<SaveDialogResult>;
  writeFile(filePath: string, contents: string): Promise<void>;
  assertNotSymlink?(filePath: string): Promise<void>;
}

export interface RecoveryExportResult {
  saved: boolean;
  filePath?: string;
}

/** The exact warning text written into an exported recovery-key file. */
export function recoveryKeyFileBody(key: string): string {
  return (
    'GHOST SOCIAL MEDIA MANAGER — RECOVERY KEY\n\n' +
    `${key}\n\n` +
    'Keep this file PRIVATE. Anyone who obtains this key can unlock your Ghost Social vault\n' +
    'and reach every authenticated account inside it. Store it offline, not on your desktop\n' +
    'or in cloud sync. Ghost never writes this file automatically — you chose to save it here.\n'
  );
}

// ── the vault ────────────────────────────────────────────────────────────────

/**
 * A password/recovery vault. Holds the derived key in memory only while unlocked. `setup`,
 * `unlock`, `lock` reproduce his behaviour exactly; `exportRecoveryKey` is the hardened,
 * dialog-gated replacement for his Desktop auto-write.
 */
export class GhostSocialVault {
  private unlocked = false;
  private vaultKey: Buffer | null = null;

  constructor(private readonly io: VaultIo, private readonly paths: VaultFilePaths) {}

  isUnlocked(): boolean {
    return this.unlocked && this.vaultKey !== null;
  }

  /** The in-memory vault key while unlocked (for the state store's own encryption layer, later
   *  phases) — a defensive copy so callers can't zero the live key. */
  getKey(): Buffer | null {
    return this.vaultKey ? Buffer.from(this.vaultKey) : null;
  }

  async isConfigured(): Promise<boolean> {
    return this.io.exists(this.paths.meta);
  }

  /**
   * First-run setup: derive the key from the password, mint a recovery key, persist the meta
   * (salt + both verifiers + marker) and the recovery-wrapped key, and unlock. Returns the
   * recovery key ONCE for the renderer to display/export (his `vault:setup` contract). His
   * ≥6-char guard is enforced here (main-side, not just UI).
   */
  async setup(password: string): Promise<{ recoveryKey: string }> {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const salt = crypto.randomBytes(16);
    const key = derive(password, salt);
    const rk = generateRecoveryKey();
    const rSalt = crypto.randomBytes(16);
    const rKey = derive(rk, rSalt);
    const marker = crypto.randomBytes(32).toString('base64');
    const meta: VaultMeta = {
      salt: salt.toString('base64'),
      verifier: encrypt(marker, key),
      recoverySalt: rSalt.toString('base64'),
      recoveryVerifier: encrypt(marker, rKey),
      marker,
    };
    await this.io.write(this.paths.meta, JSON.stringify(meta, null, 2));
    await this.io.write(this.paths.wrappedKey, encrypt(key.toString('base64'), rKey));
    this.vaultKey = key;
    this.unlocked = true;
    return { recoveryKey: rk };
  }

  /**
   * Unlock with either the password OR a `GSMM-…` recovery key (his `vault:unlock`). A recovery
   * unlock verifies the recovery verifier, then unwraps the real vault key from the wrapped-key
   * file. Returns `false` (never throws) on any mismatch/corruption — matching his flow.
   */
  async unlock(value: string): Promise<boolean> {
    try {
      const meta = JSON.parse(await this.io.read(this.paths.meta)) as VaultMeta;
      const isRecovery = isRecoveryKeyValue(value);
      const key = derive(value, Buffer.from(isRecovery ? meta.recoverySalt : meta.salt, 'base64'));
      if (decrypt(isRecovery ? meta.recoveryVerifier : meta.verifier, key) !== meta.marker) {
        return false;
      }
      if (isRecovery) {
        if (!(await this.io.exists(this.paths.wrappedKey))) return false;
        this.vaultKey = Buffer.from(decrypt(await this.io.read(this.paths.wrappedKey), key), 'base64');
      } else {
        this.vaultKey = key;
      }
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Lock: zeroize + drop the in-memory key (his `vault:lock`). */
  lock(): void {
    if (this.vaultKey) this.vaultKey.fill(0);
    this.vaultKey = null;
    this.unlocked = false;
  }

  /**
   * Hardened recovery-key export (Global Constraint #2): show a native save dialog, then write
   * the key + warning to the user-CHOSEN path only. NEVER auto-writes to Desktop. A cancelled
   * dialog writes nothing. Rejects a malformed key before touching disk.
   */
  async exportRecoveryKey(key: string, io: RecoveryExportIo): Promise<RecoveryExportResult> {
    if (!isValidRecoveryKeyFormat(key)) {
      throw new Error('Refusing to export a malformed recovery key.');
    }
    const res = await io.showSaveDialog('Ghost-Social-Recovery-Key.txt');
    if (res.canceled || !res.filePath) return { saved: false };
    if (io.assertNotSymlink) await io.assertNotSymlink(res.filePath);
    await io.writeFile(res.filePath, recoveryKeyFileBody(key));
    return { saved: true, filePath: res.filePath };
  }
}

// ── production singleton ─────────────────────────────────────────────────────

let prodInstance: GhostSocialVault | null = null;

/** Production IO: secure-fs (encrypt-at-rest under the GI98 app vault) — resolved lazily so
 *  importing this module never evaluates electron. Exported so the store singleton reuses it. */
export function prodVaultIo(): VaultIo {
  return {
    read: async (p) => {
      const { secureReadText } = await import('../storage/secure-fs');
      return secureReadText(p);
    },
    write: async (p, data) => {
      const { secureWriteFile } = await import('../storage/secure-fs');
      await secureWriteFile(p, data);
    },
    exists: async (p) => {
      const { access } = await import('node:fs/promises');
      try {
        await access(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The production vault singleton. Async because it resolves its data-dir paths through a lazy
 * `import('../storage/paths')` (electron `app` is only available at runtime, after app-ready) —
 * matching the lazy-electron discipline every other main store follows.
 */
export async function prodGhostSocialVault(): Promise<GhostSocialVault> {
  if (prodInstance) return prodInstance;
  const paths = await import('../storage/paths');
  prodInstance = new GhostSocialVault(prodVaultIo(), {
    meta: paths.ghostSocialVaultMetaFile(),
    wrappedKey: paths.ghostSocialWrappedKeyFile(),
  });
  return prodInstance;
}

/** Test seam — drop the production singleton so a test can re-derive it. */
export function _resetProdGhostSocialVaultForTest(): void {
  prodInstance = null;
}
