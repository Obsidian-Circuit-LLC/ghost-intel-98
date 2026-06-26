/**
 * Per-burner Tor identity + transport config for SOCMINT.
 *
 * Each burner identity maps to a stable SOCKS5 (user, pass) pair derived from
 * a fixed SOCMINT-specific salt.  Tor's IsolateSOCKSAuth (already set in
 * src/main/bgconn/torrc.ts) maps each distinct credential pair to its own
 * circuit, giving per-burner traffic isolation.
 *
 * Invariants:
 *   - Same burnerId  → same (user, pass)  (stable circuit; no mid-session rotation).
 *   - Distinct burnerIds → distinct (user, pass) (cross-burner isolation).
 *   - burnerProxyConfig ALWAYS throws SocmintTorUnavailableError when the bgconn Tor
 *     is not bootstrapped — it NEVER returns a clearnet / no-proxy config.
 *   - Salt is a hardcoded constant (distinct from CASE_SOCKS_SALT in tor-egress.ts,
 *     which is a per-process random value).  The fixed salt gives cross-restart
 *     burner-identity stability so the same burnerId always routes through the
 *     same credential pair.
 */

import { createHmac } from 'node:crypto';
import { getBgTor } from '../bgconn/tor-singleton';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SocmintTorUnavailableError extends Error {
  constructor(message = 'SOCMINT: Tor not bootstrapped — refusing clearnet fallback') {
    super(message);
    this.name = 'SocmintTorUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Credential derivation
// ---------------------------------------------------------------------------

/**
 * Fixed SOCMINT-specific SOCKS salt.  Hardcoded (not randomBytes) so that the
 * same burnerId consistently produces the same credentials across Electron
 * restarts.  Distinct from CASE_SOCKS_SALT (a per-process random buffer in
 * src/main/plugins/tor-egress.ts) so SOCMINT circuits are compartmented from
 * plugin-egress circuits even if a burnerId string were to collide with a caseId.
 */
const SOCMINT_SOCKS_SALT = Buffer.from(
  'ghost-intel-98:socmint:burner-socks-salt:v1',
  'utf8',
);

/**
 * Derive stable SOCKS5 credentials for a burner identity.
 *
 * Pattern mirrors deriveCaseCredentials in src/main/plugins/tor-egress.ts:41.
 * The HMAC key is [SOCMINT_SOCKS_SALT ‖ burnerId]; 'socks-user' / 'socks-pass'
 * are the distinct messages so user and pass are always different from each other.
 */
export function deriveBurnerCredentials(burnerId: string): { user: string; pass: string } {
  const key = Buffer.concat([SOCMINT_SOCKS_SALT, Buffer.from(burnerId, 'utf8')]);
  return {
    user: createHmac('sha256', key).update('socks-user').digest('hex').slice(0, 16),
    pass: createHmac('sha256', key).update('socks-pass').digest('hex').slice(0, 32),
  };
}

// ---------------------------------------------------------------------------
// Proxy config
// ---------------------------------------------------------------------------

export interface BurnerProxyConfig {
  host: '127.0.0.1';
  port: number;
  version: 5;
  user: string;
  password: string;
}

/**
 * Build the SOCKS5 proxy config for a burner identity.
 *
 * Reads the bgconn Tor socks port from the singleton (the background-connection
 * Tor with IsolateSOCKSAuth set, NOT the chat Tor).
 *
 * Throws SocmintTorUnavailableError when:
 *   - getBgTor() returns null (Tor not started), or
 *   - getBgTor().isBootstrapped() is false (Tor still bootstrapping).
 * Never returns a clearnet or no-proxy config (mirrors cctv-proxy.ts 503-on-Tor-down).
 */
export function burnerProxyConfig(burnerId: string): BurnerProxyConfig {
  const tor = getBgTor();
  if (!tor?.isBootstrapped()) {
    throw new SocmintTorUnavailableError();
  }
  const { user, pass } = deriveBurnerCredentials(burnerId);
  return {
    host: '127.0.0.1',
    port: tor.socksPort(),
    version: 5,
    user,
    password: pass,
  };
}

// ---------------------------------------------------------------------------
// Transport resolution (clearnet vs Tor) — resolved at the egress boundary
// ---------------------------------------------------------------------------

/** Resolved collector transport. 'direct' = clearnet (operator-chosen, explicit).
 *  'tor' = per-burner IsolateSOCKSAuth circuit (proxy carries the SOCKS5 creds). */
export type SocmintTransport =
  | { mode: 'direct' }
  | { mode: 'tor'; proxy: BurnerProxyConfig };

/**
 * Resolve the collector transport for a burner under the chosen mode.
 * - 'tor':  returns { mode:'tor', proxy } — burnerProxyConfig THROWS
 *           SocmintTorUnavailableError when the bgconn Tor is not bootstrapped.
 *           This is the no-silent-clearnet-fallback enforcement point.
 * - 'direct': returns { mode:'direct' } — clearnet, an EXPLICIT operator choice
 *           (settings.socmint.transport='direct'), never an automatic fallback.
 */
export function resolveTransport(burnerId: string, mode: 'direct' | 'tor'): SocmintTransport {
  if (mode === 'tor') return { mode: 'tor', proxy: burnerProxyConfig(burnerId) };
  return { mode: 'direct' };
}
