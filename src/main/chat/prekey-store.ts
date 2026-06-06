/**
 * Prekey store (Phase 1) — persists the responder's signed ML-KEM prekey pool and implements the
 * handshake's ResponderInviteStore. One-time prekeys are consumed DURABLY (fsync before return) so a
 * crash can't resurrect a consumed prekey → no PQ-FS regression (gate C-2). Encrypt-at-rest via
 * secure-fs; a single last-resort covers availability.
 *
 * Path/identity injected (no electron import) so it's testable with a temp dir + vault disabled.
 */
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import {
  generateKemPrekey, encodeKemPrekey, decodeKemPrekey, type IdentityKeyPair, type KemPrekey
} from './identity';
import { randomBytes } from './crypto';

const TOKEN_LEN = 32;
const DEFAULT_POOL = 20;

interface StoredPrekey {
  pid: string;       // hex prekeyId
  enc: string;       // base64 encodeKemPrekey(prekey)
  sk: string;        // base64 ML-KEM secret
  token: string | null; // base64 one-time token (first-contact invites) or null
}
interface PrekeyFile {
  oneTime: StoredPrekey[];
  lastResort: StoredPrekey | null;
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));
const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
export class PrekeyStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string, private readonly identity: IdentityKeyPair) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<PrekeyFile> {
    try {
      const p = JSON.parse(await secureReadText(this.file)) as Partial<PrekeyFile>;
      return { oneTime: Array.isArray(p.oneTime) ? p.oneTime : [], lastResort: p.lastResort ?? null };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { oneTime: [], lastResort: null };
      throw err;
    }
  }

  private async write(f: PrekeyFile): Promise<void> {
    // durable: consumption/issuance state must survive a crash (gate C-2)
    await secureWriteFile(this.file, JSON.stringify(f), { durable: true });
  }

  private mint(token: Uint8Array | null, isLastResort = false): StoredPrekey {
    const { prekey, secretKey } = generateKemPrekey(this.identity, isLastResort);
    return { pid: hex(prekey.prekeyId), enc: b64(encodeKemPrekey(prekey)), sk: b64(secretKey), token: token ? b64(token) : null };
  }

  private hydrate(s: StoredPrekey): { prekey: KemPrekey; secretKey: Uint8Array; token: Uint8Array | null } {
    return { prekey: decodeKemPrekey(unb64(s.enc)), secretKey: unb64(s.sk), token: s.token ? unb64(s.token) : null };
  }

  /** Ensure a last-resort prekey exists + the one-time pool is topped up to `size`. */
  ensurePool(size = DEFAULT_POOL): Promise<void> {
    return this.serialize(async () => {
      const f = await this.read();
      if (!f.lastResort) f.lastResort = this.mint(null, true);
      while (f.oneTime.length < size) f.oneTime.push(this.mint(null));
      await this.write(f);
    });
  }

  /** Mint a first-contact invite: a fresh one-time prekey bound to a fresh token. */
  issueFirstContactInvite(): Promise<{ prekey: KemPrekey; token: Uint8Array }> {
    return this.serialize(async () => {
      const f = await this.read();
      const token = randomBytes(TOKEN_LEN);
      const s = this.mint(token);
      f.oneTime.push(s);
      await this.write(f);
      return { prekey: decodeKemPrekey(unb64(s.enc)), token };
    });
  }

  // ---- ResponderInviteStore ----
  async lookup(prekeyId: Uint8Array): Promise<{ prekey: KemPrekey; secretKey: Uint8Array; token: Uint8Array | null } | null> {
    const f = await this.read();
    const id = hex(prekeyId);
    const s = f.oneTime.find((x) => x.pid === id) ?? (f.lastResort?.pid === id ? f.lastResort : null);
    return s ? this.hydrate(s) : null;
  }

  consume(prekeyId: Uint8Array): Promise<void> {
    return this.serialize(async () => {
      const f = await this.read();
      const id = hex(prekeyId);
      if (f.lastResort?.pid === id) return; // last-resort is reused — never consumed
      const before = f.oneTime.length;
      f.oneTime = f.oneTime.filter((x) => x.pid !== id);
      if (f.oneTime.length !== before) await this.write(f); // durable delete
    });
  }

  issueNext(): Promise<KemPrekey> {
    return this.serialize(async () => {
      const f = await this.read();
      const s = this.mint(null);
      f.oneTime.push(s);
      await this.write(f);
      return decodeKemPrekey(unb64(s.enc));
    });
  }

  /** Diagnostics: remaining one-time prekeys. */
  async remaining(): Promise<number> {
    return (await this.read()).oneTime.length;
  }
}
