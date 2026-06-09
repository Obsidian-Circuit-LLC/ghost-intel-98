/**
 * Reconnect rate-limiter (Phase 1, Task 2.5 / spec N-3) — the GLOBAL (across-dials) DoS bound on the
 * responder's UNGATED reconnect path.
 *
 * The threat: a reconnect Msg1 whose mac_R gate is not yet enforced (an UNCONFIRMED contact, or a
 * consumed-but-indexed strand id) reaches R's expensive asymmetric work (lookup → ML-KEM decap → ECDH,
 * or a fresh ed25519 Reject signature) without an authenticator R can cheaply verify. The per-dial
 * reject cap (Task 2.4, MAX_REJECTS_PER_DIAL) bounds one dial's loop; this limiter bounds attempts
 * ACROSS dials so a flood of fresh dials can't drive unbounded asymmetric work.
 *
 * Design (spec open-q #4):
 *   - TWO token buckets. A RESERVED bucket for recognized ids (recognized:true — the id is in R's
 *     per-contact issuance index, so it is a legacy-first OR strand-recovery reconnect we WANT to
 *     serve) and a TIGHTER bucket for unrecognized ids (recognized:false — pure off-path garbage).
 *     Splitting the budget means a garbage flood saturates only the tighter bucket; the reserved
 *     budget that legitimate reconnects need is never starved.
 *   - Each bucket is bounded by a windowed COUNT over a caller-stamped LOGICAL tick. There is NO
 *     internal clock — `now()` is injected (charter: NO time()/Date.now()/unseeded RNG in the gate
 *     path). The "window" is a logical sequence value the caller advances; admissions reset when the
 *     tick changes. This keeps the limiter fully deterministic and unit-testable.
 *   - Reserved admission FIRST consults a bounded Msg1-fingerprint SEEN-SET: a repeat fp → refused
 *     (dedup / anti-replay — a replayed identical Msg1 must not re-spend reserved capacity). The
 *     seen-set is sized >= the reserved window so eviction can never out-pace the bucket (an id that
 *     still counts against the window is still in the seen-set).
 *
 * `admit({recognized, fp})` returns `{allowed}`. The caller (handshake responder) calls this BEFORE
 * any asymmetric op on the ungated reconnect branch and closes cheaply on `!allowed`.
 */

export interface ReconnectRateLimiterOpts {
  /** Injected LOGICAL tick source (sequence/window counter). NO internal clock. Required for determinism. */
  now: () => number;
  /** Max recognized-id admissions per logical window. Default 32 (spec open-q #4). */
  reservedWindow?: number;
  /** Max unrecognized-id admissions per logical window. Default 8 (spec open-q #4). */
  tighterWindow?: number;
}

const DEFAULT_RESERVED_WINDOW = 32;
const DEFAULT_TIGHTER_WINDOW = 8;

/** A bounded FIFO insertion-order set: when it exceeds `cap`, the oldest entry is evicted. Deterministic
 *  (Map preserves insertion order). Used as the Msg1-fingerprint anti-replay seen-set. */
class BoundedSeenSet {
  private readonly m = new Map<string, true>();
  constructor(private readonly cap: number) {}
  /** Returns true if `fp` was already present (a replay); otherwise records it and returns false. */
  hasOrAdd(fp: string): boolean {
    if (this.m.has(fp)) return true;
    this.m.set(fp, true);
    while (this.m.size > this.cap) {
      const oldest = this.m.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.m.delete(oldest);
    }
    return false;
  }
  get size(): number { return this.m.size; }
}

/** A windowed count: admits up to `limit` per logical window; resets when the injected tick changes. */
class WindowedCounter {
  private windowTick = Number.NaN; // distinct from any real tick so the first admit opens a fresh window
  private count = 0;
  constructor(private readonly limit: number) {}
  tryAdmit(tick: number): boolean {
    if (tick !== this.windowTick) {
      this.windowTick = tick;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count++;
    return true;
  }
}

export interface AdmitInput {
  /** True if R RECOGNIZES this prekey_id (it is in R's per-contact issuance index). */
  recognized: boolean;
  /** A bounded fingerprint of the Msg1 (e.g. sha256 of the mac_R input) for dedup / anti-replay. */
  fp: string;
}

export class ReconnectRateLimiter {
  readonly reservedWindow: number;
  readonly tighterWindow: number;
  /** Seen-set capacity — sized >= reservedWindow so eviction can't out-pace the reserved bucket. */
  private readonly seen: BoundedSeenSet;
  private readonly seenCap: number;
  private readonly reserved: WindowedCounter;
  private readonly tighter: WindowedCounter;
  private readonly now: () => number;

  constructor(opts: ReconnectRateLimiterOpts) {
    if (typeof opts.now !== 'function') {
      throw new Error('ReconnectRateLimiter requires an injected now() (logical tick) — no internal clock');
    }
    this.now = opts.now;
    this.reservedWindow = opts.reservedWindow ?? DEFAULT_RESERVED_WINDOW;
    this.tighterWindow = opts.tighterWindow ?? DEFAULT_TIGHTER_WINDOW;
    // Seen-set >= reserved window. A small headroom factor keeps an id that JUST aged out of the count
    // still recognizable as a replay for a short tail, without unbounded growth.
    this.seenCap = this.reservedWindow * 2;
    this.seen = new BoundedSeenSet(this.seenCap);
    this.reserved = new WindowedCounter(this.reservedWindow);
    this.tighter = new WindowedCounter(this.tighterWindow);
  }

  /** Readable for the invariant test: the seen-set capacity. */
  get seenSetSize(): number { return this.seenCap; }

  admit(input: AdmitInput): { allowed: boolean } {
    const tick = this.now();
    if (input.recognized) {
      // Anti-replay / dedup FIRST: a repeated Msg1 fingerprint must not re-spend reserved capacity.
      if (this.seen.hasOrAdd(input.fp)) return { allowed: false };
      return { allowed: this.reserved.tryAdmit(tick) };
    }
    // Unrecognized ids never touch the reserved bucket or the seen-set — they get the tighter budget.
    return { allowed: this.tighter.tryAdmit(tick) };
  }
}

/** A no-op limiter: admits everything. The default when a responder is constructed without a limiter
 *  (existing tests + first_contact must be unaffected; first_contact is never rate-limited anyway). */
export const ALLOW_ALL_RECONNECT_LIMITER: { admit(input: AdmitInput): { allowed: boolean } } = {
  admit() { return { allowed: true }; }
};
