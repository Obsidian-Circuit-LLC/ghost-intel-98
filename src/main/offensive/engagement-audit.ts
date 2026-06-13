import { openSync, writeSync, fsyncSync, closeSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface AuditEvent {
  seq: number; prevHash: string;
  manifestId: string; manifestContentHash: string;
  host: string; dialedIp: string; port: number; method: string;
  decision: 'allowed' | 'denied'; reason?: string;
  attackType?: string; // SCANNER-ASSERTED, UNVERIFIED
  resolvedIps?: string[]; // full resolved IP set for the decision (optional; absent => omitted from canon)
  at: string;
  sig?: string;
}

const GENESIS = '0'.repeat(64);
const canon = (e: AuditEvent): string => {
  const { sig, ...rest } = e;  // sig is NOT part of the chained bytes
  // JSON.stringify omits keys whose value is `undefined`, so an event without
  // `resolvedIps` serializes byte-identically to a pre-resolvedIps event.
  return JSON.stringify(rest);
};
const chain = (prevHash: string, e: AuditEvent): string =>
  createHash('sha256').update(prevHash).update(canon(e)).digest('hex');

/** Persisted head pointer, written to `<path>.head` after each durable append. */
interface HeadPointer { seq: number; headHash: string; }

const headPath = (path: string): string => path + '.head';

function readHeadSidecar(path: string): HeadPointer | undefined {
  const hp = headPath(path);
  if (!existsSync(hp)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(hp, 'utf8')) as HeadPointer;
    if (typeof parsed.seq === 'number' && typeof parsed.headHash === 'string') return parsed;
  } catch { /* fall through */ }
  return undefined;
}

/** fsync a single line append to the `.log`, then fsync the `{seq,headHash}` sidecar. */
function durableAppend(path: string, line: string, head: HeadPointer): void {
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const hfd = openSync(headPath(path), 'w');
  try {
    writeSync(hfd, JSON.stringify(head));
    fsyncSync(hfd);
  } finally {
    closeSync(hfd);
  }
}

/**
 * Thrown when the durable sidecar head is AHEAD of the chain reconstructed from
 * the `.log` — i.e. the log tail was lost (crash mid-append) or truncated/tampered
 * after the last durable head. Fail-loud: a shorter chain must never silently pass.
 */
export class AuditTruncationError extends Error {
  readonly sidecar?: HeadPointer;
  readonly reconstructed?: HeadPointer;
  constructor(sidecar: HeadPointer, reconstructed: HeadPointer);
  constructor(message: string);
  constructor(
    a: HeadPointer | string,
    reconstructed?: HeadPointer,
  ) {
    if (typeof a === 'string') {
      super(a);
    } else {
      super(
        `engagement audit tail lost: sidecar head {seq:${a.seq},headHash:${a.headHash}} ` +
        `is ahead of reconstructed log {seq:${reconstructed!.seq},headHash:${reconstructed!.headHash}}`,
      );
      this.sidecar = a;
      this.reconstructed = reconstructed;
    }
    this.name = 'AuditTruncationError';
  }
}

export class EngagementAudit {
  private seq = 0;
  private prevHash = GENESIS;
  constructor(private readonly path: string, private readonly signer?: (head: string) => string) {
    if (existsSync(path)) {
      const r = verifyAuditLog(path);
      const reconstructed: HeadPointer = { seq: r.events.length, headHash: r.headHash };
      const sidecar = readHeadSidecar(path);
      if (sidecar) {
        // Sidecar present (durable log). The reconstructed log must match the
        // last durable head exactly. If the sidecar is AHEAD (more events, or a
        // different head at >= the reconstructed seq), the tail was lost or
        // tampered after the last fsync'd head — fail loud.
        const divergent =
          sidecar.seq > reconstructed.seq ||
          (sidecar.seq === reconstructed.seq && sidecar.headHash !== reconstructed.headHash);
        if (divergent) throw new AuditTruncationError(sidecar, reconstructed);
      } else if (statSync(path).size > 0) {
        // NEW-2: sidecar-deletion downgrade defence. A non-empty durable log written by THIS code
        // always has a `.head` sidecar. Its absence on a non-empty log means the sidecar was
        // deleted — the exact move an attacker would make to truncate the `.log` and then dodge
        // the tail-truncation check above by removing the durable head it would be compared against.
        // Absence on a non-empty log == tamper: fail loud. (An empty/absent log is a fresh start.)
        throw new AuditTruncationError('audit head sidecar missing for a non-empty log — possible truncation/tamper');
      }
      // No sidecar on an empty log => fresh start: proceed.
      this.seq = reconstructed.seq;
      this.prevHash = reconstructed.headHash;
    }
  }
  record(partial: Omit<AuditEvent, 'seq' | 'prevHash' | 'sig'>): AuditEvent {
    const e: AuditEvent = { ...partial, seq: this.seq, prevHash: this.prevHash };
    const head = chain(this.prevHash, e);
    if (this.signer) e.sig = this.signer(head);
    durableAppend(this.path, JSON.stringify(e) + '\n', { seq: this.seq + 1, headHash: head });
    this.prevHash = head;
    this.seq += 1;
    return e;
  }
  headHash(): string { return this.prevHash; }
}

export interface AuditVerifyResult { ok: boolean; events: AuditEvent[]; headHash: string; }

export function verifyAuditLog(path: string, verifier?: (sig: string, head: string) => boolean): AuditVerifyResult {
  if (!existsSync(path)) return { ok: true, events: [], headHash: GENESIS };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const events: AuditEvent[] = [];
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let e: AuditEvent;
    try { e = JSON.parse(lines[i]); } catch { return { ok: false, events, headHash: prev }; }
    if (e.seq !== i || e.prevHash !== prev) return { ok: false, events, headHash: prev };
    const head = chain(prev, e);
    if (verifier) {
      if (!e.sig || !verifier(e.sig, head)) return { ok: false, events, headHash: prev };
    }
    events.push(e);
    prev = head;
  }
  return { ok: true, events, headHash: prev };
}
