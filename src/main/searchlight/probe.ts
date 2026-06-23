import { request as httpsRequest } from 'node:https';
import { isPublicHttpUrl, assertResolvedPublic } from '../security/validate';
import { safeFetch } from '../net/safe-fetch';
import { socksDial } from './tor-socks';
import type { RawCheckResult, ProbeErrorType } from '@shared/searchlight/types';

const BODY_CAP = 65536;
const TIMEOUT_MS = 14000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ProbeDeps {
  socksPort?: () => number | null;
  clearnetFetch?: typeof safeFetch;
  dial?: typeof socksDial;
}

export function classifyError(err: NodeJS.ErrnoException): ProbeErrorType {
  const code = err.code || '';
  if (code === 'ENOTFOUND') return 'DNS_ERROR';
  if (['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code)) return 'SSL_ERROR';
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  if (code === 'ETIMEDOUT') return 'TIMEOUT';
  return 'CONNECTION_ERROR';
}

const fail = (error: ProbeErrorType, statusMessage = ''): RawCheckResult =>
  ({ statusCode: 0, statusMessage, elapsed: 0, redirectUrl: null, error, body: '' });

async function guard(targetUrl: string): Promise<URL | null> {
  try {
    if (!isPublicHttpUrl(targetUrl)) return null;
    const u = new URL(targetUrl);
    await assertResolvedPublic(u.hostname);
    return u;
  } catch { return null; }
}

async function probeClearnet(targetUrl: string, fetchBody: boolean, headers: Record<string, string>, fetchImpl: typeof safeFetch): Promise<RawCheckResult> {
  const start = Date.now();
  try {
    const res = await fetchImpl(targetUrl, 4, { 'User-Agent': UA, ...headers });
    let body = '';
    if (fetchBody) body = (await res.text()).slice(0, BODY_CAP);
    return { statusCode: res.status, statusMessage: res.statusText, elapsed: Date.now() - start, redirectUrl: res.headers.get('location'), error: null, body };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const error: ProbeErrorType = e.name === 'TimeoutError' ? 'TIMEOUT' : classifyError(e);
    return { ...fail(error, e.message?.slice(0, 100) ?? ''), elapsed: Date.now() - start };
  }
}

/** Tor path: SOCKS5 CONNECT to host:443 then HTTPS over that socket (Node layers TLS).
 *  Integration-only (live Tor); not run in CI. */
async function probeTor(u: URL, fetchBody: boolean, headers: Record<string, string>, socksPort: number, dial: typeof socksDial): Promise<RawCheckResult> {
  const start = Date.now();
  const port = u.port ? parseInt(u.port, 10) : 443;
  let socket;
  try { socket = await dial(u.hostname, port, socksPort); }
  catch (e) { return { ...fail('CONNECTION_ERROR', (e as Error).message?.slice(0, 100)), elapsed: Date.now() - start }; }

  return await new Promise<RawCheckResult>((resolve) => {
    const req = httpsRequest({
      method: fetchBody ? 'GET' : 'HEAD',
      hostname: u.hostname,
      servername: u.hostname,
      path: u.pathname + u.search,
      createConnection: () => socket as never,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', Connection: 'close', ...headers }
    }, (res) => {
      const code = res.statusCode ?? 0; const msg = res.statusMessage ?? ''; const loc = res.headers.location ?? null;
      if (!fetchBody) { res.destroy(); resolve({ statusCode: code, statusMessage: msg, elapsed: Date.now() - start, redirectUrl: loc, error: null, body: '' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size <= BODY_CAP) chunks.push(c); else res.destroy(); });
      res.on('end', () => resolve({ statusCode: code, statusMessage: msg, elapsed: Date.now() - start, redirectUrl: loc, error: null, body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
      res.on('error', () => resolve({ statusCode: code, statusMessage: msg, elapsed: Date.now() - start, redirectUrl: loc, error: 'READ_ERROR', body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
    });
    req.on('timeout', () => { req.destroy(); socket.destroy(); resolve({ ...fail('TIMEOUT', 'Timeout'), elapsed: Date.now() - start }); });
    req.on('error', (err) => { socket.destroy(); resolve({ ...fail(classifyError(err as NodeJS.ErrnoException), (err as Error).message?.slice(0, 100)), elapsed: Date.now() - start }); });
    req.end();
  });
}

export async function probe(
  targetUrl: string,
  opts: { fetchBody: boolean; headers?: Record<string, string>; useTor: boolean },
  deps: ProbeDeps = {}
): Promise<RawCheckResult> {
  const u = await guard(targetUrl);
  if (!u) return fail('CONNECTION_ERROR', 'blocked non-public target');
  const headers = opts.headers ?? {};
  if (opts.useTor) {
    const port = (deps.socksPort ?? (() => null))();
    if (port == null) return fail('TOR_UNAVAILABLE', 'Tor SOCKS port unavailable');
    return probeTor(u, opts.fetchBody, headers, port, deps.dial ?? socksDial);
  }
  return probeClearnet(u.href, opts.fetchBody, headers, deps.clearnetFetch ?? safeFetch);
}
