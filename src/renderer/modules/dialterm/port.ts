import type { DialTermProtocol } from '@shared/post-mvp-types';

export const DEFAULT_PORTS: Record<DialTermProtocol, number> = { ssh: 22, telnet: 23, ftp: 21 };
const KNOWN_DEFAULTS = new Set<number>([22, 23, 21]);

/** When the user changes protocol, only auto-fill the new protocol's default port if the
 *  current port is empty/zero or still a known default — so a custom port (e.g. 2222) is
 *  preserved. Protocol and port are orthogonal; any port 1–65535 is allowed. */
export function nextPortOnProtocolChange(currentPort: number, newProtocol: DialTermProtocol): number {
  if (!currentPort || KNOWN_DEFAULTS.has(currentPort)) return DEFAULT_PORTS[newProtocol];
  return currentPort;
}
