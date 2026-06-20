import { isIP } from 'node:net';

/** Pure: pull the host (hostname or IP literal) + optional port out of a camera stream URL.
 *  URL parsing brackets IPv6 hosts ([::1]) — strip the brackets for the bare host. Returns null
 *  for anything that isn't a parseable URL. */
export function hostFromStreamUrl(streamUrl: string): { host: string; isIpLiteral: boolean; port?: string } | null {
  let u: URL;
  try { u = new URL(streamUrl); } catch { return null; }
  if (!u.hostname) return null;
  const host = u.hostname.startsWith('[') && u.hostname.endsWith(']') ? u.hostname.slice(1, -1) : u.hostname;
  const isIpLiteral = isIP(host) !== 0;
  return u.port ? { host, isIpLiteral, port: u.port } : { host, isIpLiteral };
}
