/**
 * Contact store (Phase 1) — persists pinned peers (TOFU) + per-contact metadata, and implements the
 * handshake's ContactPinStore (get/pin). Encrypt-at-rest via secure-fs. Path injected (no electron).
 *
 * A contact is keyed by contactId (hash of its pinned identity). Identity keys are pinned on first
 * contact; a later key change is a hard MITM signal — pin() refuses to silently overwrite a differing
 * identity (the engine surfaces that as the loud warning).
 */
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { contactId, type IdentityPublic, type KemPrekey } from './identity';
import { encodeKemPrekey, decodeKemPrekey } from './identity';

export interface Contact {
  contactId: string;
  identity: IdentityPublic;
  onion: string | null;
  displayName: string;
  verified: boolean;
  lastSeen: number | null; // ms epoch (caller-stamped; never time() inside)
  /** The responder's rotation prekey for our next reconnect (we are the initiator). */
  nextPrekey: KemPrekey | null;
}

interface StoredContact {
  contactId: string;
  ed: string; // b64 ed25519
  x: string;  // b64 x25519
  onion: string | null;
  displayName: string;
  verified: boolean;
  lastSeen: number | null;
  nextPrekey: string | null; // b64 encodeKemPrekey
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

export class ContactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactError';
  }
}

function toStored(c: Contact): StoredContact {
  return {
    contactId: c.contactId,
    ed: b64(c.identity.ed25519),
    x: b64(c.identity.x25519),
    onion: c.onion,
    displayName: c.displayName,
    verified: c.verified,
    lastSeen: c.lastSeen,
    nextPrekey: c.nextPrekey ? b64(encodeKemPrekey(c.nextPrekey)) : null
  };
}
function fromStored(s: StoredContact): Contact {
  return {
    contactId: s.contactId,
    identity: { ed25519: unb64(s.ed), x25519: unb64(s.x) },
    onion: s.onion,
    displayName: s.displayName,
    verified: s.verified,
    lastSeen: s.lastSeen,
    nextPrekey: s.nextPrekey ? decodeKemPrekey(unb64(s.nextPrekey)) : null
  };
}

export class ContactStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<StoredContact[]> {
    try {
      const arr = JSON.parse(await secureReadText(this.file)) as unknown;
      return Array.isArray(arr) ? (arr as StoredContact[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
  private async write(list: StoredContact[]): Promise<void> {
    await secureWriteFile(this.file, JSON.stringify(list));
  }

  async list(): Promise<Contact[]> {
    return (await this.read()).map(fromStored);
  }

  async getById(id: string): Promise<Contact | null> {
    const found = (await this.read()).find((c) => c.contactId === id);
    return found ? fromStored(found) : null;
  }

  // ---- ContactPinStore ----
  async get(peerEd25519: Uint8Array): Promise<IdentityPublic | null> {
    const id = Buffer.from(peerEd25519).toString('base64');
    const found = (await this.read()).find((c) => c.ed === id);
    return found ? fromStored(found).identity : null;
  }

  /** Pin a peer on first contact. If a contact with the same contactId already exists with a DIFFERENT
   *  identity, refuse (MITM/key-change) — never silently overwrite. */
  pin(peer: IdentityPublic, opts: { onion?: string; displayName?: string } = {}): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read();
      const id = contactId(peer);
      const existing = list.find((c) => c.contactId === id);
      if (existing) {
        if (existing.ed !== b64(peer.ed25519) || existing.x !== b64(peer.x25519)) {
          throw new ContactError('identity mismatch for existing contactId (possible MITM)');
        }
        if (opts.onion !== undefined) existing.onion = opts.onion;
        await this.write(list);
        return;
      }
      list.push(
        toStored({
          contactId: id,
          identity: peer,
          onion: opts.onion ?? null,
          displayName: opts.displayName ?? id.slice(0, 12),
          verified: false,
          lastSeen: null,
          nextPrekey: null
        })
      );
      await this.write(list);
    });
  }

  /** Patch mutable fields of an existing contact. */
  update(id: string, patch: Partial<Pick<Contact, 'onion' | 'displayName' | 'verified' | 'lastSeen' | 'nextPrekey'>>): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read();
      const c = list.find((x) => x.contactId === id);
      if (!c) throw new ContactError(`unknown contact ${id}`);
      const merged = fromStored(c);
      Object.assign(merged, patch);
      Object.assign(c, toStored(merged));
      await this.write(list);
    });
  }
}
