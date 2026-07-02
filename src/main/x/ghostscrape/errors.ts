/**
 * GhostScrape — typed job errors + a renderer-safe error mapper.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native Electron primitives.
 *
 * Clearnet quarantine (mirrored from src/main/x/ipc.ts): this module makes no network call and
 * imports nothing outside src/main/x/. It exists so the error classes and the renderer-facing
 * mapper live in one dependency-free place (ipc.ts + job.ts both import from here — no cycle).
 *
 * SECURITY: `safeJobErrorMessage` NEVER returns a raw `err.message`. A thrown error can embed a
 * filesystem path, an account id, or (worst case) a credential token; those must stay in the
 * main-process log only and never cross the IPC boundary to the renderer (per the OpSec posture).
 * Every job failure the renderer sees is one of a small set of fixed, actionable sentences.
 */

/**
 * Thrown by start() when the shared X clearnet egress gate is closed. Mirrors
 * XCollectorGatedError (src/main/x/ipc.ts) — same two flags, same "throw, don't silently skip"
 * posture so the UI layer must handle it explicitly.
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

/** Thrown when the account referenced by `cfg.accountId` has no usable X session cookies
 * (auth_token/ct0) in the injected secret store. */
export class GhostScrapeNoCredsError extends Error {
  constructor(accountId: string) {
    super(
      `GhostScrape: no X session cookies stored for account "${accountId}" ` +
      '(x.accounts.<accountId>.{auth_token,ct0}). Add the account in X Intel first.',
    );
    this.name = 'GhostScrapeNoCredsError';
  }
}

/**
 * Map any job error to a FIXED, safe, actionable sentence for the renderer. Never returns the
 * raw message — see the SECURITY note above. Unknown errors collapse to a generic sentence; the
 * caller logs the raw error to the main-process console for debugging.
 */
export function safeJobErrorMessage(err: unknown): string {
  if (err instanceof GhostScrapeGatedError) {
    return 'Scrape blocked — enable X network and acknowledge the clearnet warning in Settings → X.';
  }
  if (err instanceof GhostScrapeNoCredsError) {
    return 'No stored X session for the selected account — add its cookies in X Intel first.';
  }
  return 'Scrape failed. Check the app log for details.';
}
