/**
 * Chat identity store (Phase 1) — load-or-create the user's long-term chat identity (Ed25519 +
 * X25519) and persist the STABLE onion service key blob, encrypt-at-rest via secure-fs (sealed when
 * login is on, like case data when it's off). Path injected (no electron).
 *
 * The identity + onion key are the user's durable chat identity: the onion is the network locator in
 * every invite and is reused on reconnect, so it must persist across restarts.
 */
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { generateIdentity, type IdentityKeyPair } from './identity';

interface StoredIdentity {
  ed: { pub: string; sec: string };
  x: { pub: string; sec: string };
  onionKey: string | null; // "ED25519-V3:…" (set after the first onion publish)
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

function toStored(id: IdentityKeyPair, onionKey: string | null): StoredIdentity {
  return {
    ed: { pub: b64(id.publicKeys.ed25519), sec: b64(id.ed25519Secret) },
    x: { pub: b64(id.publicKeys.x25519), sec: b64(id.x25519Secret) },
    onionKey
  };
}
function toIdentity(s: StoredIdentity): IdentityKeyPair {
  return {
    publicKeys: { ed25519: unb64(s.ed.pub), x25519: unb64(s.x.pub) },
    ed25519Secret: unb64(s.ed.sec),
    x25519Secret: unb64(s.x.sec)
  };
}

export class ChatIdentityStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async read(): Promise<StoredIdentity | null> {
    try {
      return JSON.parse(await secureReadText(this.file)) as StoredIdentity;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Return the persisted identity, creating + persisting a fresh one on first run. */
  loadOrCreate(): Promise<IdentityKeyPair> {
    return this.serialize(async () => {
      const existing = await this.read();
      if (existing) return toIdentity(existing);
      const id = generateIdentity();
      await secureWriteFile(this.file, JSON.stringify(toStored(id, null)));
      return id;
    });
  }

  getOnionKey(): Promise<string | null> {
    return this.read().then((s) => s?.onionKey ?? null);
  }

  /** Persist the stable onion key blob the first time tor mints the service (durable). */
  setOnionKey(blob: string): Promise<void> {
    return this.serialize(async () => {
      const s = await this.read();
      if (!s) throw new Error('identity not initialized');
      s.onionKey = blob;
      await secureWriteFile(this.file, JSON.stringify(s), { durable: true });
    });
  }
}
