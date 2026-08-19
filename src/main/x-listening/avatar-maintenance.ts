/**
 * X Listening Station — background avatar maintenance under the collection mutex.
 *
 * Two passes keep display pics populated:
 *   - `repairAvatars` re-fetches avatars whose remote URL we already observed (captured profiles).
 *   - `primeEntityAvatars` VISITS mentioned profiles we never captured, so the entity index can show
 *     faces instead of monograms (operator decision, 2026-08-19 — this is added egress, and is
 *     bounded, Tor-gated, idempotent, and miss-suppressed inside that pass).
 *
 * Both open a hardened capture window and egress, so both belong under the app-wide collection mutex.
 * The post-capture repair previously ran fire-and-forget INSIDE the locked body, which meant its
 * window opened after the mutex had already been released — the concurrent egress the mutex exists to
 * prevent. Maintenance therefore acquires the lock itself and SKIPS when busy: it is background work,
 * so skipping is correct (the next capture re-runs it), and skipping can never wedge anything.
 *
 * Best-effort by contract: it never throws at its caller and never fails the capture that scheduled it.
 */
import { tryAcquireCollectionLock, releaseCollectionLock } from './collection-lock';

export interface AvatarMaintenanceDeps {
  repair: (caseId: string) => Promise<unknown>;
  prime: (caseId: string) => Promise<unknown>;
  warn: (message: string, err: unknown) => void;
}

function defaultDeps(): AvatarMaintenanceDeps {
  return {
    repair: async (caseId) => {
      const { repairAvatars } = await import('./avatar-repair');
      return repairAvatars(caseId);
    },
    prime: async (caseId) => {
      const { primeEntityAvatarsForCase } = await import('./avatar-repair');
      return primeEntityAvatarsForCase(caseId);
    },
    warn: (message, err) => console.warn(`[XListening] ${message}`, err),
  };
}

/**
 * Run both avatar passes while holding the collection lock, or do nothing if another collection
 * operation holds it. Each pass is independently guarded so one failure never suppresses the other.
 */
export async function runAvatarMaintenance(
  caseId: string,
  overrides: Partial<AvatarMaintenanceDeps> = {},
): Promise<void> {
  const deps: AvatarMaintenanceDeps = { ...defaultDeps(), ...overrides };
  if (!tryAcquireCollectionLock('avatar maintenance')) return;
  try {
    try {
      await deps.repair(caseId);
    } catch (err) {
      deps.warn('avatar repair:', err);
    }
    try {
      await deps.prime(caseId);
    } catch (err) {
      deps.warn('entity avatar priming:', err);
    }
  } finally {
    releaseCollectionLock();
  }
}

/** Fire-and-forget scheduling for IPC call sites: runs AFTER the caller's lock has been released. */
export function scheduleAvatarMaintenance(caseId: string): void {
  setTimeout(() => {
    void runAvatarMaintenance(caseId);
  }, 0);
}

// ---- making the pass explain itself -----------------------------------------------------------
/**
 * Display pics failed silently across three releases because every avatar pass discarded its result:
 * a fail-closed gate, an empty candidate list and a failed fetch all rendered identically (monograms,
 * no message). This turns a run into something the operator can read.
 *
 * The acknowledgement case gets its own wording deliberately. The app gates manual capture on
 * `clearnet` alone but the avatar passes on `clearnet AND clearnetAck`, so an install that captures
 * happily over clearnet can still have every avatar pass resolve to Tor and refuse — the single most
 * confusing state this feature can be in, and the one worth naming outright.
 */
export interface AvatarRunOutcome {
  scanned: number;
  skipped: number;
  visited: number;
  cached: number;
  blocked: boolean;
  reason?: string;
}

export interface AvatarRunSummary {
  ok: boolean;
  message: string;
  /** True when the ONLY thing standing between the operator and pictures is the clearnet ack. */
  needsClearnetAck: boolean;
  outcome: AvatarRunOutcome;
}

export function summarizeAvatarRun(
  outcome: AvatarRunOutcome,
  settings: { clearnet?: boolean; clearnetAck?: boolean } | null | undefined,
): AvatarRunSummary {
  const clearnet = settings?.clearnet === true;
  const acked = settings?.clearnetAck === true;
  if (outcome.blocked) {
    const needsClearnetAck = clearnet && !acked;
    return {
      ok: false,
      needsClearnetAck,
      outcome,
      message: needsClearnetAck
        ? 'Display pictures are blocked: clearnet is switched on for capture, but the real-IP ' +
          'exposure has never been acknowledged, so picture fetching still requires Tor — and Tor is ' +
          'not ready. Acknowledge clearnet exposure to fetch pictures over the same path your ' +
          'captures already use.'
        : `Display pictures are blocked: ${outcome.reason ?? 'Tor is not ready and clearnet is off.'}`,
    };
  }
  if (outcome.scanned === 0) {
    return { ok: true, needsClearnetAck: false, outcome, message: 'No accounts to fetch pictures for yet — capture a timeline first.' };
  }
  if (outcome.cached > 0) {
    return {
      ok: true,
      needsClearnetAck: false,
      outcome,
      message: `Fetched ${outcome.cached} display picture${outcome.cached === 1 ? '' : 's'}` +
        (outcome.skipped ? ` (${outcome.skipped} already had one).` : '.'),
    };
  }
  if (outcome.visited > 0) {
    return {
      ok: false,
      needsClearnetAck: false,
      outcome,
      message: `Visited ${outcome.visited} profile${outcome.visited === 1 ? '' : 's'} but could not read a picture from any of them — X may have shown a login or challenge page instead.`,
    };
  }
  return {
    ok: true,
    needsClearnetAck: false,
    outcome,
    message: `Nothing to fetch — all ${outcome.skipped} known account${outcome.skipped === 1 ? '' : 's'} already had a picture.`,
  };
}

export interface FetchDisplayPicturesDeps {
  repair: (caseId: string) => Promise<AvatarRunOutcome>;
  prime: (caseId: string) => Promise<AvatarRunOutcome>;
  readSettings: () => Promise<{ clearnet?: boolean; clearnetAck?: boolean } | null>;
}

const EMPTY_OUTCOME: AvatarRunOutcome = { scanned: 0, skipped: 0, visited: 0, cached: 0, blocked: false };

/** Merge two passes into one outcome. Blocked only if BOTH refused — one pass working is not a block. */
function mergeOutcomes(a: AvatarRunOutcome, b: AvatarRunOutcome): AvatarRunOutcome {
  return {
    scanned: a.scanned + b.scanned,
    skipped: a.skipped + b.skipped,
    visited: a.visited + b.visited,
    cached: a.cached + b.cached,
    blocked: a.blocked && b.blocked,
    reason: a.reason ?? b.reason,
  };
}

function defaultFetchDeps(): FetchDisplayPicturesDeps {
  return {
    repair: async (caseId) => {
      const { repairAvatars } = await import('./avatar-repair');
      const r = (await repairAvatars(caseId)) as Partial<AvatarRunOutcome> | undefined;
      return { ...EMPTY_OUTCOME, ...(r ?? {}) };
    },
    prime: async (caseId) => {
      const { primeEntityAvatarsForCase } = await import('./avatar-repair');
      return { ...EMPTY_OUTCOME, ...(await primeEntityAvatarsForCase(caseId)) };
    },
    readSettings: async () => {
      const { settingsStore } = await import('../storage/json-fs');
      const settings = await settingsStore.read();
      return settings?.xListening ?? null;
    },
  };
}

/**
 * The operator-initiated "Fetch display pictures" action. Runs both passes and ALWAYS returns a
 * readable summary — never throws at the IPC boundary, because the entire point is that a failure
 * says why instead of leaving monograms and no explanation.
 *
 * A pass that throws contributes nothing rather than aborting the other: partial pictures beat none,
 * and the summary still reports what was achieved.
 */
export async function fetchDisplayPicturesNow(
  caseId: string,
  overrides: Partial<FetchDisplayPicturesDeps> = {},
): Promise<AvatarRunSummary> {
  const deps: FetchDisplayPicturesDeps = { ...defaultFetchDeps(), ...overrides };
  const safely = async (run: () => Promise<AvatarRunOutcome>): Promise<AvatarRunOutcome> => {
    try {
      return { ...EMPTY_OUTCOME, ...(await run()) };
    } catch {
      return EMPTY_OUTCOME;
    }
  };
  const repaired = await safely(() => deps.repair(caseId));
  const primed = await safely(() => deps.prime(caseId));
  const settings = await deps.readSettings().catch(() => null);
  return summarizeAvatarRun(mergeOutcomes(repaired, primed), settings);
}
