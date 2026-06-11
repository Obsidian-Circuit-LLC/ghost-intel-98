/**
 * Journal Jots store — a password-(PIN)-gated personal journal. Entries are consolidated INSIDE
 * the Journal app: they live in their own journal.json and are NEVER written to the Briefcase or
 * into any case. Mirrors briefcase.ts in shape (one JSON array, serialized read-modify-write).
 *
 * Persisted under dataRoot via secure-fs, so entries are encrypted at rest exactly when the app's
 * vault login is on — same as case data and briefcase notes. Zero network.
 *
 * SECURITY MODEL — read this before reasoning about the PIN:
 *   The 4-digit PIN is a RATE-LIMITED UI GATE on top of storage that is ALREADY vault-encrypted
 *   at rest. It is NOT the encryption key, and it is NOT the security boundary. A 4-digit space is
 *   ten thousand values — trivially brute-forceable offline if it guarded ciphertext directly, so
 *   it does not. The real at-rest protection is the vault DEK (see services/vault.ts); the PIN
 *   only stops casual over-the-shoulder access to an already-unlocked app. We still (a) store only
 *   {salt, hash, params} from scrypt — never the plaintext PIN, (b) compare in constant time, and
 *   (c) rate-limit verification with an escalating lockout, so the gate is honest about what it is.
 *
 * Forget-PIN recovery is intentionally NOT built: because the PIN is not the encryption key, a
 * recovery path would just be a second UI gate — there is nothing to cryptographically recover.
 * Resetting the PIN (which would require its own confirmation flow) is left as a future task; the
 * journal entries themselves remain readable through the vault regardless of the PIN.
 */

import { join } from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { dataRoot } from './paths';
import { secureReadText, secureWriteFile } from './secure-fs';
import type { JournalEntry, JournalEntrySummary, JournalEntryInput } from '@shared/types';

const MAX_ENTRIES = 5000;
const MAX_TITLE = 200;
const MAX_BODY = 2 * 1024 * 1024;

const journalFile = (): string => join(dataRoot(), 'journal.json');
const metaFile = (): string => join(dataRoot(), 'journal-meta.json');

// scrypt params for the PIN hash. Same family as the vault KEK derivation (services/vault.ts),
// trimmed to N=2^14 — the PIN is a low-entropy UI gate, not the encryption key, so the cost is
// tuned for responsive verification rather than to resist offline cracking (which the at-rest
// vault, not the PIN, is responsible for).
const PIN_KDF = { N: 1 << 14, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 } as const;

// Rate-limit policy: after this many consecutive failures, verifyPin refuses ALL attempts (even a
// correct PIN) until a backoff window elapses. The window grows with the overflow count, capped.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_BASE_MS = 30_000;   // first lockout window
const LOCKOUT_MAX_MS = 15 * 60_000;

interface JournalMeta {
  version: 1;
  /** base64 random salt. */
  salt: string;
  /** base64 scrypt output over (pin, salt). */
  hash: string;
  params: { N: number; r: number; p: number; keylen: number };
}

// --- injectable monotonic clock (determinism in the security path) -----------------------------
// Default to a monotonic process clock, NOT Date.now()/time.time(): wall-clock can jump backwards
// (NTP, DST, manual change) and a backwards jump must never shorten a lockout. Tests inject a fake.
let now: () => number = () => Math.floor(performance.now());
export function _setClockForTest(fn: () => number): void { now = fn; }

// In-memory failure tracking. Resets on a correct PIN and is process-local (a restart clears it —
// acceptable: the gate is a convenience boundary, and the disk corpus is vault-protected anyway).
let failedAttempts = 0;
let lockedUntil = 0;

// --- entry store (mirrors briefcase.ts) --------------------------------------------------------

/** Newest-first by ISO updatedAt. Plain string comparison (ASCII ISO-8601) — locale-independent
 *  and deterministic, same rationale as briefcase.ts. */
function byUpdatedDesc(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

async function readAll(): Promise<JournalEntry[]> {
  try {
    const parsed = JSON.parse(await secureReadText(journalFile())) as unknown;
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}

async function writeAll(list: JournalEntry[]): Promise<void> {
  await secureWriteFile(journalFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<JournalEntrySummary[]> {
  const all = await readAll();
  return all
    .slice()
    .sort(byUpdatedDesc)
    .map((e) => ({ id: e.id, title: e.title, updatedAt: e.updatedAt, bytes: Buffer.byteLength(e.body ?? '', 'utf8') }));
}

export async function read(id: string): Promise<JournalEntry | null> {
  const all = await readAll();
  return all.find((e) => e.id === id) ?? null;
}

/** Upsert an entry. The store owns the id (minted on first save), createdAt (first save) and
 *  updatedAt (every save). Title/body are bounded defensively — the renderer is treated as hostile. */
export async function save(input: JournalEntryInput): Promise<JournalEntry> {
  return serialize(async () => {
    const all = await readAll();
    const nowIso = new Date().toISOString();
    const id = input.id && all.some((e) => e.id === input.id) ? input.id : input.id || randomUUID();
    const existing = all.find((e) => e.id === id);
    const record: JournalEntry = {
      id,
      title: (typeof input.title === 'string' && input.title.trim() ? input.title : 'Untitled').slice(0, MAX_TITLE),
      body: typeof input.body === 'string' ? input.body.slice(0, MAX_BODY) : '',
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso
    };
    const others = all.filter((e) => e.id !== id);
    const next = [record, ...others.sort(byUpdatedDesc)].slice(0, MAX_ENTRIES);
    await writeAll(next);
    return record;
  });
}

export async function remove(id: string): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    const next = all.filter((e) => e.id !== id);
    if (next.length !== all.length) await writeAll(next);
  });
}

// --- PIN meta ----------------------------------------------------------------------------------

/** A PIN is exactly four ASCII digits. Anything else is rejected at the boundary (the main
 *  process is unsandboxed; treat the input defensively). */
function assertValidPin(pin: unknown): asserts pin is string {
  if (typeof pin !== 'string' || !/^[0-9]{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits.');
  }
}

function hashPin(pin: string, salt: Buffer): Buffer {
  return scryptSync(Buffer.from(pin, 'utf8'), salt, PIN_KDF.keylen, {
    N: PIN_KDF.N, r: PIN_KDF.r, p: PIN_KDF.p, maxmem: PIN_KDF.maxmem
  });
}

async function readMeta(): Promise<JournalMeta | null> {
  try {
    const parsed = JSON.parse(await secureReadText(metaFile())) as JournalMeta;
    return parsed && typeof parsed.salt === 'string' && typeof parsed.hash === 'string' ? parsed : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

async function writeMeta(meta: JournalMeta): Promise<void> {
  await secureWriteFile(metaFile(), JSON.stringify(meta, null, 2));
}

export async function hasPin(): Promise<boolean> {
  return (await readMeta()) !== null;
}

/** Set (or replace) the PIN. Stores ONLY {salt, hash, params} — never the plaintext. */
export async function setPin(pin: string): Promise<void> {
  assertValidPin(pin);
  return serialize(async () => {
    const salt = randomBytes(16);
    const hash = hashPin(pin, salt);
    const meta: JournalMeta = {
      version: 1,
      salt: salt.toString('base64'),
      hash: hash.toString('base64'),
      params: { N: PIN_KDF.N, r: PIN_KDF.r, p: PIN_KDF.p, keylen: PIN_KDF.keylen }
    };
    hash.fill(0);
    await writeMeta(meta);
    // A freshly set PIN clears any prior rate-limit state.
    failedAttempts = 0;
    lockedUntil = 0;
  });
}

/** Recompute the hash and compare in constant time. Returns false (never throws) for a wrong or
 *  malformed PIN, for a missing meta, or while locked out — the caller treats all of these as "no". */
function matches(meta: JournalMeta, pin: string): boolean {
  const salt = Buffer.from(meta.salt, 'base64');
  const stored = Buffer.from(meta.hash, 'base64');
  const params = meta.params ?? PIN_KDF;
  const candidate = scryptSync(Buffer.from(pin, 'utf8'), salt, params.keylen ?? PIN_KDF.keylen, {
    N: params.N ?? PIN_KDF.N, r: params.r ?? PIN_KDF.r, p: params.p ?? PIN_KDF.p, maxmem: PIN_KDF.maxmem
  });
  try {
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  } finally {
    candidate.fill(0);
  }
}

/** Verify the PIN, rate-limited. While in a lockout window EVERY attempt (correct or not) returns
 *  false. A correct PIN outside the window resets the counter; a wrong one escalates and, on the
 *  Nth consecutive failure, arms an escalating backoff lockout. */
export async function verifyPin(pin: string): Promise<boolean> {
  if (typeof pin !== 'string' || !/^[0-9]{4}$/.test(pin)) return false;
  const meta = await readMeta();
  if (!meta) return false;

  const t = now();
  if (t < lockedUntil) return false; // inside the lockout window — refuse unconditionally

  if (matches(meta, pin)) {
    failedAttempts = 0;
    lockedUntil = 0;
    return true;
  }

  failedAttempts += 1;
  if (failedAttempts >= LOCKOUT_THRESHOLD) {
    // Escalate the window with each overflow past the threshold, capped. Monotonic clock means a
    // wall-clock jump backwards can never shorten an active lockout.
    const overflow = failedAttempts - LOCKOUT_THRESHOLD;
    const window = Math.min(LOCKOUT_BASE_MS * 2 ** overflow, LOCKOUT_MAX_MS);
    lockedUntil = t + window;
  }
  return false;
}

/** Rotate the PIN. Requires the current PIN (verified, but NOT through the rate-limited path —
 *  a settings-screen rotation shouldn't trip or be blocked by the lock screen's counter). Returns
 *  false if the old PIN is wrong or no PIN is set; throws only on a malformed NEW PIN. */
export async function changePin(oldPin: string, newPin: string): Promise<boolean> {
  assertValidPin(newPin);
  const meta = await readMeta();
  if (!meta) return false;
  if (!(typeof oldPin === 'string' && /^[0-9]{4}$/.test(oldPin) && matches(meta, oldPin))) return false;
  await setPin(newPin);
  return true;
}

// --- test seams --------------------------------------------------------------------------------

export async function _resetForTest(): Promise<void> {
  failedAttempts = 0;
  lockedUntil = 0;
  await writeAll([]);
}
