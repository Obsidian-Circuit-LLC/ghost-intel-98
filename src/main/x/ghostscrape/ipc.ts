/**
 * GhostScrape (Task 6) — gated IPC: start/cancel a scrape job, push progress/done events.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native Electron primitives.
 *
 * Clearnet quarantine (spec §3.2, mirrored from src/main/x/ipc.ts) — this module MUST NOT
 * import from:
 *   src/main/bgconn/*
 *   src/main/chat/transport-tor
 *   src/main/chat/socks5
 *   src/main/searchlight/tor-socks
 *   src/main/socmint/collector
 * All egress is the hidden browser's own clearnet HTTPS to x.com (job.ts → browser.ts); this
 * module makes no network call of its own. Secrets/settings are INJECTED (`getSecret`,
 * `networkEnabled`, `clearnetAcknowledged`, `getWindow`) — never imported directly here —
 * mirroring how x/ipc.ts's XCollectHandlerDeps receives its deps.
 *
 * Egress gate (mirrors XCollectorGatedError in x/ipc.ts): BOTH settings.x.networkEnabled AND
 * settings.x.clearnetAcknowledged must be true before start() proceeds. Reuses the SAME
 * two-flag gate as X Intel — no new settings.ghostscrape namespace, no second cookie store.
 */

import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { channels } from '@shared/ipc-contracts';
import type { GhostScrapeConfig, ScrapeType } from './types';
import { runScrapeJob } from './job';

/**
 * Thrown by start() when the shared X clearnet egress gate is closed. Mirrors
 * XCollectorGatedError (src/main/x/ipc.ts) — same two flags, same "throw, don't silently
 * skip" posture so the UI layer must handle it explicitly.
 */
export class GhostScrapeGatedError extends Error {
  constructor() {
    super(
      'GhostScrape is gated — both settings.x.networkEnabled and ' +
      'settings.x.clearnetAcknowledged must be true. Acknowledge the clearnet ' +
      'warning in Settings → X before enabling.',
    );
    this.name = 'GhostScrapeGatedError';
  }
}

/** Injectable deps for createGhostScrapeHandlers — no direct settingsStore/secretStore/
 *  BrowserWindow import here, only what register.ts wires in (mirrors XCollectHandlerDeps). */
export interface GhostScrapeIpcDeps {
  getSecret(key: string): Promise<string | null>;
  /** Gate check — must return true for start() to proceed. */
  networkEnabled(): Promise<boolean>;
  /** Gate check — must return true (clearnet acknowledge dialog confirmed). */
  clearnetAcknowledged(): Promise<boolean>;
  /** Resolves the renderer window to push progress/done events to; may return null
   *  (window closed/not yet created) — pushes are then just dropped. */
  getWindow(): BrowserWindow | null;
}

const SCRAPE_TYPES: readonly ScrapeType[] = ['all', 'tweets', 'retweets', 'bio'];

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Coerce+bound a renderer-supplied scrape config at the IPC trust boundary. accountId/
 * username are required non-empty strings; type falls back to 'all' if not one of the known
 * values; scrolls/max/delayMs are clamped to sane bounds so a hostile or buggy renderer
 * payload can never drive an unbounded scroll loop (defense-in-depth on top of the renderer's
 * own buildScrapeRequest clamping — Task 7).
 */
function toConfig(raw: unknown): GhostScrapeConfig {
  const r = (raw ?? {}) as Record<string, unknown>;

  const accountId = typeof r.accountId === 'string' ? r.accountId.trim() : '';
  if (!accountId) throw new Error('ghostscrape:start requires accountId');

  const username = typeof r.username === 'string' ? r.username.trim() : '';
  if (!username) throw new Error('ghostscrape:start requires username');

  const type: ScrapeType = SCRAPE_TYPES.includes(r.type as ScrapeType)
    ? (r.type as ScrapeType)
    : 'all';

  const sinceAfter = typeof r.sinceAfter === 'string' && r.sinceAfter ? r.sinceAfter : undefined;
  const before = typeof r.before === 'string' && r.before ? r.before : undefined;

  return {
    accountId,
    username,
    type,
    ...(sinceAfter !== undefined && { sinceAfter }),
    ...(before !== undefined && { before }),
    scrolls: clampInt(r.scrolls, 5, 1, 100),
    max: clampInt(r.max, 200, 1, 5000),
    delayMs: clampInt(r.delayMs, 900, 200, 10000),
  };
}

/**
 * Creates the start/cancel handlers for one registerIpc() call. In-flight job state (the
 * AbortController per jobId) lives in a closure-local map — mirrors the `sessions` map in
 * services/ai.ts. Progress/done are pushed to the renderer via `deps.getWindow()`, never
 * returned from `start` itself (which only hands back the jobId).
 */
export function createGhostScrapeHandlers(deps: GhostScrapeIpcDeps): {
  start(rawCfg: unknown): Promise<{ jobId: string }>;
  cancel(rawJobId: unknown): Promise<void>;
} {
  const controllers = new Map<string, AbortController>();

  function sendProgress(jobId: string, p: { captured: number; scrollsDone: number }): void {
    const w = deps.getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send(channels.ghostscrape.onProgress, { jobId, ...p });
    }
  }

  function sendDone(jobId: string, d: { result?: Awaited<ReturnType<typeof runScrapeJob>>; error?: string }): void {
    const w = deps.getWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send(channels.ghostscrape.onDone, { jobId, ...d });
    }
  }

  return {
    async start(rawCfg: unknown): Promise<{ jobId: string }> {
      // EGRESS GATE — both flags required before the hidden browser ever opens (spec §3.1,
      // mirrored from x/ipc.ts's handleXCollect).
      if (!await deps.networkEnabled() || !await deps.clearnetAcknowledged()) {
        throw new GhostScrapeGatedError();
      }

      const cfg = toConfig(rawCfg);
      const jobId = randomUUID();
      const controller = new AbortController();
      controllers.set(jobId, controller);

      // Fire-and-forget: start() resolves with the jobId immediately; the job itself reports
      // via onProgress/onDone pushes so the renderer isn't left blocked on a long-running invoke.
      void runScrapeJob(
        cfg,
        {
          getSecret: deps.getSecret,
          onProgress: (p) => sendProgress(jobId, p),
        },
        controller.signal,
      )
        .then((result) => sendDone(jobId, { result }))
        .catch((err: unknown) => {
          sendDone(jobId, { error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          controllers.delete(jobId);
        });

      return { jobId };
    },

    async cancel(rawJobId: unknown): Promise<void> {
      const jobId = typeof rawJobId === 'string' ? rawJobId : '';
      controllers.get(jobId)?.abort();
    },
  };
}
