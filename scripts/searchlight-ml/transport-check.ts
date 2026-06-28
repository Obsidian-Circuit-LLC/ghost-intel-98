/**
 * Clearnet-vs-Tor feature-drift check.
 *
 * Re-fetches a deterministic sample of corpus.csv rows over BOTH clearnet and
 * Tor, extracts features with the same extractor (rowToFeatures), and reports
 * any feature that drifts between transports — excluding response_time, which
 * legitimately varies. An (almost) empty report is evidence the clearnet-built
 * corpus is valid for Tor-time inference.
 *
 * Tor leg uses socks5h:// (hostname resolves INSIDE the circuit — no DNS leak),
 * matching the app's transport invariant. Requires a running Tor SOCKS proxy.
 *
 * Usage:
 *   pnpm ml:transport [--corpus corpus.csv] [--sample 20] [--socks 9050]
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { parseCsv } from '../../src/shared/searchlight/ml/csv';
import { rowToFeatures } from '../../src/shared/searchlight/ml/collect-core';
import { featureDrift } from '../../src/shared/searchlight/ml/drift';
import type { MaigretSiteEntry, RawCheckResult } from '../../src/shared/searchlight/types';

const BODY_CAP = 64 * 1024;
const TIMEOUT_MS = 30_000;
const UA = 'Mozilla/5.0 (compatible; GhostIntel98/3.0 ML-Corpus-Collector)';
const IGNORE = ['response_time']; // legitimately transport-dependent

function parseArgs(): { corpus: string; sample: number; socks: number } {
  const args = process.argv.slice(2);
  let corpus = 'corpus.csv', sample = 20, socks = 9050;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) corpus = args[++i];
    else if (args[i] === '--sample' && args[i + 1]) sample = Number(args[++i]) || sample;
    else if (args[i] === '--socks' && args[i + 1]) socks = Number(args[++i]) || socks;
  }
  return { corpus: path.resolve(corpus), sample, socks };
}

function httpGet(url: string, agent?: http.Agent): Promise<RawCheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(url); } catch { resolve({ statusCode: 0, statusMessage: '', elapsed: 0, redirectUrl: null, error: 'INVALID_URL', body: '' }); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: 'GET', agent, timeout: TIMEOUT_MS, headers: { 'User-Agent': UA, Connection: 'close' } }, (res) => {
      const code = res.statusCode ?? 0;
      const loc = (res.headers.location as string | undefined) ?? null;
      if (code !== 200) { res.resume(); resolve({ statusCode: code, statusMessage: res.statusMessage ?? '', elapsed: Date.now() - start, redirectUrl: loc, error: null, body: '' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size <= BODY_CAP) chunks.push(c); else res.destroy(); });
      res.on('end', () => resolve({ statusCode: code, statusMessage: res.statusMessage ?? '', elapsed: Date.now() - start, redirectUrl: loc, error: null, body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
      res.on('error', () => resolve({ statusCode: code, statusMessage: '', elapsed: Date.now() - start, redirectUrl: loc, error: 'READ_ERROR', body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, statusMessage: '', elapsed: Date.now() - start, redirectUrl: null, error: 'TIMEOUT', body: '' }); });
    req.on('error', (e) => resolve({ statusCode: 0, statusMessage: '', elapsed: Date.now() - start, redirectUrl: null, error: e.message, body: '' }));
    req.end();
  });
}

function siteStub(name: string, url: string): MaigretSiteEntry {
  return { name, url, urlMain: url, urlProbe: '', category: 'social', tags: [], checkType: 'status_code', presenseStrs: [], absenceStrs: [], alexaRank: 0, headers: {}, usernameClaimed: '' };
}

async function main(): Promise<void> {
  const { corpus, sample, socks } = parseArgs();
  if (!fs.existsSync(corpus)) { console.error(`Error: corpus file not found: ${corpus}`); process.exit(1); }
  const { rows } = parseCsv(fs.readFileSync(corpus, 'utf-8'));
  const picked = rows.slice(0, sample); // deterministic: first N rows
  const torAgent = new SocksProxyAgent(`socks5h://127.0.0.1:${socks}`);

  let totalDrift = 0, compared = 0, skipped = 0;
  for (const r of picked) {
    const url = r['url'] ?? '';
    const site = r['site'] ?? '';
    const [clear, tor] = await Promise.all([httpGet(url), httpGet(url, torAgent)]);
    if (clear.error || tor.error || clear.statusCode !== tor.statusCode) {
      skipped++;
      console.log(`  SKIP ${site}: clearnet=${clear.error ?? clear.statusCode} tor=${tor.error ?? tor.statusCode}`);
      continue;
    }
    const vClear = rowToFeatures(siteStub(site, url), clear, url);
    const vTor = rowToFeatures(siteStub(site, url), tor, url);
    const drift = featureDrift(vClear, vTor, IGNORE);
    compared++;
    if (drift.length > 0) {
      totalDrift += drift.length;
      console.log(`  DRIFT ${site}: ${drift.map((d) => `${d.key}(${d.a}≠${d.b})`).join(', ')}`);
    } else {
      console.log(`  ok   ${site}`);
    }
  }
  console.log(`\nTransport check: ${compared} compared, ${skipped} skipped, ${totalDrift} drifting feature(s) beyond ${IGNORE.join('/')}.`);
  console.log(totalDrift === 0 ? 'PASS — clearnet corpus is transport-invariant for inference.' : 'REVIEW — non-response_time features drift; investigate before trusting the clearnet corpus.');
}

main().catch((err) => { console.error('transport-check: fatal error:', err); process.exit(1); });
