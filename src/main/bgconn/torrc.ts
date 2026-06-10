export interface BgconnTorrcConfig { socksPort: number; controlPort: number; dataDir: string; }

/** Separate Tor instance for the bgconn lane. IsolateSOCKSAuth gives each connection (distinct
 *  SOCKS user/pass) its own circuit; IsolateDestAddr further separates by destination. Loopback
 *  only, no relaying. Distinct from the chat transport's torrc (which has neither isolation flag). */
export function buildBgconnTorrc(c: BgconnTorrcConfig): string {
  return [
    `SocksPort 127.0.0.1:${c.socksPort} IsolateSOCKSAuth IsolateDestAddr`,
    `ControlPort 127.0.0.1:${c.controlPort}`,
    `CookieAuthentication 1`,
    `DataDirectory ${c.dataDir}`,
    `SocksPolicy accept *`,
    ''
  ].join('\n');
}
