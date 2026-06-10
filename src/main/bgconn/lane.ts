import { randomBytes } from 'node:crypto';

export interface SocksCreds { username: string; password: string; }
export type Routing = 'tor' | 'direct';
export interface Lane { direct: boolean; socks?: { host: string; port: number; username: string; password: string }; }

/** Distinct per-connection SOCKS credentials → distinct Tor circuit via IsolateSOCKSAuth. */
export function newSocksCreds(): SocksCreds {
  return { username: randomBytes(8).toString('hex'), password: randomBytes(16).toString('hex') };
}

export function laneFor(
  o: { routing: 'tor'; socksHost: string; socksPort: number; creds: SocksCreds } | { routing: 'direct' }
): Lane {
  if (o.routing === 'direct') return { direct: true };
  return { direct: false, socks: { host: o.socksHost, port: o.socksPort, username: o.creds.username, password: o.creds.password } };
}
