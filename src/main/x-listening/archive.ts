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
import { normalizeXSourceKey } from '@shared/x-listening-source';
import {
  collectGateFromSettings,
  type XCollectionSettings,
} from '@shared/x-listening-collection-settings';
import { captureTimeline, type XCaptureDeps, type XTimelineCaptureResult } from './capture';
import type { XArchiveProfileProgress, XArchiveState, XPostArtifact, XRunOperation } from './store';
import type { XCollectSettings } from './extract';

/** A resumable archive state with no prior run — the pre-first-step baseline. */
export const EMPTY_ARCHIVE_STATE: XArchiveState = {
  cursor: null,
  cycles: 0,
  lastRunAt: null,
  nextOperationIndex: 0,
  profiles: {},
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
      operation?: XRunOperation;
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
    // Stamp the run-log record (Task A3) as an incremental-archive cycle, not a manual capture —
    // `captureTimeline` reads this and emits an `archive_posts` run record.
    operation: 'archive_posts',
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

// ---------------------------------------------------------------------------------------------
// FA4 — incremental-archive DEPTH ROTATION (audit HIGH #2 + #5, + archive-rotation medium)
//
// The cursor-based `runArchiveStep` above re-runs a plain `captureTimeline` at the campaign's fixed
// `profileScrollPasses` — it never digs deeper, and it only ever archives POSTS. Enterprise's
// `runArchiveCycle` (`main.cjs:1961-2056`) instead grows depth per cycle and round-robins across
// three operation kinds per source:
//   - it builds `[{posts}, {follower}?, {following}?]` per enabled profile (`buildArchiveOperations`,
//     `main.cjs:1951-1959`) — follower/following only when `archiveFollowers`/`archiveFollowing` on;
//   - each tick runs exactly ONE operation (round-robin `nextOperationIndex`, `main.cjs:1966-1968,2041`)
//     so per-tick load stays light;
//   - that operation's per-profile pass depth steps up one increment (`postPasses + archivePostStep`
//     for posts, `relationshipPasses + archiveRelationshipStep` for follower/following), clamped to a
//     ceiling (`archivePostMaxPasses` / `archiveRelationshipMaxPasses`), and the stepped depth drives
//     the scrape (`main.cjs:1976-2038`).
//
// This rebuilds that on the hardened seams: posts go through the Tor-gated `captureProfileTimeline`
// (FA1's `req.passes` carries the stepped depth), follower/following through the self-contained
// Tor-gated `captureNetwork` — both resolve `resolveXTorGate` themselves and fail closed. The
// per-profile counters + the round-robin pointer persist inside `XArchiveState` (secure-fs), keyed by
// the normalized source handle. Depth/enable knobs are read from the per-campaign COLLECTION SETTINGS
// (already persisted + clamped). Deterministic: no `Date.now()` — the clock is injected; a blocked op
// advances NEITHER the pointer NOR the depth (an incomplete op must never look completed, matching
// His `nextOperationIndex` sitting after the scrape in the try, never reached on a throw).

/** One archive operation kind for a source. */
export type XArchiveOperationType = 'posts' | 'follower' | 'following';

/** A monitored source the rotation can archive (derived from captured posts — GI98 has no first-class
 *  profile record; the same shape the scheduler's `listSources` produces). */
export interface XArchiveRotationSource {
  channelId: string;
  channelLabel: string;
  targetUsername: string;
}

/** One resolved archive operation: which source, which kind. */
export interface XArchiveOperation {
  source: XArchiveRotationSource;
  type: XArchiveOperationType;
}

/** The context for one rotation tick — the campaign, its monitored sources, and its (already
 *  clamped) per-campaign collection settings supplying the depth/enable knobs. */
export interface ArchiveRotationRequest {
  caseId: string;
  jobId: string;
  sources: readonly XArchiveRotationSource[];
  settings: XCollectionSettings;
}

/** The subset of a capture result the rotation reads. `posts` carries the timeline posts of a
 *  completed `posts` op so a caller can surface them live; a follower/following op yields `[]`. */
export interface ArchiveOpOutcome {
  blocked: boolean;
  reason?: string;
  added: number;
  posts: XPostArtifact[];
}

/** Injectable seams so one rotation tick is testable without electron/network/secure-fs. */
export interface XArchiveRotationDeps {
  /** Read the case's resumable archive state (null before the first tick). */
  readState: (caseId: string) => Promise<XArchiveState | null>;
  /** Persist the advanced archive state. */
  writeState: (caseId: string, state: XArchiveState) => Promise<void>;
  /** Run ONE post-timeline archive op through the Tor-gated primitive at `passes` depth. */
  capturePosts: (
    source: XArchiveRotationSource,
    passes: number,
    req: ArchiveRotationRequest,
  ) => Promise<ArchiveOpOutcome>;
  /** Run ONE follower/following archive op through the Tor-gated primitive at `passes` depth. */
  captureRelationship: (
    source: XArchiveRotationSource,
    kind: 'follower' | 'following',
    passes: number,
    req: ArchiveRotationRequest,
  ) => Promise<ArchiveOpOutcome>;
  /** Injected clock — the ISO `lastRunAt`/`last*RunAt` stamped when an op completes (determinism). */
  now: () => string;
}

/** The outcome of one rotation tick. `ran` is true only for a completed (non-blocked) operation. */
export interface XArchiveRotationResult {
  /** True iff exactly one operation actually executed AND completed. */
  ran: boolean;
  /** True iff the Tor/challenge gate stopped the operation (pointer + depth held). */
  blocked: boolean;
  reason?: string;
  /** The operation this tick selected (null iff there were no sources/operations). */
  operation: XArchiveOperation | null;
  /** The stepped pass depth the operation was driven at (0 when nothing ran). */
  requestedPasses: number;
  added: number;
  /** A completed `posts` op's captured posts (empty for a follower/following op). */
  posts: XPostArtifact[];
  /** The archive state AFTER this tick — pointer + depth advanced on a completed op, else unchanged. */
  state: XArchiveState;
}

/** Seed a fresh per-source progress from the campaign's base pass budgets (Enterprise
 *  `getArchiveProfileProgress` seeds each `*Passes` from `scrollPasses`/`relationshipScrollPasses`,
 *  `main.cjs:1936-1938`). */
export function emptyProfileProgress(settings: XCollectionSettings): XArchiveProfileProgress {
  return {
    postPasses: settings.profileScrollPasses,
    followerPasses: settings.followerBasePasses,
    followingPasses: settings.followingBasePasses,
    lastPostRunAt: null,
    lastFollowerRunAt: null,
    lastFollowingRunAt: null,
  };
}

/** Step the post-pass depth one increment toward the ceiling (Enterprise `requestedPasses = min(max,
 *  max(scrollPasses, postPasses + step))`, `main.cjs:1976-1981`). Never below the base budget, never
 *  above `maxPostDepth`. All inputs are already clamped by collection-settings; re-derived here purely. */
export function stepPostDepth(prev: number, settings: XCollectionSettings): number {
  const step = settings.postDepthPerCycle;
  const maximum = Math.max(settings.profileScrollPasses, Math.min(120, settings.maxPostDepth));
  const grown = Math.max(settings.profileScrollPasses, Math.floor(Number(prev) || 0) + step);
  return Math.min(maximum, grown);
}

/** Step the follower/following pass depth one increment toward the ceiling (Enterprise
 *  `requestedPasses = min(max, max(relationshipScrollPasses, passes + step))`, `main.cjs:2004-2010`).
 *  Never below the direction's base budget, never above `maxNetworkDepth`. */
export function stepNetworkDepth(
  prev: number,
  settings: XCollectionSettings,
  kind: 'follower' | 'following',
): number {
  const base = kind === 'follower' ? settings.followerBasePasses : settings.followingBasePasses;
  const step = settings.networkDepthPerCycle;
  const maximum = Math.max(base, Math.min(240, settings.maxNetworkDepth));
  const grown = Math.max(base, Math.floor(Number(prev) || 0) + step);
  return Math.min(maximum, grown);
}

/**
 * Build the round-robin operation list for a campaign (Enterprise `buildArchiveOperations`,
 * `main.cjs:1951-1959`): every source contributes a `posts` op, plus a `follower` op iff
 * `archiveFollowers` is on and a `following` op iff `archiveFollowing` is on. Order is source-major
 * (posts, follower, following per source) so the persisted `nextOperationIndex` addresses a stable
 * sequence. Pure — no clock, no I/O.
 */
export function buildArchiveOperations(
  sources: readonly XArchiveRotationSource[],
  settings: Pick<XCollectionSettings, 'archiveFollowers' | 'archiveFollowing'>,
): XArchiveOperation[] {
  const operations: XArchiveOperation[] = [];
  for (const source of sources) {
    operations.push({ source, type: 'posts' });
    if (settings.archiveFollowers) operations.push({ source, type: 'follower' });
    if (settings.archiveFollowing) operations.push({ source, type: 'following' });
  }
  return operations;
}

/** Heal a persisted/legacy `XArchiveState` into a fully-populated one: a state written before FA4
 *  carries no `profiles`/`nextOperationIndex`, so default them (empty map / 0) and clamp the pointer
 *  to a non-negative integer. Never throws. */
function normalizeArchiveState(state: XArchiveState | null): Required<XArchiveState> {
  const base = state ?? EMPTY_ARCHIVE_STATE;
  const rawIndex = Math.floor(Number(base.nextOperationIndex));
  return {
    cursor: base.cursor ?? null,
    cycles: Math.max(0, Math.floor(Number(base.cycles) || 0)),
    lastRunAt: base.lastRunAt ?? null,
    nextOperationIndex: Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : 0,
    profiles: base.profiles && typeof base.profiles === 'object' ? { ...base.profiles } : {},
  };
}

/** The normalized round-robin key for a source (lower-cased bare handle) — the same key
 *  `scheduler.listSources` derives, so a source's depth counters are stable across ticks. */
function rotationSourceKey(source: XArchiveRotationSource): string {
  return normalizeXSourceKey(source.targetUsername) || normalizeXSourceKey(source.channelId);
}

/** Resolve one source's EFFECTIVE image policy (F1), fail-safe TRUE — a read hiccup never STOPS
 *  media collection (the fetch is host-anchored + Tor-gated regardless). Mirrors the scheduler. */
async function resolveRotationImages(
  caseId: string,
  targetUsername: string,
  settings: XCollectionSettings,
): Promise<boolean> {
  try {
    const { resolveEffectiveImageCollection } = await import('./image-policy');
    return await resolveEffectiveImageCollection(caseId, targetUsername, {
      loadRetrieveImages: async () => settings.retrieveImages,
    });
  } catch {
    return true;
  }
}

function defaultRotationDeps(): XArchiveRotationDeps {
  return {
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
    capturePosts: async (source, passes, req) => {
      const { captureProfileTimeline } = await import('./capture');
      const collect = collectGateFromSettings(req.settings);
      const imagesEnabled = await resolveRotationImages(req.caseId, source.targetUsername, req.settings);
      const res = await captureProfileTimeline({
        caseId: req.caseId,
        channelId: source.channelId,
        channelLabel: source.channelLabel,
        targetUsername: source.targetUsername,
        collect,
        imagesEnabled,
        // FA4: drive FA1's scroll-and-accumulate loop at the source's stepped archive depth.
        passes,
      });
      return { blocked: res.blocked, reason: res.reason, added: res.added, posts: res.posts };
    },
    captureRelationship: async (source, kind, passes, req) => {
      const { captureNetwork } = await import('./capture');
      const res = await captureNetwork({
        caseId: req.caseId,
        channelId: source.channelId,
        targetUsername: source.targetUsername,
        kind: kind === 'follower' ? 'followers' : 'following',
        passes,
      });
      return { blocked: res.blocked, reason: res.reason, added: res.added, posts: [] };
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Run ONE incremental-archive operation this tick (Enterprise `runArchiveCycle`, `main.cjs:1961-2056`,
 * rebuilt on the hardened seams). Builds the round-robin operation list from the campaign's sources +
 * enable toggles, selects the operation at the persisted `nextOperationIndex`, steps that source's
 * pass depth one increment toward its ceiling, and drives the matching Tor-gated capture at that depth
 * (posts → `captureProfileTimeline` with FA1's `passes`; follower/following → `captureNetwork`). On a
 * completed op the per-source depth counter + `nextOperationIndex` + cycle count advance and persist;
 * a Tor/challenge-blocked op advances NOTHING (an incomplete op must never look completed) and stops
 * the tick. With no sources/operations the tick is a no-op (`ran:false`).
 */
export async function runArchiveRotation(
  req: ArchiveRotationRequest,
  overrides: Partial<XArchiveRotationDeps> = {},
): Promise<XArchiveRotationResult> {
  const deps = { ...defaultRotationDeps(), ...overrides };
  const prev = normalizeArchiveState(await deps.readState(req.caseId));

  const operations = buildArchiveOperations(req.sources, req.settings);
  if (!operations.length) {
    return { ran: false, blocked: false, operation: null, requestedPasses: 0, added: 0, posts: [], state: prev };
  }

  const index = prev.nextOperationIndex % operations.length;
  const operation = operations[index];
  const key = rotationSourceKey(operation.source);
  const progress = prev.profiles[key] ?? emptyProfileProgress(req.settings);

  let requestedPasses: number;
  let outcome: ArchiveOpOutcome;
  if (operation.type === 'posts') {
    requestedPasses = stepPostDepth(progress.postPasses, req.settings);
    outcome = await deps.capturePosts(operation.source, requestedPasses, req);
  } else {
    const prior = operation.type === 'follower' ? progress.followerPasses : progress.followingPasses;
    requestedPasses = stepNetworkDepth(prior, req.settings, operation.type);
    outcome = await deps.captureRelationship(operation.source, operation.type, requestedPasses, req);
  }

  if (outcome.blocked) {
    // Fail closed: hold the pointer AND the depth — an incomplete op must not look completed.
    return { ran: false, blocked: true, reason: outcome.reason, operation, requestedPasses, added: 0, posts: [], state: prev };
  }

  const stampedAt = deps.now();
  const nextProgress: XArchiveProfileProgress = { ...progress };
  if (operation.type === 'posts') {
    nextProgress.postPasses = requestedPasses;
    nextProgress.lastPostRunAt = stampedAt;
  } else if (operation.type === 'follower') {
    nextProgress.followerPasses = requestedPasses;
    nextProgress.lastFollowerRunAt = stampedAt;
  } else {
    nextProgress.followingPasses = requestedPasses;
    nextProgress.lastFollowingRunAt = stampedAt;
  }

  const nextState: XArchiveState = {
    ...prev,
    cycles: prev.cycles + 1,
    lastRunAt: stampedAt,
    nextOperationIndex: (index + 1) % operations.length,
    profiles: { ...prev.profiles, [key]: nextProgress },
  };
  await deps.writeState(req.caseId, nextState);

  return {
    ran: true,
    blocked: false,
    operation,
    requestedPasses,
    added: outcome.added,
    posts: outcome.posts,
    state: nextState,
  };
}
