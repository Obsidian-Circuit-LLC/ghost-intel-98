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
  /** Run ONE incremental-archive step for a source through the Tor-gated primitive (fail-closed). */
  archiveProfile: (
    caseId: string,
    source: XSweepSource,
    settings: XCollectionSettings,
  ) => Promise<XSweepCaptureOutcome>;
  /** Arm a repeating timer; defaults to the global `setInterval`. */
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Clear a timer armed by `schedule`; defaults to the global `clearInterval`. */
  unschedule: (handle: ReturnType<typeof setInterval>) => void;
  /** Injected clock in ms (determinism); defaults to `Date.now`. Feeds `nextSweepAt` only. */
  now: () => number;
}

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

function defaultSchedulerDeps(): XSchedulerDeps {
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
        const raw = String(p.channelId || p.authorHandle || '');
        const key = normalizeXSourceKey(raw);
        if (!key || seen.has(key)) continue;
        const handle = String(p.authorHandle || raw).replace(/^@+/, '') || key;
        seen.set(key, {
          channelId: p.channelId || key,
          channelLabel: p.channelLabel || `@${key}`,
          targetUsername: handle,
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
    archiveProfile: async (caseId, source, settings) => {
      const imagesEnabled = await resolveSourceImages(caseId, source.targetUsername, settings);
      const { captureProfileTimeline } = await import('./capture');
      // The archive tick reuses the SAME Tor-gated profile window as a sweep, but runs ONE
      // incremental-archive step against it (advancing the resumable archive cursor) instead of a
      // plain capture. Per-campaign `archiveEnabled` already gated this at schedule time, so the
      // archive loop's own `isEnabled` (the GLOBAL `archiveCycles` toggle, which governs the manual
      // "Run Archive Step" button) is overridden true here — the Tor gate is still the egress
      // authority (resolved inside `captureProfileTimeline`).
      const res = await captureProfileTimeline(
        {
          caseId,
          channelId: source.channelId,
          channelLabel: source.channelLabel,
          targetUsername: source.targetUsername,
          collect: collectGateFromSettings(settings),
          imagesEnabled,
        },
        {
          capture: async (win, req) => {
            const { runArchiveSteps } = await import('./archive');
            const loop = await runArchiveSteps(
              win,
              {
                caseId: req.caseId,
                jobId: req.jobId,
                channelId: req.channelId,
                channelLabel: req.channelLabel,
                targetUsername: req.targetUsername,
                collect: req.collect,
              },
              { maxCycles: 1, delayMs: 0 },
              { isEnabled: async () => true },
            );
            return { blocked: loop.blocked, reason: loop.reason, added: loop.totalAdded, skipped: 0, posts: loop.posts };
          },
        },
      );
      return { blocked: res.blocked, reason: res.reason, added: res.added, skipped: res.skipped, posts: res.posts };
    },
    schedule: (fn, ms) => setInterval(fn, ms),
    unschedule: (handle) => clearInterval(handle),
    now: () => Date.now(),
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
  for (const source of sources) {
    const res = await deps.sweepProfile(caseId, source, settings);
    if (res.blocked) {
      // Fail closed: the Tor gate refused — stop the pass, egress nothing further.
      return { swept: false, blocked: true, reason: res.reason, sources: captured, added };
    }
    captured += 1;
    added += res.added ?? 0;
  }
  return { swept: true, blocked: false, sources: captured, added };
}

/**
 * Run ONE incremental-archive pass over a campaign's sources (Task G1). Same connected-gate + Tor
 * fail-closed discipline as `runScheduledSweep`, but each source runs one archive step (advancing its
 * resumable cursor) via `archiveProfile`.
 */
export async function runScheduledArchive(
  caseId: string,
  overrides: Partial<XSchedulerDeps> = {},
): Promise<XSweepRunResult> {
  const deps: XSchedulerDeps = { ...defaultSchedulerDeps(), ...overrides };
  if (!(await deps.isConnected(caseId))) {
    return { swept: false, blocked: false, reason: 'not-connected', sources: 0, added: 0 };
  }
  const settings = await deps.loadSettings(caseId);
  const sources = await deps.listSources(caseId);
  if (!sources.length) {
    return { swept: false, blocked: false, reason: 'no-sources', sources: 0, added: 0 };
  }
  let added = 0;
  let ran = 0;
  for (const source of sources) {
    const res = await deps.archiveProfile(caseId, source, settings);
    if (res.blocked) {
      return { swept: false, blocked: true, reason: res.reason, sources: ran, added };
    }
    ran += 1;
    added += res.added ?? 0;
  }
  return { swept: true, blocked: false, sources: ran, added };
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

/**
 * (Re)build the campaign's sweep + archive timers from its per-campaign COLLECTION SETTINGS (Task G1).
 * Clears any existing timers first, then — SOURCE-EXACT (Enterprise `restartAutoSweep`/
 * `restartArchiveTimer`) — arms a free-running `setInterval` at the (clamped) sweep interval when
 * `automaticSweeps` is on, and at the archive interval when `archiveEnabled` is on. The Tor gate lives
 * inside each tick's capture (fail-closed) — the timer itself never touches egress. Returns the fresh
 * `scheduleStatus`. Idempotent: safe to call on every settings save / session connect.
 */
export async function restartSchedule(
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
