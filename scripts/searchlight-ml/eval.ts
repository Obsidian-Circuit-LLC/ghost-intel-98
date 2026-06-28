/**
 * Eval orchestrator: dataset.csv + model.json → eval-report.md
 *
 * Reads dataset.csv, reconstructs EvalRows (features + signal vec + label + soft flag),
 * runs 5-fold stratified CV via evaluate(), and writes a Markdown report to
 * scripts/searchlight-ml/out/eval-report.md with per-fold tables and the gate verdict.
 *
 * Usage:
 *   pnpm ml:eval [--dataset path/to/dataset.csv] [--out path/to/eval-report.md]
 *
 * dataset.csv columns: DATASET_COLUMNS..., label, is_soft404_site
 * (is_soft404_site is an evaluation label, NEVER a model feature — no leakage)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../../src/shared/searchlight/ml/csv';
import { DATASET_COLUMNS } from '../../src/shared/searchlight/ml/collect-core';
import { evaluate, type EvalRow } from '../../src/shared/searchlight/ml/eval-core';
import type { SignalVector } from '../../src/shared/searchlight/types';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { dataset: string; out: string } {
  const args = process.argv.slice(2);
  const defaultOut = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'out',
    'eval-report.md',
  );
  let dataset = 'dataset.csv';
  let out = defaultOut;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset' && args[i + 1]) dataset = args[++i];
    if (args[i] === '--out' && args[i + 1]) out = args[++i];
  }
  return { dataset: path.resolve(dataset), out: path.resolve(out) };
}

// ---------------------------------------------------------------------------
// Signal key list (base cheap + body signals, matching DATASET_COLUMNS order).
// Used to reconstruct the SignalVector from the CSV row for heuristic scoring.
// ---------------------------------------------------------------------------

/** DATASET_COLUMNS entries that belong to the base signal vector (exclude interactions). */
const BASE_SIGNAL_KEYS: string[] = DATASET_COLUMNS.filter(
  (k) => !k.startsWith('heuristic_x_') && k !== 'heuristic_score',
);

// ---------------------------------------------------------------------------
// Markdown report helpers
// ---------------------------------------------------------------------------

function fmtN(n: number, digits = 4): string {
  return n.toFixed(digits);
}

function buildReport(
  result: ReturnType<typeof evaluate>,
  rows: EvalRow[],
): string {
  const { overall, soft, verdict, perFold } = result;
  const positives = rows.filter((r) => r.label === 1).length;
  const negatives = rows.filter((r) => r.label === 0).length;
  const softCount = rows.filter((r) => r.soft).length;

  const lines: string[] = [];

  lines.push('# Searchlight ML Evaluation Report');
  lines.push('');
  lines.push('## Dataset');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total rows | ${rows.length} |`);
  lines.push(`| Positives (label=1) | ${positives} |`);
  lines.push(`| Negatives (label=0) | ${negatives} |`);
  lines.push(`| Soft-404 rows | ${softCount} |`);
  lines.push(`| Features | ${DATASET_COLUMNS.length} |`);
  lines.push('');

  lines.push('## CV Mean Results (5-fold stratified)');
  lines.push('');
  lines.push('### Overall (all held-out rows)');
  lines.push('');
  lines.push(`| Metric | Heuristic | ML |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Precision | ${fmtN(overall.precH)} | ${fmtN(overall.precM)} |`);
  lines.push(`| F1 | ${fmtN(overall.f1H)} | ${fmtN(overall.f1M)} |`);
  lines.push(`| Soft-404 N (held-out) | — | ${overall.softN} |`);
  lines.push('');

  lines.push('### Soft-404 Subset');
  lines.push('');
  lines.push(`| Metric | Heuristic | ML |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Precision | ${fmtN(soft.precH)} | ${fmtN(soft.precM)} |`);
  lines.push(`| F1 | ${fmtN(soft.f1H)} | ${fmtN(soft.f1M)} |`);
  lines.push(`| Soft-404 N (held-out) | — | ${soft.softN} |`);
  lines.push('');

  lines.push('## Per-Fold Breakdown');
  lines.push('');
  lines.push('### Overall — Per Fold');
  lines.push('');
  lines.push('| Fold | Prec H | Prec ML | F1 H | F1 ML |');
  lines.push('|---|---|---|---|---|');
  for (const row of perFold) {
    lines.push(
      `| ${row.fold} | ${fmtN(row.overallPrecH)} | ${fmtN(row.overallPrecM)} | ${fmtN(row.overallF1H)} | ${fmtN(row.overallF1M)} |`,
    );
  }
  lines.push(`| **Mean** | **${fmtN(overall.precH)}** | **${fmtN(overall.precM)}** | **${fmtN(overall.f1H)}** | **${fmtN(overall.f1M)}** |`);
  lines.push('');

  lines.push('### Soft-404 Subset — Per Fold');
  lines.push('');
  lines.push('| Fold | Soft N | Prec H | Prec ML | F1 H | F1 ML |');
  lines.push('|---|---|---|---|---|---|');
  for (const row of perFold) {
    const noData = row.softCount === 0;
    lines.push(
      `| ${row.fold} | ${row.softCount} | ${noData ? '—' : fmtN(row.softPrecH)} | ${noData ? '—' : fmtN(row.softPrecM)} | ${noData ? '—' : fmtN(row.softF1H)} | ${noData ? '—' : fmtN(row.softF1M)} |`,
    );
  }
  lines.push(`| **Mean** | **${soft.softN}** | **${fmtN(soft.precH)}** | **${fmtN(soft.precM)}** | **${fmtN(soft.f1H)}** | **${fmtN(soft.f1M)}** |`);
  lines.push('');

  lines.push('## Gate Verdict');
  lines.push('');
  lines.push(`**Result: ${verdict.pass ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push(`Reason: ${verdict.reason}`);
  lines.push('');

  lines.push('### Gate Conditions');
  lines.push('');
  lines.push('```');
  lines.push(`soft N >= 80:                  ${soft.softN} ${soft.softN >= 80 ? '✓' : '✗'}`);
  lines.push(
    `precision_ML >= precision_H + 0.05:  overall: ${fmtN(overall.precM)} >= ${fmtN(overall.precH + 0.05)} ${overall.precM >= overall.precH + 0.05 ? '✓' : '✗'}`,
  );
  lines.push(
    `f1_ML >= f1_H - 0.02:              overall: ${fmtN(overall.f1M)} >= ${fmtN(overall.f1H - 0.02)} ${overall.f1M >= overall.f1H - 0.02 ? '✓' : '✗'}`,
  );
  lines.push(
    `precision_ML >= precision_H + 0.05:  soft:    ${fmtN(soft.precM)} >= ${fmtN(soft.precH + 0.05)} ${soft.precM >= soft.precH + 0.05 ? '✓' : '✗'}`,
  );
  lines.push(
    `f1_ML >= f1_H - 0.02:              soft:    ${fmtN(soft.f1M)} >= ${fmtN(soft.f1H - 0.02)} ${soft.f1M >= soft.f1H - 0.02 ? '✓' : '✗'}`,
  );
  lines.push('```');
  lines.push('');

  if (verdict.pass) {
    lines.push(
      '**Action:** Gate cleared — vendor `scripts/searchlight-ml/out/model.json` into `resources/searchlight/`, wire interaction features into `interpret.ts`, and flip `searchlight.scorer.useMl` default to `true`.',
    );
  } else if (verdict.reason.includes('inconclusive')) {
    lines.push(
      '**Action:** Soft-404 subset too small — expand corpus to tier 2 (target ≥ 200 soft-404 examples) before re-evaluating.',
    );
  } else {
    lines.push(
      '**Action:** Gate not cleared — ML does not beat the heuristic by the required margin. Options: expand corpus, add features, or report honestly that ML is not beneficial on this problem and keep `useMl` off.',
    );
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { dataset, out } = parseArgs();

  if (!fs.existsSync(dataset)) {
    console.error(`Error: dataset file not found: ${dataset}`);
    process.exit(1);
  }

  // Read and parse the dataset.
  const text = fs.readFileSync(dataset, 'utf-8');
  const { header, rows: csvRows } = parseCsv(text);

  // Validate required columns.
  for (const col of DATASET_COLUMNS) {
    if (!header.includes(col)) {
      console.error(`Error: dataset.csv is missing required feature column: ${col}`);
      process.exit(1);
    }
  }
  for (const required of ['label', 'is_soft404_site']) {
    if (!header.includes(required)) {
      console.error(`Error: dataset.csv is missing required column: ${required}`);
      process.exit(1);
    }
  }

  console.log(`Dataset: ${csvRows.length} rows, ${DATASET_COLUMNS.length} features`);

  // Build EvalRows — reconstruct features, signal vec, label, and soft flag.
  const evalRows: EvalRow[] = csvRows.map((row, i) => {
    const label = Number(row['label'] ?? '0');
    if (label !== 0 && label !== 1) {
      console.error(`Error: row ${i} has invalid label: ${String(row['label'])}`);
      process.exit(1);
    }

    // Feature vector: project DATASET_COLUMNS → number[].
    const features = DATASET_COLUMNS.map((col) => {
      const v = Number(row[col] ?? '0');
      return Number.isFinite(v) ? v : 0;
    });

    // Reconstruct the base SignalVector from the CSV row for heuristic scoring.
    // We use BASE_SIGNAL_KEYS (cheap + body signals, excluding interaction columns
    // and heuristic_score) so scoreSignals() computes the same heuristic the
    // collect pipeline computed at collection time.
    const vec: SignalVector = {};
    for (const key of BASE_SIGNAL_KEYS) {
      const v = Number(row[key] ?? '0');
      vec[key] = Number.isFinite(v) ? v : 0;
    }

    const soft = Number(row['is_soft404_site'] ?? '0') === 1;

    return { features, vec, label, soft };
  });

  const positives = evalRows.filter((r) => r.label === 1).length;
  const negatives = evalRows.filter((r) => r.label === 0).length;
  const softCount = evalRows.filter((r) => r.soft).length;
  console.log(`Labels: ${positives} positive, ${negatives} negative`);
  console.log(`Soft-404 rows: ${softCount}`);

  // Run evaluation.
  console.log('Running 5-fold CV evaluation...');
  const result = evaluate(evalRows, DATASET_COLUMNS);

  // Print summary to console.
  const { overall, soft, verdict } = result;
  console.log('\n--- CV Mean Results ---');
  console.log(
    `Overall:  prec_H=${overall.precH.toFixed(4)} prec_ML=${overall.precM.toFixed(4)} f1_H=${overall.f1H.toFixed(4)} f1_ML=${overall.f1M.toFixed(4)}`,
  );
  console.log(
    `Soft-404: prec_H=${soft.precH.toFixed(4)} prec_ML=${soft.precM.toFixed(4)} f1_H=${soft.f1H.toFixed(4)} f1_ML=${soft.f1M.toFixed(4)} N=${soft.softN}`,
  );
  console.log(`\nGate: ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.reason}`);

  // Write the Markdown report.
  const report = buildReport(result, evalRows);
  const outDir = path.dirname(out);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(out, report, 'utf-8');
  console.log(`\nReport written to ${out}`);

  // Exit 1 if gate fails (useful for CI).
  if (!verdict.pass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('eval: fatal error:', err);
  process.exit(1);
});
