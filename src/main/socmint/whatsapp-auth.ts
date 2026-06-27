/**
 * WA-T3: secretStore-backed WhatsApp auth state adapter.
 *
 * Replaces Baileys' useMultiFileAuthState (which writes 28+ plaintext files) with
 * an OS-encrypted secretStore backend.  The long-term Signal identity key is critical
 * material — it decrypts past and future messages.  Plaintext-file storage is not
 * acceptable for production use.
 *
 * Storage layout (two blobs per burner):
 *   socmint.whatsapp.burner.<safeId>.creds   — JSON-serialised AuthenticationCreds
 *   socmint.whatsapp.burner.<safeId>.keys    — JSON-serialised Signal key store map
 *
 * safeId = burnerId.replace(/[/\\]/g, '_')   — path-separator-safe keychain key.
 *
 * Invariants:
 *   - withLock('wa-auth:<safeId>') serialises all state-mutating operations.
 *   - Writes are 200ms-debounced.  Baileys ratchets creds.update on every inbound
 *     message; debouncing prevents keychain saturation.  In-memory state is
 *     authoritative; secretStore is best-effort-latest.
 *   - keys are stored as a single JSON blob (NOT per-key) to avoid keychain
 *     saturation from the Signal pre-key fanout.
 *   - creds and keys objects are mutated in place during initialize() so external
 *     references captured before the call remain valid.
 *   - No static @whiskeysockets/baileys import anywhere in this file (sealed seam).
 *   - Secrets are never echoed to the renderer — no IPC exposure in this module.
 *   - unlinkSession() deletes both blobs but does NOT server-side unlink the device;
 *     the operator must do that manually via WhatsApp → Linked Devices.
 */

import { withLock } from '../util/mutex';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WA_KEY_PREFIX = 'socmint.whatsapp.burner.';

// ---------------------------------------------------------------------------
// Buffer-safe JSON codec
// ---------------------------------------------------------------------------
//
// AuthenticationCreds and the Signal key store hold Buffer / Uint8Array key
// material (noiseKey, signedIdentityKey, signedPreKey, advSecretKey, pairing
// keys, session bytes). Plain JSON.stringify turns a Buffer into
// {"type":"Buffer","data":[...]} and plain JSON.parse returns a NON-Buffer plain
// object — so on the next process start Baileys' Noise/Signal crypto operates on
// non-Buffers and the burner cannot reconnect (re-pair required).
//
// These replacer/reviver functions are byte-for-byte compatible with Baileys'
// own BufferJSON ({ type:'Buffer', data:<base64> }); they are inlined here so the
// adapter stays a sealed seam (no static @whiskeysockets/baileys import). The
// serialized form is internal storage only — Baileys never sees it, it only ever
// receives the in-memory Buffer objects we revive.

interface SerializedBuffer {
  type: 'Buffer';
  data: string;
}

function bufferReplacer(_key: string, value: unknown): unknown {
  // By the time the replacer runs, a Buffer has already had toJSON() applied,
  // arriving here as { type:'Buffer', data:[...numbers] }; a Uint8Array arrives
  // raw. Normalise both into a base64 SerializedBuffer.
  if (value instanceof Uint8Array) {
    return { type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    const data = (value as { data: number[] }).data;
    return { type: 'Buffer', data: Buffer.from(data).toString('base64') };
  }
  return value;
}

function bufferReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'Buffer' &&
    typeof (value as { data?: unknown }).data === 'string'
  ) {
    return Buffer.from((value as SerializedBuffer).data, 'base64');
  }
  return value;
}

/** Buffer-aware JSON.stringify (Signal/Noise key material survives the round-trip). */
function serialize(value: unknown): string {
  return JSON.stringify(value, bufferReplacer);
}

/** Buffer-aware JSON.parse (revives base64 blobs back into Buffer instances). */
function deserialize(text: string): unknown {
  return JSON.parse(text, bufferReviver);
}

/** Debounce delay in milliseconds.  Exported so tests can advance by exactly this
 *  amount without duplicating the magic number. */
export const DEBOUNCE_MS = 200;

// ---------------------------------------------------------------------------
// Deps interface — injection seam (secretStore in prod, in-memory Map in tests)
// ---------------------------------------------------------------------------

export interface WhatsAppAuthDeps {
  /** Read a stored value; returns null when absent. */
  read(key: string): Promise<string | null>;
  /** Write (or overwrite) a stored value. */
  write(key: string, value: string): Promise<void>;
  /** Delete a stored value; no-op when absent. */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal types — structural only, no @whiskeysockets/baileys import
// ---------------------------------------------------------------------------

/**
 * Loosely typed credentials blob (structural match for Baileys AuthenticationCreds).
 * Serialised as a single JSON blob; never split across per-field keychain entries.
 */
export type WACreds = Record<string, unknown>;

/**
 * Signal key store blob: { [type: string]: { [id: string]: value } }.
 * Stored as a SINGLE blob (not per-key) to avoid keychain saturation from the
 * Signal pre-key fanout which Baileys emits in bursts.
 */
export type WAKeys = Record<string, Record<string, unknown>>;

/** Key store interface (subset of Baileys SignalKeyStore; no library import). */
export interface WAKeyStore {
  /**
   * Retrieve values for the given (type, ids) pairs from the in-memory store.
   * Returns only the ids that are present; absent ids are omitted from the result.
   */
  get(type: string, ids: string[]): Promise<Record<string, unknown>>;
  /**
   * Merge updates into the in-memory key store, then schedule a debounced write.
   * Null / undefined values delete the id entry (Baileys uses null to evict).
   * Serialised with withLock to prevent concurrent mutations corrupting the blob.
   */
  set(data: Partial<WAKeys>): Promise<void>;
}

/** Full return type of makeWhatsAppAuthState. */
export interface WhatsAppAuthState {
  /**
   * Live auth state — pass directly to makeWASocket as the `auth` option.
   *   sock = makeWASocket({ auth: auth.state, ... })
   * Both creds and keys are mutated in place; references captured before
   * initialize() remain valid after initialize() is called.
   */
  state: { creds: WACreds; keys: WAKeyStore };
  /**
   * Load (or reload) creds and keys from the secretStore into the in-memory state.
   * Must be called once before the Baileys socket is created.
   * Serialised with withLock so concurrent key-store mutations are queued behind it.
   */
  initialize(): Promise<void>;
  /**
   * Schedule a debounced write of the in-memory creds to secretStore.
   * Call this from the Baileys 'creds.update' event handler:
   *   sock.ev.on('creds.update', () => auth.saveCreds())
   * The in-memory state is updated synchronously by Baileys before the event fires;
   * the secretStore write is delayed by DEBOUNCE_MS to coalesce rapid updates.
   */
  saveCreds(): Promise<void>;
  /**
   * Delete both creds and keys blobs from secretStore and clear in-memory state.
   * Cancels any pending debounced writes so cleared state cannot be written back.
   * Does NOT server-side unlink the device; the operator must do that manually via
   * WhatsApp → Linked Devices after calling this.
   */
  unlinkSession(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a secretStore-backed WhatsApp auth state for the given burner.
 *
 * @param burnerId  Burner identifier.  Path separators (/ and \) are replaced with
 *                  '_' to produce a safe keychain key (safeId).
 * @param deps      Injected storage operations:
 *                    production — wired to secretStore.get / .set / .delete
 *                    tests      — backed by an in-memory Map
 *
 * Production usage:
 *   const auth = makeWhatsAppAuthState(burnerId, {
 *     read:   (k) => secretStore.get(k).then(v => v ?? null),
 *     write:  (k, v) => secretStore.set(k, v),
 *     delete: (k) => secretStore.delete(k),
 *   });
 *   await auth.initialize();
 *   const sock = makeWASocket({ auth: auth.state, logger: pino({level:'silent'}), ... });
 *   sock.ev.on('creds.update', () => auth.saveCreds());
 */
export function makeWhatsAppAuthState(
  burnerId: string,
  deps: WhatsAppAuthDeps,
): WhatsAppAuthState {
  const safeId = burnerId.replace(/[/\\]/g, '_');
  const credsKey = `${WA_KEY_PREFIX}${safeId}.creds`;
  const keysKey  = `${WA_KEY_PREFIX}${safeId}.keys`;
  const lockKey  = `wa-auth:${safeId}`;

  // In-memory state — authoritative; objects are mutated in place so external
  // references (e.g. the auth object passed to makeWASocket) remain valid.
  const creds: WACreds = {};
  const keys:  WAKeys  = {};

  // Debounce timer handles (null = no pending write).
  let credsTimer: ReturnType<typeof setTimeout> | null = null;
  let keysTimer:  ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function scheduleCredsWrite(): void {
    if (credsTimer !== null) clearTimeout(credsTimer);
    credsTimer = setTimeout(() => {
      credsTimer = null;
      // Fire-and-forget: a keychain write failure is non-fatal (in-memory is authoritative).
      void deps.write(credsKey, serialize(creds));
    }, DEBOUNCE_MS);
  }

  function scheduleKeysWrite(): void {
    if (keysTimer !== null) clearTimeout(keysTimer);
    keysTimer = setTimeout(() => {
      keysTimer = null;
      void deps.write(keysKey, serialize(keys));
    }, DEBOUNCE_MS);
  }

  /** Overwrite obj in place with the contents of src, clearing stale keys first. */
  function repopulate<T extends Record<string, unknown>>(obj: T, src: T): void {
    for (const k of Object.keys(obj)) delete (obj as Record<string, unknown>)[k];
    Object.assign(obj, src);
  }

  // ---------------------------------------------------------------------------
  // Key store implementation
  // ---------------------------------------------------------------------------

  const keyStore: WAKeyStore = {
    async get(type: string, ids: string[]): Promise<Record<string, unknown>> {
      const bucket = keys[type] ?? {};
      const result: Record<string, unknown> = {};
      for (const id of ids) {
        if (Object.prototype.hasOwnProperty.call(bucket, id)) {
          result[id] = bucket[id];
        }
      }
      return result;
    },

    async set(data: Partial<WAKeys>): Promise<void> {
      return withLock(lockKey, async () => {
        for (const [type, entries] of Object.entries(data)) {
          if (!entries) continue;
          if (!keys[type]) keys[type] = {};
          const bucket = keys[type];
          for (const [id, value] of Object.entries(entries)) {
            if (value === null || value === undefined) {
              delete bucket[id];
            } else {
              bucket[id] = value;
            }
          }
          // Prune empty buckets to keep the blob lean.
          if (Object.keys(bucket).length === 0) delete keys[type];
        }
        scheduleKeysWrite();
      });
    },
  };

  // Stable state object — pass to makeWASocket({ auth: state }).
  const state: WhatsAppAuthState['state'] = { creds, keys: keyStore };

  // ---------------------------------------------------------------------------
  // Exported methods
  // ---------------------------------------------------------------------------

  return {
    state,

    async initialize(): Promise<void> {
      return withLock(lockKey, async () => {
        const [credsJson, keysJson] = await Promise.all([
          deps.read(credsKey),
          deps.read(keysKey),
        ]);

        // Repopulate in place so external references stay valid.
        let parsedCreds: WACreds = {};
        if (credsJson) {
          try { parsedCreds = deserialize(credsJson) as WACreds; } catch { /* leave empty */ }
        }
        repopulate(creds as Record<string, unknown>, parsedCreds as Record<string, unknown>);

        let parsedKeys: WAKeys = {};
        if (keysJson) {
          try { parsedKeys = deserialize(keysJson) as WAKeys; } catch { /* leave empty */ }
        }
        repopulate(keys as Record<string, unknown>, parsedKeys as Record<string, unknown>);
      });
    },

    async saveCreds(): Promise<void> {
      scheduleCredsWrite();
    },

    async unlinkSession(): Promise<void> {
      return withLock(lockKey, async () => {
        // Cancel pending writes BEFORE clearing state so no stale data is written back.
        if (credsTimer !== null) { clearTimeout(credsTimer); credsTimer = null; }
        if (keysTimer  !== null) { clearTimeout(keysTimer);  keysTimer  = null; }

        // Clear in-memory state.
        repopulate(creds as Record<string, unknown>, {});
        repopulate(keys  as Record<string, unknown>, {});

        // Delete both blobs from secretStore.
        await Promise.all([deps.delete(credsKey), deps.delete(keysKey)]);
      });
    },
  };
}
