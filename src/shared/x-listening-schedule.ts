/**
 * X Listening Station — automatic sweep/archive SCHEDULE status shape (Task G1).
 *
 * The renderer-facing view of the main-side scheduler registry (`src/main/x-listening/scheduler.ts`):
 * whether the free-running sweep/archive timers are armed, their (clamped) interval, and the next-fire
 * times. Lives in the shared layer so the preload/main trust boundary is respected — the preload binds
 * a channel typed by this shape without importing anything from `src/main`.
 *
 * The timer cadence is source-exact (Enterprise `restartAutoSweep`/`restartArchiveTimer`), but every
 * scheduled sweep's capture still routes the same Tor gate as a manual capture — fail-closed, with no
 * clearnet egress unless the operator has enabled clearnet AND acknowledged the real-IP exposure.
 */
export interface XScheduleStatus {
  /** The campaign this status is for. */
  caseId: string;
  /** True iff the free-running automatic-sweep timer is armed. */
  sweepEnabled: boolean;
  /** The armed sweep cadence in minutes (clamped 5–1440); 0 when no schedule is live. */
  sweepIntervalMinutes: number;
  /** ISO time the next sweep tick will fire, or null when sweeps are off. */
  nextSweepAt: string | null;
  /** True iff the free-running incremental-archive timer is armed. */
  archiveEnabled: boolean;
  /** The armed archive cadence in minutes (clamped 30–10080); 0 when no schedule is live. */
  archiveIntervalMinutes: number;
  /** ISO time the next archive tick will fire, or null when the archive is off. */
  nextArchiveAt: string | null;
  /** True iff a sweep or archive pass is currently mid-run (overlap-guard state). */
  running: boolean;
}
