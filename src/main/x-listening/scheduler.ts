/**
 * X Listening Station — automatic sweep + archive scheduler (Task G1).
 *
 * Restores Enterprise's free-running `setInterval` auto-sweep + incremental-archive cadence
 * (`electron/main.cjs` `restartAutoSweep` :1912-1922 / `restartArchiveTimer` :2058-2069) onto the
 * hardened seams. The operator decision (2026-08-12) is: the TIMER is source-exact (fixed interval,
 * no auto-pause, no jitter-bounding), but EGRESS safety is user-controlled, not automatic — each
 * scheduled sweep's capture routes the SAME Tor gate as a manual capture via `captureProfileTimeline`
 * (which resolves `resolveXTorGate` itself). So:
 *
 *   - Tor mode (default) with Tor down ⇒ the sweep FAILS CLOSED — no capture window opens, no clearnet
 *     egress, nothing is captured. The timer keeps ticking; each tick simply captures nothing until Tor
 *     is back (source-exact cadence, never a silent clearnet leak).
 *   - The clearnet (real-IP) path fires ONLY when the operator has enabled clearnet AND acknowledged
 *     it (`AppSettings.xListening.clearnet` && `clearnetAck`) — enforced inside `captureProfileTimeline`.
 *   - The schedule only RUNS while an X session is connected (auth cookie present); an idle timer for a
 *     disconnected campaign captures nothing.
 *
 * Lifecycle (mirrors Enterprise calling `restartAutoSweep()`/`restartArchiveTimer()` after every
 * settings save / session change): `restartSchedule` (re)builds the timers from the per-campaign
 * COLLECTION SETTINGS (F2 `automaticSweeps`/`sweepIntervalMinutes`/`archiveEnabled`/
 * `archiveIntervalMinutes`); `stopSchedule` clears them (session disconnect); `stopAllSchedules` on
 * teardown. The IPC layer calls these on openSession / closeSession / saveCollectionSettings.
 *
 * Quarantine-clean at module load: no static electron/Tor/bgconn import — the timer uses Node's global
 * `setInterval`/`clearInterval` (injectable), and every production dep (settings, session status,
 * store, the capture primitive, the archive loop) is a LAZY dynamic import inside `defaultSchedulerDeps`.
 * Determinism: the clock + timer are injectable; scheduling metadata (`nextSweepAt`) never feeds a hash.
 */
import { normalizeXSourceKey } from '@shared/x-listening-source';
import {
  collectGateFromSettings,
  type XCollectionSettings,
} from '@shared/x-listening-collection-settings';
import type { XScheduleStatus } from '@shared/x-listening-schedule';
import type { XTimelineCaptureResult } from './capture';
import { tryAcquireCollectionLock, releaseCollectionLock, touchCollectionLock } from './collection-lock';

export type { XScheduleStatus };

/** One derived monitored source in a campaign (sources are derived from captured posts — GI98 has no
 *  first-class profile record; see F1). */
export interface XSweepSource {
  channelId: string;
  channelLabel: string;
  targetUsername: string;
}

/** The outcome of one capture inside a sweep — the subset of `XTimelineCaptureResult` the loop reads. */
export interface XSweepCaptureOutcome {
  blocked: boolean;
  reason?: string;
  added: number;
  skipped: number;
  posts: XTimelineCaptureResult['posts'];
}

/** The aggregate outcome of running one whole sweep (or archive) pass over a campaign's sources. */
export interface XSweepRunResult {
  /** True iff at least one source was captured without the Tor gate refusing. */
  swept: boolean;
  /** True iff a source's capture was Tor-gate-blocked (halts the pass — fail-closed). */
  blocked: boolean;
  reason?: string;
  /** How many sources were captured before the pass ended. */
  sources: number;
  /** Total posts added across the pass. */
  added: number;
}

/** Injectable seams so the scheduler is testable without electron/network/secure-fs/real timers. */
export interface XSchedulerDeps {
  /** Read the campaign's per-campaign COLLECTION SETTINGS (F2). */
  loadSettings: (caseId: string) => Promise<XCollectionSettings>;
  /** True iff an X session is currently connected (auth cookie present) for the campaign. */
  isConnected: (caseId: string) => Promise<boolean>;
  /** The distinct monitored sources for the campaign (derived from captured posts). */
  listSources: (caseId: string) => Promise<XSweepSource[]>;
  /** Capture ONE source's timeline through the Tor-gated sweep primitive (fail-closed). */
  sweepProfile: (
    caseId: string,
    source: XSweepSource,
    settings: XCollectionSettings,
  ) => Promise<XSweepCaptureOutcome>;
  /** Run ONE incremental-archive OPERATION this tick (FA4 round-robin — posts/follower/following of a
   *  single source, not every source at once) through the Tor-gated primitive (fail-closed). */
  archiveRotate: (
    caseId: string,
    sources: XSweepSource[],
    settings: XCollectionSettings,
  ) => Promise<{ ran: boolean; blocked: boolean; reason?: string; added: number }>;
  /** Arm a repeating timer; defaults to the global `setInterval`. */
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Clear a timer armed by `schedule`; defaults to the global `clearInterval`. */
  unschedule: (handle: ReturnType<typeof setInterval>) => void;
  /** Injected clock in ms (determinism); defaults to `Date.now`. Feeds `nextSweepAt` only. */
  now: () => number;
  /** Injectable delay seam (M6 per-target spacing); defaults to a real `setTimeout` sleep. */
  sleep: (ms: number) => Promise<void>;
  /** M6: milliseconds to pause BETWEEN targets in a sweep (Enterprise `refreshAll`'s 1500ms gap,
   *  `main.cjs:1907`); defaults to `SWEEP_TARGET_SPACING_MS`. */
  interTargetDelayMs: number;
}

/** Enterprise's fixed 1500ms inter-target sweep gap (`refreshAll`, `main.cjs:1907`) — less bot-like
 *  than back-to-back egress. Injectable per-run via `XSchedulerDeps.interTargetDelayMs`. */
const SWEEP_TARGET_SPACING_MS = 1500;

/** A campaign's live schedule state — the armed timers + the metadata the renderer's next-sweep
 *  indicator reads back through `scheduleStatus`. */
interface SchedulerEntry {
  sweepTimer: ReturnType<typeof setInterval> | null;
  archiveTimer: ReturnType<typeof setInterval> | null;
  nextSweepAt: string | null;
  nextArchiveAt: string | null;
  sweepEnabled: boolean;
  archiveEnabled: boolean;
  sweepIntervalMinutes: number;
  archiveIntervalMinutes: number;
  sweepIntervalMs: number;
  archiveIntervalMs: number;
  /** Overlap guard — a still-running sweep must not be re-entered by the next tick (Enterprise's
   *  `!sweepRunning` guard). */
  sweepRunning: boolean;
  archiveRunning: boolean;
}

/** Live schedules, keyed by caseId. Module-level singleton — the timers must survive across IPC calls
 *  (they are the app's background cadence), not per-call state. */
const schedules = new Map<string, SchedulerEntry>();

/** Test-only: clear every schedule so each test starts clean (does not fire `unschedule` — tests own
 *  their injected timer harness). */
export function __resetSchedulerForTests(): void {
  schedules.clear();
}

/** The Enterprise sweep-interval clamp band (minutes), re-applied here as defence-in-depth over the
 *  already-clamped stored value — a scheduled timer can never be armed at a negative/NaN/absurd rate. */
const SWEEP_MIN = 5;
const SWEEP_MAX = 1440;
/** The Enterprise archive-interval clamp band (minutes). */
const ARCHIVE_MIN = 30;
const ARCHIVE_MAX = 10080;

function clampMinutes(value: number, min: number, max: number, def: number): number {
  const floored = Math.floor(Number(value));
  const base = Number.isFinite(floored) && floored > 0 ? floored : def;
  return Math.max(min, Math.min(max, base));
}

export function defaultSchedulerDeps(): XSchedulerDeps {
  return {
    loadSettings: async (caseId) => {
      const { getCollectionSettings } = await import('./collection-settings');
      return getCollectionSettings(caseId);
    },
    isConnected: async (caseId) => {
      try {
        const { getXStatus } = await import('./session');
        const status = await getXStatus(caseId);
        return status.connected;
      } catch {
        return false;
      }
    },
    listSources: async (caseId) => {
      const { prodXStore } = await import('./store');
      const store = await prodXStore();
      const posts = await store.posts.read(caseId);
      const seen = new Map<string, XSweepSource>();
      for (const p of posts) {
        // `raw` is the MONITORED channel (channelId), falling back to authorHandle only for a
        // self-post source that has no channelId. The sweep target MUST come from this, NOT from
        // p.authorHandle: for a reply/comment row extract.ts stores channelId=the monitored target
        // but authorHandle=the third-party author, so keying the sweep on authorHandle would sweep a
        // commenter's timeline and file it under the target's channel (evidence contamination), and
        // would look up F1's per-source image override under the wrong key.
        const raw = String(p.channelId || p.authorHandle || '');
        const key = normalizeXSourceKey(raw);
        if (!key || seen.has(key)) continue;
        const target = raw.replace(/^@+/, '') || key;
        seen.set(key, {
          channelId: p.channelId || key,
          channelLabel: p.channelLabel || `@${key}`,
          targetUsername: target,
        });
      }
      return [...seen.values()];
    },
    sweepProfile: async (caseId, source, settings) => {
      const imagesEnabled = await resolveSourceImages(caseId, source.targetUsername, settings);
      const { captureProfileTimeline } = await import('./capture');
      const res = await captureProfileTimeline({
        caseId,
        channelId: source.channelId,
        channelLabel: source.channelLabel,
        targetUsername: source.targetUsername,
        collect: collectGateFromSettings(settings),
        imagesEnabled,
      });
      return { blocked: res.blocked, reason: res.reason, added: res.added, skipped: res.skipped, posts: res.posts };
    },
    archiveRotate: async (caseId, sources, settings) => {
      // FA4: one incremental-archive OPERATION per tick (round-robin across posts/follower/following
      // of the campaign's sources), stepping that operation's per-source pass depth toward its
      // ceiling. Per-campaign `archiveEnabled` already gated this at schedule time; the Tor gate is
      // still the egress authority (resolved inside `captureProfileTimeline`/`captureNetwork`), so a
      // blocked op captures nothing and advances neither the round-robin pointer nor the depth.
      const { runArchiveRotation } = await import('./archive');
      const res = await runArchiveRotation({ caseId, jobId: caseId, sources, settings });
      return { ran: res.ran, blocked: res.blocked, reason: res.reason, added: res.added };
    },
    schedule: (fn, ms) => setInterval(fn, ms),
    unschedule: (handle) => clearInterval(handle),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    interTargetDelayMs: SWEEP_TARGET_SPACING_MS,
  };
}

/** Resolve one source's EFFECTIVE image policy (F1), fail-safe TRUE — never STOP collecting media on a
 *  read hiccup (the fetch is host-anchored + Tor-gated regardless). Reuses the already-loaded campaign
 *  settings' `retrieveImages` so no second settings read is issued. */
async function resolveSourceImages(
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

/**
 * Run ONE whole sweep pass over a campaign's sources (Task G1). Skips entirely (capturing nothing)
 * when no X session is connected — an unattended sweep must never run against a signed-out session.
 * Loads the per-campaign settings, derives the surrounding-thread collect gate, and captures each
 * source through the Tor-gated `sweepProfile` primitive. A source whose capture is Tor-gate-BLOCKED
 * HALTS the pass immediately (fail-closed — no further windows open, no further egress); the timer
 * keeps ticking so the next scheduled pass retries once Tor is back.
 */
export async function runScheduledSweep(
  caseId: string,
  overrides: Partial<XSchedulerDeps> = {},
): Promise<XSweepRunResult> {
  const deps: XSchedulerDeps = { ...defaultSchedulerDeps(), ...overrides };
  // M5: acquire the single app-wide collection lock BEFORE any egress. If another collection op
  // (a manual capture, another campaign's sweep, an archive tick, a live verify) already holds it,
  // this scheduled sweep SKIPS this tick (Enterprise's background-timer `if (!sweepRunning && …)`,
  // `main.cjs:1919`) — never a second concurrent capture window. The timer keeps ticking; the next
  // tick retries once the lock is free.
  if (!tryAcquireCollectionLock('scheduled sweep')) {
    return { swept: false, blocked: false, reason: 'collection-busy', sources: 0, added: 0 };
  }
  try {
    if (!(await deps.isConnected(caseId))) {
      return { swept: false, blocked: false, reason: 'not-connected', sources: 0, added: 0 };
    }
    const settings = await deps.loadSettings(caseId);
    const sources = await deps.listSources(caseId);
    if (!sources.length) {
      return { swept: false, blocked: false, reason: 'no-sources', sources: 0, added: 0 };
    }
    let added = 0;
    let captured = 0;
    for (let index = 0; index < sources.length; index += 1) {
      // Report progress so a long BUT HEALTHY multi-target sweep never trips the stale-hold break.
      touchCollectionLock();
      const res = await deps.sweepProfile(caseId, sources[index]!, settings);
      if (res.blocked) {
        // Fail closed: the Tor gate refused — stop the pass, egress nothing further (no trailing gap).
        return { swept: false, blocked: true, reason: res.reason, sources: captured, added };
      }
      captured += 1;
      added += res.added ?? 0;
      // M6: pause BETWEEN targets (Enterprise `refreshAll`'s 1500ms gap, `main.cjs:1907`) — less
      // bot-like than back-to-back egress. Never after the final target.
      if (index < sources.length - 1) await deps.sleep(deps.interTargetDelayMs);
    }
    return { swept: true, blocked: false, sources: captured, added };
  } finally {
    releaseCollectionLock();
  }
}

/**
 * Run ONE incremental-archive TICK over a campaign (Task G1 + FA4). Same connected-gate + Tor
 * fail-closed discipline as `runScheduledSweep`, but — unlike a sweep, which captures every source —
 * an archive tick runs exactly ONE round-robin operation (posts/follower/following of a single
 * source, stepping that source's pass depth deeper), keeping per-tick load light (Enterprise
 * `runArchiveCycle`, `main.cjs:1966-1968`). A Tor/challenge-blocked op advances nothing and reports
 * blocked.
 */
export async function runScheduledArchive(
  caseId: string,
  overrides: Partial<XSchedulerDeps> = {},
): Promise<XSweepRunResult> {
  const deps: XSchedulerDeps = { ...defaultSchedulerDeps(), ...overrides };
  // M5: same single app-wide collection lock as a sweep — an archive tick contending with any other
  // collection op SKIPS (Enterprise's archive-timer `if (!sweepRunning && …)`, `main.cjs:2065`), so
  // an archive op never egresses concurrently with a sweep / manual capture / another campaign.
  if (!tryAcquireCollectionLock('archive tick')) {
    return { swept: false, blocked: false, reason: 'collection-busy', sources: 0, added: 0 };
  }
  try {
    if (!(await deps.isConnected(caseId))) {
      return { swept: false, blocked: false, reason: 'not-connected', sources: 0, added: 0 };
    }
    const settings = await deps.loadSettings(caseId);
    const sources = await deps.listSources(caseId);
    if (!sources.length) {
      return { swept: false, blocked: false, reason: 'no-sources', sources: 0, added: 0 };
    }
    const res = await deps.archiveRotate(caseId, sources, settings);
    if (res.blocked) {
      return { swept: false, blocked: true, reason: res.reason, sources: 0, added: res.added };
    }
    return { swept: res.ran, blocked: false, sources: res.ran ? 1 : 0, added: res.added };
  } finally {
    releaseCollectionLock();
  }
}

/** Fire one sweep tick: advance the next-fire metadata, skip if the prior tick is still running
 *  (overlap guard), else run the sweep. Errors are swallowed (a background tick must never crash the
 *  main process); the next tick retries. */
async function tickSweep(caseId: string, deps: XSchedulerDeps): Promise<void> {
  const entry = schedules.get(caseId);
  if (!entry) return;
  entry.nextSweepAt = new Date(deps.now() + entry.sweepIntervalMs).toISOString();
  if (entry.sweepRunning) return;
  entry.sweepRunning = true;
  try {
    await runScheduledSweep(caseId, deps);
  } catch (err) {
    console.warn('[XListening] scheduled sweep:', err);
  } finally {
    entry.sweepRunning = false;
  }
}

/** Fire one archive tick (same overlap-guard + swallow discipline as `tickSweep`). */
async function tickArchive(caseId: string, deps: XSchedulerDeps): Promise<void> {
  const entry = schedules.get(caseId);
  if (!entry) return;
  entry.nextArchiveAt = new Date(deps.now() + entry.archiveIntervalMs).toISOString();
  if (entry.archiveRunning) return;
  entry.archiveRunning = true;
  try {
    await runScheduledArchive(caseId, deps);
  } catch (err) {
    console.warn('[XListening] scheduled archive:', err);
  } finally {
    entry.archiveRunning = false;
  }
}

/** Clear any timers armed for `caseId` and forget the schedule (session disconnect / re-arm). */
export function stopSchedule(caseId: string, overrides: Partial<XSchedulerDeps> = {}): void {
  const deps: XSchedulerDeps = { ...defaultSchedulerDeps(), ...overrides };
  const entry = schedules.get(caseId);
  if (!entry) return;
  if (entry.sweepTimer !== null) deps.unschedule(entry.sweepTimer);
  if (entry.archiveTimer !== null) deps.unschedule(entry.archiveTimer);
  schedules.delete(caseId);
}

/** Clear every campaign's timers (app teardown). */
export function stopAllSchedules(overrides: Partial<XSchedulerDeps> = {}): void {
  for (const caseId of [...schedules.keys()]) stopSchedule(caseId, overrides);
}

/** Per-case restart serialization. `restartSchedule` is called fire-and-forget from multiple sites
 *  (session connect, settings save); because the rebuild has an `await loadSettings` gap between
 *  clearing the old timers and arming the new ones, two overlapping restarts could interleave so one
 *  restart's `stopSchedule` runs before the other's `set`, orphaning an armed `setInterval` (leaked
 *  timer → doubled cadence). Chaining per caseId forces restarts to run one-at-a-time. */
const restartChains = new Map<string, Promise<XScheduleStatus>>();

/**
 * (Re)build the campaign's sweep + archive timers from its per-campaign COLLECTION SETTINGS (Task G1).
 * Serialized per caseId (see `restartChains`) so concurrent fire-and-forget restarts cannot orphan a
 * timer. Clears any existing timers first, then — SOURCE-EXACT (Enterprise `restartAutoSweep`/
 * `restartArchiveTimer`) — arms a free-running `setInterval` at the (clamped) sweep interval when
 * `automaticSweeps` is on, and at the archive interval when `archiveEnabled` is on. The Tor gate lives
 * inside each tick's capture (fail-closed) — the timer itself never touches egress. Returns the fresh
 * `scheduleStatus`. Idempotent: safe to call on every settings save / session connect.
 */
export function restartSchedule(
  caseId: string,
  overrides: Partial<XSchedulerDeps> = {},
): Promise<XScheduleStatus> {
  const prev = restartChains.get(caseId) ?? Promise.resolve<XScheduleStatus | undefined>(undefined);
  const next = prev
    .catch(() => undefined)
    .then(() => doRestartSchedule(caseId, overrides));
  restartChains.set(caseId, next);
  // Drop the chain slot once this link settles (unless a newer restart already replaced it), so the
  // map doesn't grow unbounded across a long-lived campaign.
  void next.catch(() => undefined).finally(() => {
    if (restartChains.get(caseId) === next) restartChains.delete(caseId);
  });
  return next;
}

async function doRestartSchedule(
  caseId: string,
  overrides: Partial<XSchedulerDeps> = {},
): Promise<XScheduleStatus> {
  const deps: XSchedulerDeps = { ...defaultSchedulerDeps(), ...overrides };
  stopSchedule(caseId, deps);

  const settings = await deps.loadSettings(caseId);
  const sweepMinutes = clampMinutes(settings.sweepIntervalMinutes, SWEEP_MIN, SWEEP_MAX, 30);
  const archiveMinutes = clampMinutes(settings.archiveIntervalMinutes, ARCHIVE_MIN, ARCHIVE_MAX, 240);
  const sweepIntervalMs = sweepMinutes * 60 * 1000;
  const archiveIntervalMs = archiveMinutes * 60 * 1000;

  const entry: SchedulerEntry = {
    sweepTimer: null,
    archiveTimer: null,
    nextSweepAt: null,
    nextArchiveAt: null,
    sweepEnabled: settings.automaticSweeps === true,
    archiveEnabled: settings.archiveEnabled === true,
    sweepIntervalMinutes: sweepMinutes,
    archiveIntervalMinutes: archiveMinutes,
    sweepIntervalMs,
    archiveIntervalMs,
    sweepRunning: false,
    archiveRunning: false,
  };

  if (entry.sweepEnabled) {
    entry.sweepTimer = deps.schedule(() => {
      void tickSweep(caseId, deps);
    }, sweepIntervalMs);
    entry.nextSweepAt = new Date(deps.now() + sweepIntervalMs).toISOString();
  }
  if (entry.archiveEnabled) {
    entry.archiveTimer = deps.schedule(() => {
      void tickArchive(caseId, deps);
    }, archiveIntervalMs);
    entry.nextArchiveAt = new Date(deps.now() + archiveIntervalMs).toISOString();
  }

  schedules.set(caseId, entry);
  return scheduleStatus(caseId);
}

/**
 * The renderer-facing schedule status for `caseId` — the armed cadence + next-fire times (drives the
 * next-sweep indicator + Pause control). A campaign with no live schedule reports everything off/null.
 */
export function scheduleStatus(caseId: string): XScheduleStatus {
  const entry = schedules.get(caseId);
  if (!entry) {
    return {
      caseId,
      sweepEnabled: false,
      sweepIntervalMinutes: 0,
      nextSweepAt: null,
      archiveEnabled: false,
      archiveIntervalMinutes: 0,
      nextArchiveAt: null,
      running: false,
    };
  }
  return {
    caseId,
    sweepEnabled: entry.sweepEnabled,
    sweepIntervalMinutes: entry.sweepIntervalMinutes,
    nextSweepAt: entry.nextSweepAt,
    archiveEnabled: entry.archiveEnabled,
    archiveIntervalMinutes: entry.archiveIntervalMinutes,
    nextArchiveAt: entry.nextArchiveAt,
    running: entry.sweepRunning || entry.archiveRunning,
  };
}
