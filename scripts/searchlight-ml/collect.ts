/**
 * Corpus collection orchestrator: corpus.csv → dataset.csv
 *
 * For each row in corpus.csv not already in dataset.csv, fetches the probe URL
 * via clearnet (GET, 64 KB body cap, timeout), builds a RawCheckResult, runs
 * rowToFeatures, and appends the feature row (plus label + is_soft404_site) to
 * dataset.csv. Fully resumable — rows already collected are skipped.
 *
 * Usage:
 *   pnpm ml:collect [--corpus path/to/corpus.csv] [--dataset path/to/dataset.csv]
 *
 * corpus.csv columns: username, site, url, label, is_soft404_site
 * dataset.csv columns: DATASET_COLUMNS..., label, is_soft404_site
 *
 * Concurrency: 4 parallel fetches; per-host spacing ≥ 1 s.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv } from '../../src/shared/searchlight/ml/csv';
import { rowToFeatures, DATASET_COLUMNS, zeroFill } from '../../src/shared/searchlight/ml/collect-core';
import type { MaigretSiteEntry, RawCheckResult } from '../../src/shared/searchlight/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BODY_CAP = 64 * 1024; // 64 KB
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
const HOST_SPACING_MS = 1_000; // ≥ 1 s between requests to the same host
const UA = 'Mozilla/5.0 (compatible; GhostIntel98/3.0 ML-Corpus-Collector)';

const DATASET_HEADER = [...DATASET_COLUMNS, 'label', 'is_soft404_site'];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { corpus: string; dataset: string } {
  const args = process.argv.slice(2);
  let corpus = 'corpus.csv';
  let dataset = 'dataset.csv';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) corpus = args[++i];
    if (args[i] === '--dataset' && args[i + 1]) dataset = args[++i];
  }
  return { corpus: path.resolve(corpus), dataset: path.resolve(dataset) };
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

interface FetchResult {
  statusCode: number;
  statusMessage: string;
  elapsed: number;
  redirectUrl: string | null;
  body: string;
  error: string | null;
}

async function fetchUrl(url: string): Promise<FetchResult> {
  const start = Date.now(); // orchestrator-only; not passed to pure core
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let redirectUrl: string | null = null;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual', // capture redirect without following
        signal: controller.signal,
        headers: { 'User-Agent': UA },
      });
    } finally {
      clearTimeout(timer);
    }
    const elapsed = Date.now() - start;

    // Capture redirect location header (one hop only — matches Tor path behaviour)
    if (response.status >= 300 && response.status < 400) {
      redirectUrl = response.headers.get('location') ?? null;
    }

    // Read body up to BODY_CAP
    let body = '';
    if (response.status === 200) {
      const buf = await response.arrayBuffer();
      const slice = buf.byteLength > BODY_CAP ? buf.slice(0, BODY_CAP) : buf;
      body = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    }

    return {
      statusCode: response.status,
      statusMessage: response.statusText,
      elapsed,
      redirectUrl,
      body,
      error: null,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { statusCode: 0, statusMessage: '', elapsed, redirectUrl: null, body: '', error: msg };
  }
}

// ---------------------------------------------------------------------------
// Per-host rate limiting
// ---------------------------------------------------------------------------

const hostLastMs = new Map<string, number>();

async function respectHostSpacing(urlStr: string): Promise<void> {
  let host: string;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    host = urlStr;
  }
  const last = hostLastMs.get(host) ?? 0;
  const now = Date.now(); // only used for spacing, not in pure core
  const wait = HOST_SPACING_MS - (now - last);
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  hostLastMs.set(host, Date.now());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { corpus, dataset } = parseArgs();

  if (!fs.existsSync(corpus)) {
    console.error(`Error: corpus file not found: ${corpus}`);
    process.exit(1);
  }

  // Read corpus
  const corpusText = fs.readFileSync(corpus, 'utf-8');
  const { header: corpusHeader, rows: corpusRows } = parseCsv(corpusText);
  const requiredCols = ['username', 'site', 'url', 'label', 'is_soft404_site'];
  for (const col of requiredCols) {
    if (!corpusHeader.includes(col)) {
      console.error(`Error: corpus.csv is missing required column: ${col}`);
      process.exit(1);
    }
  }
  console.log(`Corpus: ${corpusRows.length} rows from ${corpus}`);

  // Read existing dataset (for resumability)
  const doneKeys = new Set<string>();
  let existingRows: Record<string, string>[] = [];
  let datasetHeader: string[] = DATASET_HEADER;
  if (fs.existsSync(dataset)) {
    const dsText = fs.readFileSync(dataset, 'utf-8');
    const parsed = parseCsv(dsText);
    existingRows = parsed.rows;
    datasetHeader = parsed.header.length > 0 ? parsed.header : DATASET_HEADER;
    for (const row of existingRows) {
      doneKeys.add(`${row['username']}|${row['site']}`);
    }
    console.log(`Dataset: ${existingRows.length} rows already collected (resuming)`);
  }

  // Filter pending rows
  const pending = corpusRows.filter(
    (r) => !doneKeys.has(`${r['username']}|${r['site']}`),
  );
  console.log(`Pending: ${pending.length} rows to collect`);

  if (pending.length === 0) {
    console.log('Nothing to collect. Done.');
    return;
  }

  // Collect with bounded concurrency
  const newRows: Record<string, string | number>[] = [];
  let done = 0;

  async function processRow(row: Record<string, string>): Promise<void> {
    const username = row['username'] ?? '';
    const siteName = row['site'] ?? '';
    const url = row['url'] ?? '';
    const label = row['label'] ?? '0';
    const isSoft = row['is_soft404_site'] ?? '0';

    await respectHostSpacing(url);

    const fetched = await fetchUrl(url);

    // Build a minimal MaigretSiteEntry stub (collection only needs the URL)
    const siteEntry: MaigretSiteEntry = {
      name: siteName,
      url: url.replace(username, '{username}'),
      urlMain: url,
      urlProbe: '',
      category: 'social',
      tags: [],
      checkType: 'status_code',
      presenseStrs: [],
      absenceStrs: [],
      alexaRank: 0,
      headers: {},
      usernameClaimed: '',
    };

    const rawResult: RawCheckResult = {
      statusCode: fetched.statusCode,
      statusMessage: fetched.statusMessage,
      elapsed: fetched.elapsed,
      redirectUrl: fetched.redirectUrl,
      error: fetched.error,
      body: fetched.body,
    };

    const v = rowToFeatures(siteEntry, rawResult, url);
    const filled = zeroFill(v);

    const outRow: Record<string, string | number> = {
      username,
      site: siteName,
      ...filled,
      label,
      is_soft404_site: isSoft,
    };

    newRows.push(outRow);
    done++;
    if (done % 10 === 0 || done === pending.length) {
      console.log(`  collected ${done}/${pending.length}`);
    }
  }

  // Bounded concurrency using a queue
  const queue = [...pending];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    let row: Record<string, string> | undefined;
    while ((row = queue.shift()) !== undefined) {
      await processRow(row);
    }
  });
  await Promise.all(workers);

  // Merge existing + new rows and write dataset.csv
  // The dataset CSV header includes username + site for row identity
  const fullHeader = ['username', 'site', ...DATASET_HEADER];
  const allRows = [
    ...existingRows.map((r) => {
      const out: Record<string, string | number> = {};
      for (const k of fullHeader) out[k] = r[k] ?? '';
      return out;
    }),
    ...newRows,
  ];

  fs.writeFileSync(dataset, toCsv(fullHeader, allRows), 'utf-8');
  console.log(`Written ${allRows.length} rows to ${dataset}`);
}

main().catch((err) => {
  console.error('collect: fatal error:', err);
  process.exit(1);
});
