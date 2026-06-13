import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { decide } from './scope-enforcer';
import { withDefaultExcludes, scopeContentHash, type ScopeManifest } from './scope-manifest';
import { cidrContains } from './net-match';
import { resolveAll as defaultResolveAll, dialPinned } from './pin-dial';
import type { EngagementAudit } from './engagement-audit';

export interface ProxyOptions {
  manifest: ScopeManifest;
  audit: EngagementAudit;
  resolveAll?: (host: string) => Promise<string[]>;
  now?: () => number;
  /** Monotonic clock (ms) for the token-bucket refill. Default `performance.now`.
   *  Distinct from `now` (wall-clock, used for audit timestamps): a wall-clock jump
   *  must never refill the bucket above its cap (red-team finding H4). */
  monotonic?: () => number;
  rateLimitPerSec?: number;
}

/** Parse a CONNECT authority like `host:port` or `[::1]:443` correctly. */
function parseHostPort(authority: string): { host: string; port: number } | null {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) return null;
    const host = authority.slice(1, end);
    const rest = authority.slice(end + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : 443;
    return { host, port };
  }
  const i = authority.lastIndexOf(':');
  if (i < 0) return { host: authority, port: 443 };
  return { host: authority.slice(0, i), port: Number(authority.slice(i + 1)) };
}

export class AuthorizedEgressProxy {
  private server: Server | null = null;
  private tokens: number;
  private lastRefill: number;
  private readonly resolveAll: (host: string) => Promise<string[]>;
  private readonly now: () => number;
  private readonly mono: () => number;
  private readonly rate: number;
  private readonly manifest: ScopeManifest;

  constructor(private readonly opts: ProxyOptions) {
    this.manifest = withDefaultExcludes(opts.manifest);
    this.resolveAll = opts.resolveAll ?? defaultResolveAll;
    this.now = opts.now ?? Date.now;
    this.mono = opts.monotonic ?? (() => performance.now());
    this.rate = opts.rateLimitPerSec ?? 10;
    this.tokens = this.rate;
    this.lastRefill = this.mono();
  }

  private take(): boolean {
    // Refill off a MONOTONIC clock (H4): a forward wall-clock step must not refill
    // above the cap. Clamp negative deltas to 0 defensively (a monotonic source
    // should never go backwards, but a buggy/injected one might).
    const t = this.mono();
    const delta = Math.max(0, t - this.lastRefill);
    this.tokens = Math.min(this.rate, this.tokens + (delta / 1000) * this.rate);
    this.lastRefill = t;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }

  /** First resolved IP not matched by any `exclude` cidr rule, or null if all are excluded.
   *  Belt-and-suspenders on which IP gets dialed: even when `decide()` allowed (host matched
   *  a domain include), we must never dial an excluded IP (red-team finding M2). */
  private pinNonExcluded(ips: string[]): string | null {
    const cidrExcludes = this.manifest.exclude.filter((r) => r.kind === 'cidr');
    for (const ip of ips) {
      if (!cidrExcludes.some((r) => cidrContains(r.value, ip))) return ip;
    }
    return null;
  }

  private async authorize(host: string): Promise<{ ip: string; ips: string[] } | { deny: string; ips: string[] }> {
    let ips: string[];
    try { ips = await this.resolveAll(host); } catch { return { deny: 'resolve failed', ips: [] }; }
    let d;
    try { d = decide(this.manifest, { host, ips }, this.now()); } catch { return { deny: 'enforcer error', ips }; }
    if (!d.allow) return { deny: d.reason, ips };
    // decide() is the allow/deny authority; pinNonExcluded is belt-and-suspenders on
    // WHICH resolved IP gets dialed — never an excluded one even though the host matched.
    const pinned = this.pinNonExcluded(ips);
    if (pinned === null) return { deny: 'all resolved IPs excluded', ips };
    // NEW-1 belt-and-suspenders: the resolver should only ever hand back canonical IP literals, but
    // if some future seam returns a non-literal string (e.g. a decimal/hex/octal encoding of an
    // internal address that the cidr exclude can't match), getaddrinfo on the dial path would accept
    // it => SSRF. Assert isIP() here so a non-literal can NEVER reach httpRequest/dialPinned.
    if (isIP(pinned) === 0) return { deny: 'non-literal dial host', ips };
    return { ip: pinned, ips };
  }

  /** Fail-closed: returns false if the audit write throws (caller must then DENY). */
  private audit(
    host: string, dialedIp: string, port: number, method: string,
    decision: 'allowed' | 'denied', resolvedIps: string[], reason?: string
  ): boolean {
    try {
      this.opts.audit.record({
        manifestId: this.manifest.manifestId,
        manifestContentHash: scopeContentHash(this.manifest),
        host, dialedIp, port, method, decision, reason,
        resolvedIps,
        at: new Date(this.now()).toISOString()
      });
      return true;
    } catch { return false; }
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.take()) { res.writeHead(429).end('rate limited'); return; }
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end('bad target'); return; }
    const port = Number(target.port || 80);
    // SHOULD-FIX 5: validate port before authorizing
    if (!Number.isInteger(port) || port <= 0 || port > 65535) { res.writeHead(400).end('bad port'); return; }
    const r = await this.authorize(target.hostname);
    if ('deny' in r) {
      this.audit(target.hostname, '', port, req.method ?? 'GET', 'denied', r.ips, r.deny);
      res.writeHead(403).end('out of scope');
      return;
    }
    // fail-closed: audit BEFORE forwarding; if audit throws, deny.
    if (!this.audit(target.hostname, r.ip, port, req.method ?? 'GET', 'allowed', r.ips)) {
      res.writeHead(500).end('audit failed');
      return;
    }

    // BLOCKING FIX 2: use node:http request forwarding to the pinned IP.
    // host: r.ip ensures Node does NOT re-resolve (pin preserved).
    // setHost: false keeps our explicit Host header so the upstream sees the correct SNI/vhost.
    const headers = { ...req.headers, host: target.host };
    const upstream = httpRequest(
      { host: r.ip, port, method: req.method, path: `${target.pathname}${target.search}`, headers, setHost: false },
      (ures) => { res.writeHead(ures.statusCode ?? 502, ures.headers); ures.pipe(res); }
    );
    upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); } res.end('upstream error'); });
    // SHOULD-FIX 4: teardown on client abort
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  private async onConnect(req: IncomingMessage, clientSocket: Socket, head: Buffer): Promise<void> {
    // SHOULD-FIX 6: parse IPv6 CONNECT authority correctly
    const parsed = parseHostPort(req.url ?? '');
    if (!parsed) { clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const { host, port } = parsed;
    // SHOULD-FIX 5: validate port before authorizing
    if (!Number.isInteger(port) || port <= 0 || port > 65535) { clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (!this.take()) { clientSocket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    const r = await this.authorize(host);
    if ('deny' in r) {
      this.audit(host, '', port, 'CONNECT', 'denied', r.ips, r.deny);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    // fail-closed: audit BEFORE forwarding.
    if (!this.audit(host, r.ip, port, 'CONNECT', 'allowed', r.ips)) {
      clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      return;
    }
    let upstream: Socket;
    try { upstream = await dialPinned(r.ip, port); } catch { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    const kill = (): void => {
      try { upstream.destroy(); } catch { /* noop */ }
      try { clientSocket.destroy(); } catch { /* noop */ }
    };
    upstream.once('error', kill);
    clientSocket.once('error', kill);
    // SHOULD-FIX 4: also teardown on close/end, not just error
    upstream.once('close', kill);
    clientSocket.once('close', kill);
  }

  start(): Promise<{ port: number }> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.onRequest(req, res));
      server.on('connect', (req, sock, head) => void this.onConnect(req, sock as Socket, head));
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        resolve({ port: (server.address() as { port: number }).port });
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}
