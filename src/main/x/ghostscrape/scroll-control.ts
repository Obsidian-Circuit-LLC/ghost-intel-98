/**
 * GhostScrape (Task 3) — pure scroll-continuation decision.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native Electron
 * primitives.
 *
 * Clearnet quarantine (spec §3.2, mirrored from src/main/x/ipc.ts) — this module
 * MUST NOT import from:
 *   src/main/bgconn/*
 *   src/main/chat/transport-tor
 *   src/main/chat/socks5
 *   src/main/searchlight/tor-socks
 *   src/main/socmint/collector
 * All egress is the hidden browser's own clearnet HTTPS to x.com; nothing here
 * makes a network call.
 *
 * Pure decision function only — the scroll loop itself lives in job.ts (Task 5).
 */

export interface ScrollState {
  scrollsDone: number;
  newItemsLastRound: number;
  totalCaptured: number;
  maxScrolls: number;
  maxItems: number;
  emptyRoundsInARow: number;
}

/**
 * True while the scrape loop should keep scrolling.
 *
 * Stops when any of:
 *   - `scrollsDone` has reached `maxScrolls`
 *   - `totalCaptured` has reached `maxItems`
 *   - two (or more) consecutive empty rounds have been seen (`emptyRoundsInARow >= 2`)
 */
export function shouldContinueScroll(s: ScrollState): boolean {
  if (s.scrollsDone >= s.maxScrolls) return false;
  if (s.totalCaptured >= s.maxItems) return false;
  if (s.emptyRoundsInARow >= 2) return false;
  return true;
}
