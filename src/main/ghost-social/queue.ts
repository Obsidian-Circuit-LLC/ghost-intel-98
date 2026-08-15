/**
 * Ghost Social Media Manager (hardened GI98 port) — job queue + the v2.5 scheduled-queue tick
 * (Phase 3, G7). SAFETY-CRITICAL (the scheduler is what would auto-post).
 *
 * Two ports:
 *   1. `JobQueue` — his `electron/core/JobQueue.ts`: a small in-memory runner that tracks a unit of
 *      work through queued → running → complete/failed, surfaced to the History/Jobs view. Ported
 *      with an injected clock + id generator (production wires `Date.now`/`crypto.randomUUID`) so
 *      the snapshots are deterministic in a test (determinism-auditor).
 *   2. `makeScheduler` — his `processDueScheduledPosts` + `executeScheduledPost` (electron/main.ts):
 *      the v2.5 background tick that finds the earliest DUE job and fans it out to its destinations
 *      via `autoPublish`, aggregating per-destination results into the job's final status and a
 *      History entry.
 *
 * THE ARM GATE (G7, constraint 3) is NOT re-implemented here — it lives authoritatively in
 * `publishing.autoPublish` (MAIN), so `runNow` (explicit) always routes a disarmed run through it
 * and gets a `blocked_disarmed` result, which this scheduler interprets as "still waiting" (the job
 * reverts to `scheduled`, nothing is published, no History entry). `processDue` additionally reads
 * the arm flag to SHORT-CIRCUIT the background tick while disarmed — a defense-in-depth optimisation
 * that avoids churning state every interval; it does NOT replace autoPublish's gate. Deterministic:
 * `now`/`uuid` are injected; the only source of truth for "due" is the injected clock.
 */

import type {
  AccountLike,
  GhostState,
  GhostJob,
  PublishRequest,
  PublishResult,
  ScheduledDestinationResult,
  ScheduledPost,
} from '@shared/ghost-social/types';

// ---- JobQueue (his in-memory runner) -----------------------------------

export interface JobQueueClock {
  now(): number;
  uuid(): string;
}

const REAL_CLOCK: JobQueueClock = {
  now: () => Date.now(),
  uuid: () => {
    // Lazy so importing this module never touches node:crypto at load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return (require('node:crypto') as typeof import('node:crypto')).randomUUID();
  },
};

export class JobQueue {
  private jobs: GhostJob[] = [];
  private clock: JobQueueClock;

  constructor(clock: JobQueueClock = REAL_CLOCK) {
    this.clock = clock;
  }

  list(): GhostJob[] {
    return [...this.jobs].slice(0, 100);
  }

  async run<T>(
    type: GhostJob['type'],
    meta: { accountId?: string; platform?: GhostJob['platform'] },
    work: () => Promise<T>,
  ): Promise<{ job: GhostJob; result: T }> {
    const job: GhostJob = {
      id: this.clock.uuid(),
      type,
      accountId: meta.accountId,
      platform: meta.platform,
      status: 'queued',
      createdAt: new Date(this.clock.now()).toISOString(),
    };
    this.jobs.unshift(job);
    job.status = 'running';
    try {
      const result = await work();
      job.status = 'complete';
      job.finishedAt = new Date(this.clock.now()).toISOString();
      return { job: { ...job }, result };
    } catch (e) {
      job.status = 'failed';
      job.error = (e as { message?: string })?.message || String(e);
      job.finishedAt = new Date(this.clock.now()).toISOString();
      throw e;
    }
  }
}

// ---- scheduler (his v2.5 due-tick) -------------------------------------

export interface SchedulerDeps {
  /** Read the whole encrypted module state (his `readStateInternal`). */
  getState(): Promise<GhostState>;
  /** Persist the whole module state (his `writeStateInternal`, now encrypt-at-rest). */
  saveState(state: GhostState): Promise<GhostState>;
  /** Fan one post out to one destination — his `core.autoPublish`. The MAIN arm gate lives INSIDE
   *  this (publishing.autoPublish): a disarmed call returns `blocked_disarmed` and clicks nothing. */
  autoPublish(campaignId: string, account: AccountLike, post: PublishRequest): Promise<PublishResult>;
  /** SAFETY (G7): the auto-post ARM flag — read by `processDue` to skip the background tick while
   *  disarmed (churn-avoidance; NOT the authoritative gate, which is inside `autoPublish`). */
  isArmed(): Promise<boolean>;
  /** Injected clock (ms) — the ONLY source of "now" for due comparison + timestamps. */
  now(): number;
  /** Injected id generator for the History entry (his `crypto.randomUUID`). */
  uuid(): string;
  /** Optional renderer push after a state change (his `notifyStateChanged`). */
  notifyStateChanged?(): void;
}

export interface TickResult {
  /** True iff a due job was actually executed (prepared+published attempt made). */
  ran: boolean;
  /** True iff the tick short-circuited (or the run reverted) because auto-posting is DISARMED. */
  disarmed?: boolean;
  /** The job id that was considered, if any. */
  jobId?: string;
}

export interface Scheduler {
  /** His `processDueScheduledPosts` — run the earliest DUE job. Disarmed ⇒ no-op (job stays ready). */
  processDue(): Promise<TickResult>;
  /** His `executeScheduledPost` — run one specific job now, through the MAIN arm gate. */
  runNow(postId: string): Promise<TickResult>;
}

function mapDestinationStatus(r: PublishResult): ScheduledDestinationResult['status'] {
  if (r.status === 'published') return 'published';
  if (r.status === 'unsupported') return 'unsupported';
  // `blocked_disarmed` is NOT a failure — it is "waiting to arm". Surface it as `pending`.
  if (r.status === 'blocked_disarmed') return 'pending';
  return 'failed';
}

export function makeScheduler(deps: SchedulerDeps): Scheduler {
  // His `schedulerBusy` — a single run at a time so overlapping ticks can't double-publish a job.
  let busy = false;
  const iso = (): string => new Date(deps.now()).toISOString();

  async function runNow(postId: string): Promise<TickResult> {
    if (busy) return { ran: false, jobId: postId };
    busy = true;
    try {
      let state = await deps.getState();
      const idx = (state.scheduledPosts || []).findIndex((p) => p.id === postId);
      if (idx < 0) return { ran: false, jobId: postId };
      let post = state.scheduledPosts![idx];
      if (post.status === 'running' || post.status === 'complete') return { ran: false, jobId: postId };

      const campaign = (state.campaigns || []).find((c) => c.id === post.campaignId);
      if (!campaign) {
        post = {
          ...post,
          status: 'failed',
          updatedAt: iso(),
          lastRunAt: iso(),
          results: { _campaign: { status: 'failed', message: 'Campaign no longer exists.', at: iso() } },
        };
        state.scheduledPosts![idx] = post;
        await deps.saveState(state);
        deps.notifyStateChanged?.();
        return { ran: false, jobId: postId };
      }

      const started = iso();
      post = { ...post, status: 'running', updatedAt: started, lastRunAt: started, results: {} };
      state.scheduledPosts![idx] = post;
      await deps.saveState(state);
      deps.notifyStateChanged?.();

      const results: Record<string, ScheduledDestinationResult> = {};
      let published = 0;
      let disarmed = 0;
      let attempted = 0;
      for (const accountId of post.destinationAccountIds || []) {
        const account = (campaign.accounts || []).find((a) => a.id === accountId);
        if (!account) {
          results[accountId] = { status: 'failed', message: 'Account no longer exists.', at: iso() };
          continue;
        }
        if (!account.enabled) {
          results[accountId] = { status: 'failed', message: 'Account is disabled.', at: iso() };
          continue;
        }
        attempted++;
        try {
          const r = await deps.autoPublish(campaign.id, account, { text: post.text });
          const st = mapDestinationStatus(r);
          results[accountId] = { status: st, message: r.message, at: iso() };
          if (st === 'published') published++;
          else if (r.status === 'blocked_disarmed') disarmed++;
        } catch (e) {
          results[accountId] = {
            status: 'failed',
            message: (e as { message?: string })?.message || String(e),
            at: iso(),
          };
        }
      }

      // Re-read to merge against any concurrent renderer edit (his double-read).
      state = await deps.getState();
      const current = (state.scheduledPosts || []).findIndex((p) => p.id === postId);

      // Disarmed run: nothing was published because auto-posting is OFF (the MAIN gate refused every
      // click). Do NOT mark the job failed — revert it to `scheduled` so it re-surfaces as ready
      // once armed, and write NO History entry (nothing actually went out).
      if (published === 0 && disarmed > 0) {
        if (current >= 0) {
          state.scheduledPosts![current] = {
            ...state.scheduledPosts![current],
            status: 'scheduled',
            results,
            updatedAt: iso(),
            lastRunAt: started,
          };
          await deps.saveState(state);
          deps.notifyStateChanged?.();
        }
        return { ran: false, disarmed: true, jobId: postId };
      }

      const vals = Object.values(results);
      const failed = vals.length - published;
      const finalStatus: ScheduledPost['status'] =
        failed === 0 && published > 0 ? 'complete' : published > 0 ? 'partial' : 'failed';
      if (current >= 0) {
        state.scheduledPosts![current] = {
          ...state.scheduledPosts![current],
          status: finalStatus,
          results,
          updatedAt: iso(),
        };
      }
      state.postHistory = [
        {
          id: deps.uuid(),
          at: iso(),
          text: post.text,
          destinations: (post.destinationAccountIds || []).map(
            (id) => campaign.accounts.find((a) => a.id === id)?.name || id,
          ),
          status: finalStatus === 'complete' ? 'complete' : finalStatus === 'partial' ? 'partial' : 'failed',
        },
        ...(state.postHistory || []),
      ];
      await deps.saveState(state);
      deps.notifyStateChanged?.();
      return { ran: attempted > 0, disarmed: disarmed > 0, jobId: postId };
    } finally {
      busy = false;
    }
  }

  async function processDue(): Promise<TickResult> {
    if (busy) return { ran: false };
    const state = await deps.getState();
    const now = deps.now();
    const due = (state.scheduledPosts || [])
      .filter((p) => p.status === 'scheduled' && new Date(p.scheduledFor).getTime() <= now)
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    if (!due[0]) return { ran: false };
    // Background tick short-circuits while disarmed: leave the due job as `scheduled` (the UI shows
    // it as "ready — arm auto-posting or publish manually") instead of churning running↔scheduled
    // every interval. The authoritative refusal still lives in autoPublish for the explicit path.
    if (!(await deps.isArmed())) return { ran: false, disarmed: true, jobId: due[0].id };
    return runNow(due[0].id);
  }

  return { processDue, runNow };
}
