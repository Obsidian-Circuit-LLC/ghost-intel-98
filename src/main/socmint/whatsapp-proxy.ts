/**
 * WA-T4: Baileys SOCKS5 proxy URL builder.
 *
 * Translates a pre-resolved SocmintTransport into the URL string that Baileys'
 * SocksProxyAgent expects.  Returns null for 'direct' (clearnet) mode.
 *
 * Why a URL string rather than a SocksProxyAgent instance?
 *   socks-proxy-agent is a sealed library (NON-NEGOTIABLE: do not add to
 *   package.json).  Constructing the agent happens post-operator-unseal inside
 *   the guarded dynamic import block in makeWhatsAppCollector's connect() method.
 *   This helper is therefore a pure function over plain data — no library import,
 *   fully unit-testable without live Baileys or Tor.
 *
 * Post-unsealing usage (inside the guarded import block):
 *   const proxyUrl = buildBaileysProxy(transport);
 *   // proxyUrl === null   → clearnet (direct)
 *   // proxyUrl === string → socks5://user:pass@127.0.0.1:port
 *   const agent = proxyUrl ? new SocksProxyAgent(proxyUrl) : undefined;
 *   const sock = makeWASocket({ auth, agent, fetchAgent: agent,
 *                               syncFullHistory: false,
 *                               logger: pino({ level: 'silent' }) });
 *
 * Fail-closed invariant (mirrors resolveTransport in tor-identity.ts):
 *   Any transport whose mode is not exactly 'direct' or 'tor' THROWS rather than
 *   silently falling back to clearnet.  Settings-file corruption or an injected
 *   case-variant value must not become a silent deanonymisation.
 *
 * Transport is pre-resolved at the egress boundary (handleStartMonitor / IPC handlers).
 * In 'tor' mode resolveTransport already validated Tor availability and threw
 * SocmintTorUnavailableError when Tor was down — transport arriving here was already
 * fail-closed validated upstream.
 */

import type { SocmintTransport } from './tor-identity';

/**
 * Build the SOCKS5 proxy URL for Baileys from a pre-resolved SocmintTransport.
 *
 * @param transport  Pre-resolved transport (from resolveTransport at the egress boundary).
 * @returns
 *   - `null`  for 'direct' mode — Baileys will use a plain TCP connection.
 *   - A `socks5://user:password@host:port` URL string for 'tor' mode — pass to
 *     `new SocksProxyAgent(url)` inside the sealed connect() block (post-unseal).
 *
 * Throws for any mode that is not exactly 'direct' or 'tor' (fail-closed; no
 * clearnet fallback on unknown/corrupted mode).
 */
export function buildBaileysProxy(transport: SocmintTransport): string | null {
  if (transport.mode === 'direct') {
    return null;
  }

  if (transport.mode === 'tor') {
    const { host, port, user, password } = transport.proxy;
    return `socks5://${user}:${password}@${host}:${port}`;
  }

  // TypeScript exhaustiveness guard + runtime fail-closed enforcement.
  // Any corrupted / case-variant / tampered mode value hits this branch and throws
  // rather than silently falling back to clearnet.
  const unknown = (transport as { mode: unknown }).mode;
  throw new Error(
    `SOCMINT: unknown transport mode '${String(unknown)}' — refusing (fail closed; no clearnet fallback)`,
  );
}
