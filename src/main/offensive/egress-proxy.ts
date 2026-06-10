import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { decide } from './scope-enforcer';
import type { ScopeManifest } from './scope-manifest';
import { resolveAll as defaultResolveAll, dialPinned } from './pin-dial';
import type { EngagementAudit } from './engagement-audit';

export interface ProxyOptions {
  manifest: ScopeManifest;
  audit: EngagementAudit;
  resolveAll?: (host: string) => Promise<string[]>;
  now?: () => number;
  rateLimitPerSec?: number;
}

export class AuthorizedEgressProxy {
  private server: Server | null = null;
  private tokens: number;
  private lastRefill: number;
  private readonly resolveAll: (host: string) => Promise<string[]>;
  private readonly now: () => number;
  private readonly rate: number;

  constructor(private readonly opts: ProxyOptions) {
    this.resolveAll = opts.resolveAll ?? defaultResolveAll;
    this.now = opts.now ?? Date.now;
    this.rate = opts.rateLimitPerSec ?? 10;
    this.tokens = this.rate;
    this.lastRefill = this.now();
  }

  private take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.rate, this.tokens + ((t - this.lastRefill) / 1000) * this.rate);
    this.lastRefill = t;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }

  private async authorize(host: string): Promise<{ ip: string } | { deny: string }> {
    let ips: string[];
    try { ips = await this.resolveAll(host); } catch { return { deny: 'resolve failed' }; }
    let d;
    try { d = decide(this.opts.manifest, { host, ips }, this.now()); } catch { return { deny: 'enforcer error' }; }
    if (!d.allow) return { deny: d.reason };
    return { ip: ips[0] };
  }

  /** Fail-closed: returns false if the audit write throws (caller must then DENY). */
  private audit(
    host: string, dialedIp: string, port: number, method: string,
    decision: 'allowed' | 'denied', reason?: string
  ): boolean {
    try {
      this.opts.audit.record({
        manifestId: this.opts.manifest.manifestId,
        manifestContentHash: '',
        host, dialedIp, port, method, decision, reason,
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
    const r = await this.authorize(target.hostname);
    if ('deny' in r) {
      this.audit(target.hostname, '', port, req.method ?? 'GET', 'denied', r.deny);
      res.writeHead(403).end('out of scope');
      return;
    }
    // fail-closed: audit BEFORE forwarding; if audit throws, deny.
    if (!this.audit(target.hostname, r.ip, port, req.method ?? 'GET', 'allowed')) {
      res.writeHead(500).end('audit failed');
      return;
    }
    let upstream: Socket;
    try { upstream = await dialPinned(r.ip, port); } catch { res.writeHead(502).end('dial failed'); return; }

    // Build a minimal HTTP/1.1 request to the upstream, stripping proxy headers.
    const headLines = [`${req.method ?? 'GET'} ${target.pathname}${target.search} HTTP/1.1`];
    headLines.push(`Host: ${target.host}`);
    headLines.push('Connection: close');
    for (const [k, v] of Object.entries(req.headers)) {
      if (['host', 'connection', 'proxy-connection', 'proxy-authorization'].includes(k.toLowerCase())) continue;
      headLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : (v ?? '')}`);
    }
    upstream.write(headLines.join('\r\n') + '\r\n\r\n');
    req.pipe(upstream);

    // Parse the upstream HTTP response and relay it back through res.
    // We use a simple state-machine rather than assuming res.socket is writable
    // after writeHead, because in Node's HTTP server the response socket may
    // already be in a half-closed state once we call writeHead.
    let headersDone = false;
    let buf = Buffer.alloc(0);

    const onData = (chunk: Buffer): void => {
      if (headersDone) { res.write(chunk); return; }
      buf = Buffer.concat([buf, chunk]);
      const sep = buf.indexOf('\r\n\r\n');
      if (sep === -1) return;
      // Split header block from body start.
      const headerBlock = buf.subarray(0, sep).toString('ascii');
      const bodyStart = buf.subarray(sep + 4);
      const headerLines = headerBlock.split('\r\n');
      const statusLine = headerLines[0] ?? '';
      const statusMatch = /^HTTP\/\d\.\d (\d+)/.exec(statusLine);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 502;
      const respHeaders: [string, string][] = [];
      for (let i = 1; i < headerLines.length; i++) {
        const colon = headerLines[i].indexOf(':');
        if (colon === -1) continue;
        const name = headerLines[i].slice(0, colon).trim().toLowerCase();
        const val = headerLines[i].slice(colon + 1).trim();
        if (['transfer-encoding', 'connection', 'keep-alive'].includes(name)) continue;
        respHeaders.push([name, val]);
      }
      res.writeHead(statusCode, respHeaders);
      headersDone = true;
      if (bodyStart.length > 0) res.write(bodyStart);
    };

    const onEnd = (): void => { if (!headersDone) { res.writeHead(502).end('bad gateway'); } else { res.end(); } };
    const onErr = (): void => {
      try { if (!headersDone) res.writeHead(502).end('upstream error'); else res.end(); } catch { /* noop */ }
    };
    upstream.on('data', onData);
    upstream.once('end', onEnd);
    upstream.once('error', onErr);
  }

  private async onConnect(req: IncomingMessage, clientSocket: Socket, head: Buffer): Promise<void> {
    const [host, portStr] = (req.url ?? '').split(':');
    const port = Number(portStr || 443);
    if (!this.take()) { clientSocket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    const r = await this.authorize(host);
    if ('deny' in r) {
      this.audit(host, '', port, 'CONNECT', 'denied', r.deny);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    // fail-closed: audit BEFORE forwarding.
    if (!this.audit(host, r.ip, port, 'CONNECT', 'allowed')) {
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
