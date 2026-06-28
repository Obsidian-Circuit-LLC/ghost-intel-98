/**
 * Soft-404 site scanner: tags sites in corpus.csv as soft-404-prone.
 *
 * For each UNIQUE site in corpus.csv, probes it once over clearnet with a fixed
 * high-entropy fake handle and runs isSoft404Site. If the site answers 200 with
 * no profile markers for a handle that cannot exist, it is soft-404-prone — and
 * `is_soft404_site` is set to 1 for every row of that site. Otherwise 0.
 * The updated corpus.csv is written back in place.
 *
 * Usage:
 *   pnpm ml:scan [--corpus path/to/corpus.csv]
 *
 * corpus.csv columns: username, site, url, label, is_soft404_site
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv } from '../../src/shared/searchlight/ml/csv';
import { isSoft404Site } from '../../src/shared/searchlight/ml/soft404';
import type { MaigretSiteEntry, RawCheckResult } from '../../src/shared/searchlight/types';

// A handle that cannot plausibly be registered anywhere — fixed for determinism.
const FAKE_HANDLE = 'qz9x7kf3vmn0nope404zzx';
const BODY_CAP = 64 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; GhostIntel98/3.0 ML-Corpus-Collector)';

function parseArgs(): { corpus: string } {
  const args = process.argv.slice(2);
  let corpus = 'corpus.csv';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) corpus = args[++i];
  }
  return { corpus: path.resolve(corpus) };
}

async function fetchUrl(url: string): Promise<RawCheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': UA },
      });
    } finally {
      clearTimeout(timer);
    }
    const elapsed = Date.now() - start;
    let redirectUrl: string | null = null;
    if (response.status >= 300 && response.status < 400) {
      redirectUrl = response.headers.get('location') ?? null;
    }
    let body = '';
    if (response.status === 200) {
      const buf = await response.arrayBuffer();
      const slice = buf.byteLength > BODY_CAP ? buf.slice(0, BODY_CAP) : buf;
      body = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    }
    return { statusCode: response.status, statusMessage: response.statusText, elapsed, redirectUrl, error: null, body };
  } catch (err) {
    return { statusCode: 0, statusMessage: '', elapsed: Date.now() - start, redirectUrl: null, error: err instanceof Error ? err.message : String(err), body: '' };
  }
}

function siteStub(name: string, url: string): MaigretSiteEntry {
  return {
    name, url, urlMain: url, urlProbe: '', category: 'social', tags: [],
    checkType: 'status_code', presenseStrs: [], absenceStrs: [], alexaRank: 0,
    headers: {}, usernameClaimed: '',
  };
}

async function main(): Promise<void> {
  const { corpus } = parseArgs();
  if (!fs.existsSync(corpus)) { console.error(`Error: corpus file not found: ${corpus}`); process.exit(1); }

  const { header, rows } = parseCsv(fs.readFileSync(corpus, 'utf-8'));
  for (const col of ['username', 'site', 'url', 'is_soft404_site']) {
    if (!header.includes(col)) { console.error(`Error: corpus.csv missing column: ${col}`); process.exit(1); }
  }

  // One representative row per site (stable: first occurrence).
  const repBySite = new Map<string, Record<string, string>>();
  for (const r of rows) if (!repBySite.has(r['site'] ?? '')) repBySite.set(r['site'] ?? '', r);

  const softBySite = new Map<string, boolean>();
  let i = 0;
  for (const [site, rep] of repBySite) {
    const username = rep['username'] ?? '';
    const fakeUrl = (rep['url'] ?? '').split(username).join(FAKE_HANDLE);
    const raw = await fetchUrl(fakeUrl);
    const soft = raw.error ? false : isSoft404Site(raw, siteStub(site, fakeUrl), fakeUrl);
    softBySite.set(site, soft);
    i++;
    console.log(`  [${i}/${repBySite.size}] ${site}: ${raw.error ? `error(${raw.error})` : `${raw.statusCode} → soft404=${soft}`}`);
  }

  const updated = rows.map((r) => ({ ...r, is_soft404_site: softBySite.get(r['site'] ?? '') ? '1' : '0' }));
  fs.writeFileSync(corpus, toCsv(header, updated), 'utf-8');
  const softCount = [...softBySite.values()].filter(Boolean).length;
  console.log(`Tagged ${softCount}/${repBySite.size} sites soft-404-prone; wrote ${updated.length} rows to ${corpus}`);
}

main().catch((err) => { console.error('scan-soft404: fatal error:', err); process.exit(1); });
