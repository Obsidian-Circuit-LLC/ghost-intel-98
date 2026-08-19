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
