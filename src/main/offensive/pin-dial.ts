import { lookup as dnsLookup } from 'node:dns/promises';
import { get as httpsGetRaw } from 'node:https';
import { connect, type Socket } from 'node:net';

type LookupFn = (host: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>;

/**
 * Trusted DoH endpoint. Offensive traffic is non-anonymous clearnet, so resolving
 * target names over a cert-validated HTTPS DoH endpoint (rather than the SYSTEM
 * resolver via getaddrinfo) avoids leaking every target name to the local/ISP/
 * poisoned resolver before the scope decision is made (red-team finding H1).
 *
 * RFC 8484 JSON API (`application/dns-json`):
 *   GET https://<endpoint>?name=<host>&type=A   (and &type=AAAA)
 *   header: Accept: application/dns-json
 */
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/** dns-json record type numbers we accept. */
const DNS_TYPE_A = 1;
const DNS_TYPE_AAAA = 28;

/** Injectable HTTPS-GET seam: returns the status and body of a GET request. */
type HttpsGetFn = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

interface DnsJsonAnswer { name: string; type: number; data: string }
interface DnsJsonResponse { Status?: number; Answer?: DnsJsonAnswer[] }

/**
 * Real HTTPS GET over node:https. Cert validation is ON by default (node:https) —
 * it is NOT disabled here, and must not be.
 */
function defaultHttpsGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsGetRaw(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once('error', reject);
    req.end();
  });
}

function parseAnswers(body: string, wanted: number): string[] {
  let json: DnsJsonResponse;
  try { json = JSON.parse(body) as DnsJsonResponse; } catch { return []; }
  if (!Array.isArray(json.Answer)) return [];
  return json.Answer.filter((a) => a.type === wanted).map((a) => a.data);
}

async function queryType(host: string, type: 'A' | 'AAAA', endpoint: string, httpsGet: HttpsGetFn): Promise<string[]> {
  const url = `${endpoint}?name=${encodeURIComponent(host)}&type=${type}`;
  const { status, body } = await httpsGet(url, { Accept: 'application/dns-json' });
  if (status !== 200) throw new Error(`DoH ${type} query failed: status ${status}`);
  return parseAnswers(body, type === 'A' ? DNS_TYPE_A : DNS_TYPE_AAAA);
}

export interface DohResolveOptions {
  endpoint?: string;
  httpsGet?: HttpsGetFn;
}

/**
 * Resolve a host over DoH, returning the merged A + AAAA address set.
 * Throws on any DoH transport error or non-200 status. An empty merged set is
 * returned as-is (the fail-closed decision is made by the caller, resolveAll).
 */
export async function dohResolve(host: string, opts: DohResolveOptions = {}): Promise<string[]> {
  const endpoint = opts.endpoint ?? DOH_ENDPOINT;
  const httpsGet = opts.httpsGet ?? defaultHttpsGet;
  const [a, aaaa] = await Promise.all([
    queryType(host, 'A', endpoint, httpsGet),
    queryType(host, 'AAAA', endpoint, httpsGet)
  ]);
  return [...a, ...aaaa];
}

export interface ResolveAllOptions extends DohResolveOptions {
  /**
   * Explicit opt-in to the SYSTEM resolver (node:dns getaddrinfo). This path
   * leaks the target name to the local/ISP resolver and is OFF by default. Only
   * enable when a DNS leak is acceptable for the caller's threat model.
   */
  useSystemResolver?: boolean;
  /** Injectable system-resolver seam (back-compat / tests). */
  lookup?: LookupFn;
}

/**
 * Resolve a host to a list of IPs.
 *
 * Default: resolves over a trusted DoH endpoint (cert-validated HTTPS), avoiding
 * the system resolver entirely. FAIL-CLOSED — on DoH error, non-200, or an empty
 * answer set, this REJECTS. It does NOT silently fall back to getaddrinfo, which
 * would reintroduce the H1 DNS leak.
 *
 * Opt-in system resolver: `resolveAll(host, { useSystemResolver: true })` uses
 * getaddrinfo (documented leak; off by default).
 *
 * The default call shape `resolveAll(host)` is preserved for egress-proxy's
 * `defaultResolveAll` usage.
 */
export async function resolveAll(host: string, opts: ResolveAllOptions = {}): Promise<string[]> {
  if (opts.useSystemResolver) {
    const lookup = opts.lookup ?? (dnsLookup as unknown as LookupFn);
    const recs = await lookup(host, { all: true });
    return recs.map((r) => r.address);
  }
  const ips = await dohResolve(host, { endpoint: opts.endpoint, httpsGet: opts.httpsGet });
  if (ips.length === 0) throw new Error(`DoH resolution returned no records for ${host}`);
  return ips;
}

export function dialPinned(ip: string, port: number, timeoutMs = 15000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: ip, port });
    const onErr = (e: Error): void => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => onErr(new Error('dial timeout')));
    sock.once('error', onErr);
    sock.once('connect', () => { sock.setTimeout(0); sock.removeListener('error', onErr); resolve(sock); });
  });
}
