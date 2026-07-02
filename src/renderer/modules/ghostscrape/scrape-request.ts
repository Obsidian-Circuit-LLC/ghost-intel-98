/**
 * GhostScrape (Task 7) — pure scrape-request builder + gate logic.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native
 * Electron primitives.
 *
 * No DOM, no React, no Electron — importable in the vitest node environment.
 * Mirrors src/renderer/modules/x/x-collect-request.ts: the panel builds the
 * IPC config through buildScrapeRequest and gates the Start button through
 * canScrape, so the test-verified logic is exactly what the component executes.
 *
 * GhostScrape reuses the SAME two-flag X clearnet gate (settings.x.networkEnabled
 * && settings.x.clearnetAcknowledged) — no settings.ghostscrape namespace.
 */

import type { GhostScrapeConfig, ScrapeType } from '@shared/ipc-contracts';

const SCROLLS_MIN = 1;
const SCROLLS_MAX = 200;
const SCROLLS_DEFAULT = 10;

const MAX_MIN = 1;
const MAX_MAX = 5000;
const MAX_DEFAULT = 200;

const DELAY_MS_MIN = 250;
const DELAY_MS_MAX = 10000;
const DELAY_MS_DEFAULT = 1500;

/** Clamp to [min, max], flooring to an integer; non-finite input falls back to min. */
function clampInt(n: number | undefined, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** Inputs for building one GhostScrape config from panel state. */
export interface BuildScrapeRequestParams {
  accountId: string;
  username: string;
  type: ScrapeType;
  /** ISO date string; omitted (not empty-string) when unset. */
  sinceAfter?: string;
  /** ISO date string; omitted (not empty-string) when unset. */
  before?: string;
  scrolls?: number;
  max?: number;
  delayMs?: number;
}

/**
 * Build the GhostScrapeConfig sent to window.api.ghostscrape.start.
 *
 * Trims the username and strips a leading '@' (the shared X handle-input
 * convention, mirrored from buildXCollectRequest); clamps scrolls/max/delayMs
 * to sane bounds so a malformed/absent panel input can never launch a
 * runaway or zero-effort job.
 */
export function buildScrapeRequest(p: BuildScrapeRequestParams): GhostScrapeConfig {
  const username = (p.username ?? '').trim().replace(/^@+/, '');
  const sinceAfter = (p.sinceAfter ?? '').trim();
  const before = (p.before ?? '').trim();

  const cfg: GhostScrapeConfig = {
    accountId: p.accountId,
    username,
    type: p.type,
    scrolls: clampInt(p.scrolls, SCROLLS_DEFAULT, SCROLLS_MIN, SCROLLS_MAX),
    max: clampInt(p.max, MAX_DEFAULT, MAX_MIN, MAX_MAX),
    delayMs: clampInt(p.delayMs, DELAY_MS_DEFAULT, DELAY_MS_MIN, DELAY_MS_MAX)
  };
  if (sinceAfter) cfg.sinceAfter = sinceAfter;
  if (before) cfg.before = before;
  return cfg;
}

/** Inputs for the Start-scrape guard. */
export interface CanScrapeParams {
  networkEnabled: boolean;
  clearnetAcknowledged: boolean;
  accountId: string;
  username: string;
  running: boolean;
}

/**
 * Whether the Start button may fire.
 *
 * Requires BOTH X clearnet gate flags open, a selected account, a
 * non-empty username, and no job already running.
 */
export function canScrape(p: CanScrapeParams): boolean {
  if (!p.networkEnabled || !p.clearnetAcknowledged) return false;
  if (p.running) return false;
  if (!p.accountId.trim()) return false;
  if (!p.username.trim()) return false;
  return true;
}
