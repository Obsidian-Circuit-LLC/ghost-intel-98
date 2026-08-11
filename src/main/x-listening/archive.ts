/**
 * X Listening Station — historical archive cycles (Enterprise port, Task 8).
 *
 * A bounded, cancellable, low-rate archive loop that repeatedly runs the Task 4
 * `captureTimeline` (capture.ts) pipeline and advances a resumable `XArchiveState`,
 * adapted from the Enterprise `runArchiveCycle`/`restartArchiveTimer` cadence
 * (`electron/main.cjs:1961-2069`) but rebuilt onto this port's hardened seams:
 *
 *  - Drives `captureTimeline` (capture.ts, Task 4) — NOT the retiring `ipc.ts`
 *    `captureVisibleTimeline` (Plan A / X7, clearnet-only, removed at Task 16) — so an
 *    archived record is a full evidence-hashed `XPostArtifact` (metrics + metricsRaw kept,
 *    kind, parentPostId), same honesty guarantees as a manual capture.
 *  - GATED on `AppSettings.xListening.archiveCycles` (fail-closed OFF on a settings-read
 *    error, same posture as the collect-gate) — an opted-out operator gets nothing,
 *    silently, never a partial run.
 *  - DETERMINISTIC: the clock (`now`) and inter-cycle spacing (`sleep`) are both
 *    injectable; nothing here reads `Date.now()`.
 *  - The challenge/lock gate inside `captureTimeline` still fronts every step: a
 *    blocked/signed-out page STOPS the step (and the loop) and does NOT advance
 *    `archiveState` — an incomplete cycle must never look like a completed one.
 *  - CANCELLABLE — a `shouldCancel()` seam halts the loop between steps.
 *  - RATE-BOUNDED — `maxCycles` clamps to [0,1000], `delayMs` clamps to >= 0; a low-rate
 *    sleep sits BETWEEN steps, never after the last (gentle on X, mirrors the Enterprise
 *    4-hour default cadence when driven by a caller's own scheduler).
 *
 * Quarantine-clean at module load: no static `electron` import — `win` is typed
 * structurally via the ambient `Electron.BrowserWindow`; the store/settings wiring are lazy
 * dynamic imports (`defaultDeps()`), mirroring `capture.ts`'s own convention.
 */
import { captureTimeline, type XCaptureDeps, type XTimelineCaptureResult } from './capture';
import type { XArchiveState, XPostArtifact } from './store';
import type { XCollectSettings } from './extract';

/** A resumable archive state with no prior run — the pre-first-step baseline. */
export const EMPTY_ARCHIVE_STATE: XArchiveState = {
  cursor: null,
  cycles: 0,
  lastRunAt: null,
};

/** One archive step observes the same profile timeline a manual capture does. */
export interface ArchiveStepRequest {
  caseId: string;
  jobId: string;
  channelId: string;
  channelLabel: string;
  /** The target's own handle — passed through to `captureTimeline`'s collect gate. */
  targetUsername: string;
  /** Which surrounding-thread kinds to include; sourced MAIN-side, defaults all-off. */
  collect?: XCollectSettings;
}

/** The outcome of one archive step. `ran` is true only for a completed capture. */
export interface ArchiveStepResult {
  /** True iff a capture actually executed AND completed (toggle on, not blocked). */
  ran: boolean;
  /** True iff the challenge/lock gate stopped the step. */
  blocked: boolean;
  reason?: string;
  added: number;
  skipped: number;
  posts: XPostArtifact[];
  /** The archive state AFTER this step — advanced on a completed run, else unchanged. */
  state: XArchiveState;
}

/** Injectable seams so a step is testable without electron/network/secure-fs. */
export interface ArchiveStepDeps {
  /** Read `AppSettings.xListening.archiveCycles` MAIN-side (trusted). */
  isEnabled: () => Promise<boolean>;
  /** Run one timeline capture (persists posts itself); defaults to `captureTimeline`. */
  capture: (
    win: Electron.BrowserWindow,
    req: {
      caseId: string;
      jobId: string;
      channelId: string;
      channelLabel: string;
      targetUsername: string;
      collect?: XCollectSettings;
    },
    overrides?: Partial<XCaptureDeps>,
  ) => Promise<XTimelineCaptureResult>;
  /** Read the case's resumable archive state (null before the first step). */
  readState: (caseId: string) => Promise<XArchiveState | null>;
  /** Persist the advanced archive state. */
  writeState: (caseId: string, state: XArchiveState) => Promise<void>;
  /** Injected clock — the ISO `lastRunAt` stamped when a step completes (determinism). */
  now: () => string;
}

/**
 * Read the archive-cycles toggle MAIN-side. Lazy dynamic import so this module never pulls
 * the settings graph at import time. Falls back to OFF on any read error — the archive
 * never silently RUNS on a settings failure (fail-closed, matching the collect-gate
 * posture in `capture.ts`/`ipc.ts`).
 */
async function loadArchiveEnabled(): Promise<boolean> {
  try {
    const { settingsStore } = await import('../storage/json-fs');
    const settings = await settingsStore.read();
    return settings.xListening?.archiveCycles === true;
  } catch {
    return false;
  }
}

function defaultDeps(): ArchiveStepDeps {
  return {
    isEnabled: loadArchiveEnabled,
    capture: (win, req, overrides) => captureTimeline(win, req, overrides),
    readState: async (caseId) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.archiveState.read(caseId);
    },
    writeState: async (caseId, state) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      return store.archiveState.write(caseId, state);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Advance the opaque resume cursor. The last captured post's `messageId` is an honest
 * "where we left off" marker; a step that captured nothing HOLDS the prior cursor rather
 * than inventing a new one.
 */
function advanceCursor(prev: string | null, posts: readonly XPostArtifact[]): string | null {
  const last = posts.length ? String(posts[posts.length - 1].messageId ?? '') : '';
  return last || prev;
}

/**
 * Run ONE low-rate archive step. Gated on the `archiveCycles` toggle — when off, NO
 * capture runs and archive state is left untouched (`ran:false`). Otherwise the Task 4
 * `captureTimeline` runs (challenge/lock gate + dual encrypted persistence inside
 * `captureTimeline` itself); on a completed run the resumable `XArchiveState` advances
 * (cycle count + injected clock + cursor) and is persisted. A step the challenge/lock gate
 * BLOCKS does NOT advance state — an incomplete step must never look like a completed one.
 * Adapted from Enterprise `runArchiveCycle` (`electron/main.cjs:1961-2056`), reduced to the
 * single-profile visible-capture path (Enterprise's multi-operation follower/following
 * round-robin is out of scope here — Task 7's network capture is a separate, manually
 * triggered path, not folded into this resumable timeline cursor).
 */
export async function runArchiveStep(
  win: Electron.BrowserWindow,
  req: ArchiveStepRequest,
  overrides: Partial<ArchiveStepDeps> = {},
): Promise<ArchiveStepResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const prev = (await deps.readState(req.caseId)) ?? EMPTY_ARCHIVE_STATE;

  if (!(await deps.isEnabled())) {
    return { ran: false, blocked: false, added: 0, skipped: 0, posts: [], state: prev };
  }

  const captured = await deps.capture(win, {
    caseId: req.caseId,
    jobId: req.jobId,
    channelId: req.channelId,
    channelLabel: req.channelLabel,
    targetUsername: req.targetUsername,
    collect: req.collect,
  });

  if (captured.blocked) {
    return {
      ran: false,
      blocked: true,
      reason: captured.reason,
      added: 0,
      skipped: 0,
      posts: [],
      state: prev,
    };
  }

  const next: XArchiveState = {
    cursor: advanceCursor(prev.cursor, captured.posts),
    cycles: prev.cycles + 1,
    lastRunAt: deps.now(),
  };
  await deps.writeState(req.caseId, next);
  return {
    ran: true,
    blocked: false,
    added: captured.added,
    skipped: captured.skipped,
    posts: captured.posts,
    state: next,
  };
}

/** Bound + cancellation + low-rate spacing for a run of archive steps. */
export interface ArchiveLoopOptions {
  /** Hard upper bound on steps this run — clamped to [0, 1000] (rate-bounded). */
  maxCycles: number;
  /** Low-rate spacing between steps, in ms — clamped to >= 0. Applied via the injected/real
   *  `sleep`. */
  delayMs?: number;
  /** Cooperative cancellation — checked before each step and before each sleep. */
  shouldCancel?: () => boolean;
  /** Injected sleep (determinism/testing); defaults to a real `setTimeout` delay. */
  sleep?: (ms: number) => Promise<void>;
}

/** The aggregate outcome of a bounded archive run. */
export interface ArchiveLoopResult {
  /** How many steps actually completed. */
  cyclesRun: number;
  /** Total posts added across the run. */
  totalAdded: number;
  /** True iff a step was challenge/lock-blocked (which stops the loop). */
  blocked: boolean;
  reason?: string;
  /** True iff `shouldCancel` halted the loop early. */
  cancelled: boolean;
  /** Every completed step's captured posts, in run order — so a caller can surface a
   *  multi-cycle RUN exactly like a single RUN ONE STEP. A step that did not complete
   *  (toggle off / blocked) contributes nothing. */
  posts: XPostArtifact[];
  /** The latest archive state observed (advanced by the last completed step). */
  state: XArchiveState;
}

/** 4h — matches the Enterprise default incremental-archive cadence. */
const DEFAULT_ARCHIVE_DELAY_MS = 4 * 60 * 60 * 1000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Run a BOUNDED, CANCELLABLE, low-rate sequence of archive steps. Each step goes through
 * `runArchiveStep` (so the toggle gate, challenge/lock refusal, and state advance all
 * hold); the loop stops early the instant a step does not complete — toggle turned off, or
 * the challenge/lock gate blocked it — and on cooperative cancellation. A low-rate `sleep`
 * sits BETWEEN steps (never after the last), so a long archive run stays gentle on X.
 * Scheduling is deterministic: `sleep` and the per-step clock are injectable, nothing here
 * reads `Date.now()`. Both bounds are clamped defensively (`maxCycles` to [0,1000],
 * `delayMs` to >= 0) so a malformed/oversized caller-supplied value can never produce a
 * negative, NaN, or effectively-unbounded loop. Adapted from the Enterprise
 * `restartArchiveTimer` cadence (`electron/main.cjs:2058-2069`), recast as an explicit
 * bounded loop rather than a free-running `setInterval`.
 */
export async function runArchiveSteps(
  win: Electron.BrowserWindow,
  req: ArchiveStepRequest,
  options: ArchiveLoopOptions,
  overrides: Partial<ArchiveStepDeps> = {},
): Promise<ArchiveLoopResult> {
  const maxCycles = Math.max(0, Math.min(1000, Math.floor(Number(options.maxCycles) || 0)));
  const delayMs = Math.max(0, Number(options.delayMs ?? DEFAULT_ARCHIVE_DELAY_MS) || 0);
  const sleep = options.sleep ?? realSleep;
  const shouldCancel = options.shouldCancel ?? (() => false);

  let cyclesRun = 0;
  let totalAdded = 0;
  const posts: XPostArtifact[] = [];
  let state: XArchiveState =
    (await (overrides.readState ?? defaultDeps().readState)(req.caseId)) ?? EMPTY_ARCHIVE_STATE;

  for (let i = 0; i < maxCycles; i++) {
    if (shouldCancel()) {
      return { cyclesRun, totalAdded, blocked: false, cancelled: true, posts, state };
    }
    const res = await runArchiveStep(win, req, overrides);
    state = res.state;
    if (!res.ran) {
      // Toggle off or challenge/lock-blocked: an incomplete step stops the run.
      return { cyclesRun, totalAdded, blocked: res.blocked, reason: res.reason, cancelled: false, posts, state };
    }
    cyclesRun++;
    totalAdded += res.added;
    // Carry this completed step's captured posts out so a caller can surface them live.
    if (res.posts.length) posts.push(...res.posts);
    if (i < maxCycles - 1) {
      if (shouldCancel()) {
        return { cyclesRun, totalAdded, blocked: false, cancelled: true, posts, state };
      }
      await sleep(delayMs);
    }
  }
  return { cyclesRun, totalAdded, blocked: false, cancelled: false, posts, state };
}
