import { randomUUID } from 'node:crypto';
import { buildProbeUrl } from '@shared/searchlight/sites';
import { interpretResult } from '@shared/searchlight/interpret';
import type { MaigretSiteEntry, ScorerCtx, SweepResult } from '@shared/searchlight/types';
import { probe as defaultProbe } from './probe';

export interface RunSweepArgs {
  jobId: string;
  username: string;
  sites: MaigretSiteEntry[];
  useTor: boolean;
  concurrency: number;
  networkEnabled: boolean;
  emit: (r: SweepResult) => void;
  onDone: (final: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void;
  isCancelled: () => boolean;
  // live Tor SOCKS port accessor; forwarded to probe so Tor sweeps can dial
  torSocksPort?: () => number | null;
  probeImpl?: typeof defaultProbe;
  /** Scorer context for structural detection. When provided, fallback branches are routed
   *  through the heuristic scorer and ambiguous 'maybe' results trigger phase-2 escalation. */
  scorerCtx?: ScorerCtx;
  /** When true, phase-2 body fetch is suppressed (lightweight / fast sweep mode). */
  lightweightMode?: boolean;
}

export async function runSweep(args: RunSweepArgs): Promise<void> {
  const { jobId, username, sites, useTor, concurrency, networkEnabled, emit, onDone, isCancelled } = args;
  const probe = args.probeImpl ?? defaultProbe;

  if (!networkEnabled) { onDone({ jobId, status: 'completed', checked: 0 }); return; }

  const queue = [...sites];
  let checked = 0;
  let cancelledSeen = false;

  const { scorerCtx, lightweightMode = false } = args;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) { cancelledSeen = true; return; }
      const site = queue.shift();
      if (!site) return;
      const { url, probeUrl } = buildProbeUrl(username, site);
      const fetchBody = site.checkType === 'message';
      try {
        const raw = await probe(probeUrl, { fetchBody, headers: site.headers, useTor }, { socksPort: args.torSocksPort });
        let interp = interpretResult(site, raw, url, scorerCtx);

        // Adaptive phase-2 escalation: if the scorer found the result ambiguous ('maybe')
        // and we didn't already fetch the body, do one follow-up GET to collect body signals.
        // On phase-2 failure (throw or error field set), keep the phase-1 interpretation.
        if (interp.status === 'maybe' && !fetchBody && !lightweightMode && !raw.error) {
          try {
            const raw2 = await probe(probeUrl, { fetchBody: true, headers: site.headers, useTor }, { socksPort: args.torSocksPort });
            if (!raw2.error) {
              interp = interpretResult(site, raw2, url, scorerCtx);
            }
            // raw2.error → graceful fallback: keep phase-1 interp
          } catch {
            // phase-2 threw → graceful fallback: keep phase-1 interp
          }
        }

        emit({
          id: randomUUID(), jobId, siteName: site.name, username, url,
          statusCode: raw.statusCode, statusMessage: raw.statusMessage, elapsed: raw.elapsed,
          redirectUrl: raw.redirectUrl, error: raw.error, category: site.category, tags: site.tags,
          checkType: site.checkType, found: interp.found, confidence: interp.confidence,
          status: interp.status, probability: interp.probability, timestamp: Date.now()
        });
        checked++;  // count the site once regardless of how many probe phases ran
      } catch { /* isolate per-site failure */ }
    }
  };

  const n = Math.max(1, Math.min(concurrency, sites.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  onDone({ jobId, status: cancelledSeen || isCancelled() ? 'cancelled' : 'completed', checked });
}

// ---------------------------------------------------------------------------
// Electron-wired wrapper — thin glue; not unit-tested (manual smoke in Task 9)
// ---------------------------------------------------------------------------

const active = new Map<string, { cancelled: boolean }>();

export function cancelSweep(jobId: string): void {
  const e = active.get(jobId);
  if (e) e.cancelled = true;
}

export function cancelAllSweeps(): void {
  for (const e of active.values()) e.cancelled = true;
}

export interface StartSweepDeps {
  loadSites: (siteIds: string[]) => Promise<MaigretSiteEntry[]>;
  networkEnabled: () => Promise<boolean>;
  torSocksPort: () => number | null;
  defaultConcurrency: (useTor: boolean) => number;
  emit: (r: SweepResult) => void;
  onDone: (final: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void;
  scorerCtx?: ScorerCtx;
  lightweightMode?: boolean;
}

/**
 * Returns the jobId immediately; runs the sweep in the background.
 * `args.useTor` defaults to true at the IPC layer (Task 7) — this function
 * takes `useTor` as given and forwards it to `runSweep` → `probe`.
 */
export async function startSweep(
  args: { username: string; siteIds: string[]; useTor: boolean },
  deps: StartSweepDeps
): Promise<{ jobId: string; total: number }> {
  const jobId = randomUUID();
  const sites = await deps.loadSites(args.siteIds);
  const networkEnabled = await deps.networkEnabled();
  const entry = { cancelled: false };
  active.set(jobId, entry);
  void runSweep({
    jobId, username: args.username, sites, useTor: args.useTor,
    concurrency: deps.defaultConcurrency(args.useTor), networkEnabled,
    emit: deps.emit, onDone: (f) => { active.delete(jobId); deps.onDone(f); },
    isCancelled: () => entry.cancelled,
    torSocksPort: deps.torSocksPort,
    scorerCtx: deps.scorerCtx,
    lightweightMode: deps.lightweightMode
  });
  return { jobId, total: sites.length };
}
