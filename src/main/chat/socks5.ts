/**
 * Minimal SOCKS5 client codec (RFC 1928), no-auth — used to dial a peer's `.onion` through Tor's
 * local SOCKS port. Pure byte builders + incremental parsers (no sockets here), so the protocol is
 * unit-testable; transport-tor.ts drives a real net.Socket with these.
 *
 * Onion addresses are sent as SOCKS5 domain names (ATYP=0x03) so Tor does the name resolution.
 */

export class Socks5Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Socks5Error';
  }
}

const VER = 0x05;
const METHOD_NOAUTH = 0x00;
const METHOD_USERPASS = 0x02;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

/** Client greeting. Default offers only "no authentication" (chat onion dialing).
 *  `{ auth: true }` additionally offers username/password (RFC 1929) for Tor IsolateSOCKSAuth. */
export function buildGreeting(opts: { auth?: boolean } = {}): Uint8Array {
  return opts.auth ? Uint8Array.of(VER, 2, METHOD_NOAUTH, METHOD_USERPASS) : Uint8Array.of(VER, 1, METHOD_NOAUTH);
}

/** Parse the server's method selection. Returns null until 2 bytes; `ok` iff a method we offered
 *  was chosen (not 0xFF), and the chosen `method` so the caller knows whether to do the userpass
 *  sub-negotiation. */
export function parseMethodSelection(buf: Uint8Array): { ok: boolean; method: number } | null {
  if (buf.length < 2) return null;
  if (buf[0] !== VER) throw new Socks5Error(`bad SOCKS version ${buf[0]}`);
  return { ok: buf[1] !== 0xff, method: buf[1] };
}

/** RFC 1929 auth request: VER(0x01) ULEN user PLEN pass. */
export function buildUserPassAuth(user: string, pass: string): Uint8Array {
  const u = new TextEncoder().encode(user), p = new TextEncoder().encode(pass);
  if (u.length < 1 || u.length > 255 || p.length < 1 || p.length > 255) throw new Socks5Error('SOCKS credential length out of range');
  const out = new Uint8Array(1 + 1 + u.length + 1 + p.length);
  out[0] = 0x01; out[1] = u.length; out.set(u, 2); out[2 + u.length] = p.length; out.set(p, 3 + u.length);
  return out;
}

/** RFC 1929 auth reply: VER STATUS. Returns null until 2 bytes; `ok` iff STATUS === 0. */
export function parseUserPassReply(buf: Uint8Array): { ok: boolean } | null {
  if (buf.length < 2) return null;
  return { ok: buf[1] === 0x00 };
}

/** CONNECT request to a domain (the onion host) + port. */
export function buildConnectDomain(host: string, port: number): Uint8Array {
  const hostBytes = new TextEncoder().encode(host);
  if (hostBytes.length === 0 || hostBytes.length > 255) throw new Socks5Error('host length out of range');
  if (!Number.isInteger(port) || port < 1 || port > 0xffff) throw new Socks5Error('bad port');
  const out = new Uint8Array(4 + 1 + hostBytes.length + 2);
  out[0] = VER;
  out[1] = CMD_CONNECT;
  out[2] = 0x00; // RSV
  out[3] = ATYP_DOMAIN;
  out[4] = hostBytes.length;
  out.set(hostBytes, 5);
  out[5 + hostBytes.length] = (port >> 8) & 0xff;
  out[6 + hostBytes.length] = port & 0xff;
  return out;
}

/**
 * Parse a CONNECT reply. The bound-address length depends on ATYP, so this returns `null` until the
 * full reply has arrived, then `{ ok, rep, consumed }`. `ok` is true iff REP=0x00 (success).
 */
export function parseConnectReply(buf: Uint8Array): { ok: boolean; rep: number; consumed: number } | null {
  if (buf.length < 4) return null;
  if (buf[0] !== VER) throw new Socks5Error(`bad SOCKS version ${buf[0]}`);
  const rep = buf[1];
  const atyp = buf[3];
  let addrLen: number;
  if (atyp === ATYP_IPV4) addrLen = 4;
  else if (atyp === ATYP_IPV6) addrLen = 16;
  else if (atyp === ATYP_DOMAIN) {
    if (buf.length < 5) return null;
    addrLen = 1 + buf[4];
  } else throw new Socks5Error(`bad ATYP ${atyp}`);
  const total = 4 + addrLen + 2; // header + addr + port
  if (buf.length < total) return null;
  return { ok: rep === 0x00, rep, consumed: total };
}

/** Human label for a non-zero REP code (for diagnostics). */
export function socksReplyMessage(rep: number): string {
  const m: Record<number, string> = {
    0x00: 'succeeded',
    0x01: 'general SOCKS server failure',
    0x02: 'connection not allowed',
    0x03: 'network unreachable',
    0x04: 'host unreachable',
    0x05: 'connection refused',
    0x06: 'TTL expired',
    0x07: 'command not supported',
    0x08: 'address type not supported'
  };
  return m[rep] ?? `unknown SOCKS error ${rep}`;
}
