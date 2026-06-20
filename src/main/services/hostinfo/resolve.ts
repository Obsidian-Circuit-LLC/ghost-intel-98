// Resolver orchestration. Pure over injected deps (fetchJson = a Tor GET→JSON; now = ISO clock), so
// tests need no network. Each lookup is independent: a failure records into errors[] and the rest
// proceed; the partial HostInfo is always returned, never thrown. fetchJson MUST route through Tor
// (wired in the IPC handler) — this module never imports a fetch directly.
import { hostFromStreamUrl } from './extract';
import { parseDohA, parseDohPtr, parseIpRdap } from './parse';
import type { HostInfo } from './types';

export interface ResolveDeps { fetchJson(url: string): Promise<unknown>; now(): string }

const DOH = 'https://cloudflare-dns.com/dns-query';

/** Build the in-addr.arpa / ip6.arpa PTR query name for an IPv4 address (IPv6 omitted — best effort). */
function ptrName(ip: string): string | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[4]}.${m[3]}.${m[2]}.${m[1]}.in-addr.arpa` : null;
}

export async function resolveHost(streamUrl: string, deps: ResolveDeps): Promise<HostInfo> {
  const parsed = hostFromStreamUrl(streamUrl);
  if (!parsed) {
    return { host: '', isIpLiteral: false, ips: [], resolvedAt: deps.now(), errors: ['bad-url'] };
  }
  const errors: string[] = [];
  let ips: string[] = [];
  // 1. DNS A (only when host is a domain).
  if (parsed.isIpLiteral) {
    ips = [parsed.host];
  } else {
    try {
      ips = parseDohA(await deps.fetchJson(`${DOH}?name=${encodeURIComponent(parsed.host)}&type=A`));
      if (ips.length === 0) errors.push('dns-no-a');
    } catch { errors.push('dns-failed'); }
  }
  const primary = ips[0];
  let ptr: string | undefined;
  let rdap: HostInfo['rdap'];
  if (primary) {
    // 2. Reverse PTR.
    const pn = ptrName(primary);
    if (pn) {
      try { ptr = parseDohPtr(await deps.fetchJson(`${DOH}?name=${encodeURIComponent(pn)}&type=PTR`)); }
      catch { errors.push('ptr-failed'); }
    }
    // 3. RDAP on the IP.
    try {
      const r = parseIpRdap(await deps.fetchJson(`https://rdap.org/ip/${encodeURIComponent(primary)}`));
      if (Object.keys(r).length > 0) rdap = r;
    } catch { errors.push('rdap-failed'); }
  }
  return { host: parsed.host, isIpLiteral: parsed.isIpLiteral, ...(parsed.port ? { port: parsed.port } : {}), ips, ...(ptr ? { ptr } : {}), ...(rdap ? { rdap } : {}), resolvedAt: deps.now(), errors };
}
