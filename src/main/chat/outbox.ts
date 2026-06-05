/**
 * Chat outbox (Phase 1, Stage 3) — the sender-side best-effort send queue.
 *
 * Pure, deterministic state machine (no crypto, no IO, no time, no RNG): ids + per-contact sequence
 * numbers + states. The persistence layer snapshots/restores `entries()`; the connection manager
 * pulls `nextQueued()` to flush in order when a session is up and reports acks back.
 *
 * Lifecycle: `queued → sent → delivered`, with `→ failed` (store/send error) and `failed → queued`
 * (retry). Best-effort: a message with no connection stays `queued` indefinitely (no relay). Dedup by
 * id makes a resend after an ambiguous ack idempotent — never a double-insert.
 */

export type OutboxState = 'queued' | 'sent' | 'delivered' | 'failed';

export interface OutboxEntry {
  id: string;
  /** Per-contact monotonic sequence; defines flush + display order. */
  seq: number;
  state: OutboxState;
}

export class OutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxError';
  }
}

/** Cap on undelivered (queued|sent|failed) entries — backpressure against unbounded growth when a
 *  peer is offline for a long time. Delivered entries don't count (they can be pruned/archived). */
export const MAX_OUTBOX = 5000;

const VALID: Record<OutboxState, ReadonlySet<OutboxState>> = {
  queued: new Set<OutboxState>(['sent', 'failed']),
  sent: new Set<OutboxState>(['delivered', 'failed']),
  failed: new Set<OutboxState>(['queued']), // retry
  delivered: new Set<OutboxState>() // terminal
};

export class Outbox {
  private readonly map = new Map<string, OutboxEntry>();

  /** Restore from a persisted snapshot (already-validated entries). */
  constructor(initial: OutboxEntry[] = []) {
    for (const e of initial) this.map.set(e.id, { ...e });
  }

  private undeliveredCount(): number {
    let n = 0;
    for (const e of this.map.values()) if (e.state !== 'delivered') n += 1;
    return n;
  }

  /** Add a new outgoing message in `queued`. Idempotent on id (dedup); enforces the depth cap. */
  enqueue(id: string, seq: number): OutboxEntry {
    const existing = this.map.get(id);
    if (existing) return existing; // dedup: a retried enqueue is a no-op, not a duplicate
    if (!Number.isInteger(seq) || seq < 0) throw new OutboxError('seq must be a non-negative integer');
    if (this.undeliveredCount() >= MAX_OUTBOX) throw new OutboxError('outbox full');
    const entry: OutboxEntry = { id, seq, state: 'queued' };
    this.map.set(id, entry);
    return entry;
  }

  private transition(id: string, to: OutboxState): OutboxEntry {
    const e = this.map.get(id);
    if (!e) throw new OutboxError(`unknown outbox id ${id}`);
    if (e.state === to) return e; // idempotent
    if (!VALID[e.state].has(to)) throw new OutboxError(`invalid transition ${e.state} → ${to}`);
    e.state = to;
    return e;
  }

  markSent(id: string): OutboxEntry {
    return this.transition(id, 'sent');
  }
  markDelivered(id: string): OutboxEntry {
    return this.transition(id, 'delivered');
  }
  markFailed(id: string): OutboxEntry {
    return this.transition(id, 'failed');
  }
  /** Re-queue a failed message for another flush attempt. */
  retry(id: string): OutboxEntry {
    return this.transition(id, 'queued');
  }

  /** Lowest-seq message still `queued` — the next to put on the wire. Null when nothing is pending. */
  nextQueued(): OutboxEntry | null {
    let best: OutboxEntry | null = null;
    for (const e of this.map.values()) {
      if (e.state === 'queued' && (best === null || e.seq < best.seq)) best = e;
    }
    return best ? { ...best } : null;
  }

  byId(id: string): OutboxEntry | undefined {
    const e = this.map.get(id);
    return e ? { ...e } : undefined;
  }

  /** Snapshot in seq order (for persistence + UI). */
  entries(): OutboxEntry[] {
    return [...this.map.values()].map((e) => ({ ...e })).sort((a, b) => a.seq - b.seq);
  }

  /** Drop delivered entries (prune after they've been folded into history). Returns dropped count. */
  pruneDelivered(): number {
    let n = 0;
    for (const [id, e] of this.map) {
      if (e.state === 'delivered') {
        this.map.delete(id);
        n += 1;
      }
    }
    return n;
  }

  get size(): number {
    return this.map.size;
  }
}
