import { randomUUID } from 'node:crypto';
import { buildProbeUrl } from '@shared/searchlight/sites';
import { interpretResult } from '@shared/searchlight/interpret';
import type { MaigretSiteEntry, SweepResult } from '@shared/searchlight/types';
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
}

export async function runSweep(args: RunSweepArgs): Promise<void> {
  const { jobId, username, sites, useTor, concurrency, networkEnabled, emit, onDone, isCancelled } = args;
  const probe = args.probeImpl ?? defaultProbe;

  if (!networkEnabled) { onDone({ jobId, status: 'completed', checked: 0 }); return; }

  const queue = [...sites];
  let checked = 0;
  let cancelledSeen = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) { cancelledSeen = true; return; }
      const site = queue.shift();
      if (!site) return;
      const { url, probeUrl } = buildProbeUrl(username, site);
      const fetchBody = site.checkType === 'message';
      try {
        const raw = await probe(probeUrl, { fetchBody, headers: site.headers, useTor }, { socksPort: args.torSocksPort });
        const interp = interpretResult(site, raw, url);
        emit({
          id: randomUUID(), jobId, siteName: site.name, username, url,
          statusCode: raw.statusCode, statusMessage: raw.statusMessage, elapsed: raw.elapsed,
          redirectUrl: raw.redirectUrl, error: raw.error, category: site.category, tags: site.tags,
          checkType: site.checkType, found: interp.found, confidence: interp.confidence,
          status: interp.status, timestamp: Date.now()
        });
        checked++;
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
    torSocksPort: deps.torSocksPort
  });
  return { jobId, total: sites.length };
}
