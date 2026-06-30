/**
 * Pure collect-request logic for the X/Twitter collector UI (v3.24.2 fix).
 *
 * No DOM, no React, no Electron — importable in the vitest node environment.
 * XCollectPanel imports buildXCollectRequest/canCollect from here so the
 * test-verified logic is exactly what the component executes.
 *
 * WHY THIS EXISTS (regression guard):
 *   The previous inline panel logic built the IPC collect request with only
 *   {caseId, mode, query|username, limit} and never threaded an accountId.
 *   handleXCollect only attaches stored credentials when req.accountId is
 *   present (src/main/x/ipc.ts:254,291), so harvests ran against an empty
 *   twscrape account pool → near-zero results even when the user had stored a
 *   valid cookie. buildXCollectRequest now carries accountId, and canCollect
 *   refuses to launch a guaranteed-empty anonymous harvest.
 */

export type XCollectMode = 'search' | 'userTweets';

/** Inputs for building one X collect request. */
export interface XCollectBuildParams {
  caseId: string;
  mode: XCollectMode;
  /** Required (after trim) when mode === 'search'. */
  query?: string;
  /** Required (after trim, leading @ stripped) when mode === 'userTweets'. */
  username?: string;
  /** Optional max-results cap; only carried when a positive finite integer. */
  limit?: number;
  /** The selected stored account's ID; only carried when non-empty. */
  accountId?: string;
}

/** The IPC request object sent to window.api.x.collect. */
export interface XCollectRequest {
  caseId: string;
  mode: XCollectMode;
  query?: string;
  username?: string;
  limit?: number;
  accountId?: string;
}

/**
 * Build the IPC collect request from panel inputs.
 *
 * Mirrors the field-shaping the main handler expects (handleXCollect):
 *   - search mode carries a trimmed query; userTweets carries a @-stripped username
 *   - limit is only included when a positive finite integer
 *   - accountId is only included when non-empty (the fix — without it the harvest
 *     runs anonymously and returns nothing useful)
 */
export function buildXCollectRequest(p: XCollectBuildParams): XCollectRequest {
  const accountId = (p.accountId ?? '').trim();
  const limitOk = typeof p.limit === 'number' && Number.isFinite(p.limit) && p.limit > 0;
  const req: XCollectRequest = {
    caseId: p.caseId,
    mode: p.mode,
    ...(p.mode === 'search' ? { query: (p.query ?? '').trim() } : {}),
    ...(p.mode === 'userTweets'
      ? { username: (p.username ?? '').trim().replace(/^@/, '') }
      : {}),
    ...(limitOk ? { limit: Math.floor(p.limit as number) } : {}),
    ...(accountId ? { accountId } : {}),
  };
  return req;
}

/** Inputs for the collect-enabled guard. */
export interface XCanCollectParams {
  gateOpen: boolean;
  collecting: boolean;
  caseId: string;
  mode: XCollectMode;
  query: string;
  username: string;
  accountId: string;
}

/**
 * Whether the Collect button may fire.
 *
 * Requires: the clearnet gate open, not already collecting, a case id, a
 * SELECTED ACCOUNT, and the mode-appropriate input. Requiring an account is the
 * load-bearing guard — twscrape returns nothing without one, so allowing an
 * accountless "Collect" would silently waste the operator's time.
 */
export function canCollect(p: XCanCollectParams): boolean {
  if (!p.gateOpen || p.collecting) return false;
  if (!p.caseId.trim()) return false;
  if (!p.accountId.trim()) return false;
  return p.mode === 'search' ? !!p.query.trim() : !!p.username.trim();
}
