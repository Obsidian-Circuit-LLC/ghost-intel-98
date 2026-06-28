/**
 * Train orchestrator: dataset.csv → model.json
 *
 * Reads dataset.csv, projects DATASET_COLUMNS → numeric feature matrix,
 * calls trainModel (deterministic logistic regression), and writes model.json
 * to scripts/searchlight-ml/out/model.json.
 *
 * Usage:
 *   pnpm ml:train [--dataset path/to/dataset.csv] [--out path/to/model.json]
 *
 * dataset.csv columns: DATASET_COLUMNS..., label, is_soft404_site
 * (is_soft404_site is passed through only; it is NEVER a model feature)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../../src/shared/searchlight/ml/csv';
import { DATASET_COLUMNS } from '../../src/shared/searchlight/ml/collect-core';
import { trainModel } from '../../src/shared/searchlight/ml/train-core';
import { scoreSignals, DEFAULT_WEIGHTS } from '../../src/shared/searchlight/scorer';
import { thresholdForRecall, prf } from '../../src/shared/searchlight/ml/metrics';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { dataset: string; out: string } {
  const args = process.argv.slice(2);
  let dataset = 'dataset.csv';
  let out = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', 'model.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset' && args[i + 1]) dataset = args[++i];
    if (args[i] === '--out' && args[i + 1]) out = args[++i];
  }
  return { dataset: path.resolve(dataset), out: path.resolve(out) };
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

  // Read dataset
  const text = fs.readFileSync(dataset, 'utf-8');
  const { header, rows } = parseCsv(text);

  // Validate columns
  for (const col of DATASET_COLUMNS) {
    if (!header.includes(col)) {
      console.error(`Error: dataset.csv is missing required feature column: ${col}`);
      process.exit(1);
    }
  }
  if (!header.includes('label')) {
    console.error('Error: dataset.csv is missing required column: label');
    process.exit(1);
  }

  console.log(`Dataset: ${rows.length} rows, ${DATASET_COLUMNS.length} features`);

  // Project rows → TrainRow[]
  const trainRows = rows.map((row, i) => {
    const label = Number(row['label'] ?? '0');
    if (label !== 0 && label !== 1) {
      console.error(`Error: row ${i} has invalid label: ${String(row['label'])}`);
      process.exit(1);
    }
    const features = DATASET_COLUMNS.map((col) => {
      const v = Number(row[col] ?? '0');
      return Number.isFinite(v) ? v : 0;
    });
    return { features, label };
  });

  const positives = trainRows.filter((r) => r.label === 1).length;
  const negatives = trainRows.filter((r) => r.label === 0).length;
  console.log(`Labels: ${positives} positive, ${negatives} negative`);

  // Derive the heuristic's operating recall on the full dataset so trainModel
  // calibrates thresholds at the same recall point the heuristic actually operates at
  // (not at a hardcoded 0.8 that may differ from the heuristic's true operating recall).
  //
  // Reconstruct a minimal SignalVector for each row from the DEFAULT_WEIGHTS keys
  // (all of which are present in DATASET_COLUMNS) and call scoreSignals — exactly
  // mirroring the pattern in eval-core.ts.
  const TARGET_RECALL = 0.8;
  const signalKeys = Object.keys(DEFAULT_WEIGHTS);
  const hProbs = rows.map((row) => {
    const vec: Record<string, number> = {};
    for (const key of signalKeys) {
      const v = Number(row[key] ?? '0');
      vec[key] = Number.isFinite(v) ? v : 0;
    }
    return scoreSignals(vec);
  });
  const allLabels = trainRows.map((r) => r.label);
  const hThresh = thresholdForRecall(hProbs, allLabels, TARGET_RECALL);
  const hPred = hProbs.map((p) => (p >= hThresh ? 1 : 0));
  const hMetrics = prf(hPred, allLabels);
  const heuristicRecall = hMetrics.recall;
  console.log(
    `Heuristic recall @ TARGET_RECALL=${TARGET_RECALL}: ${heuristicRecall.toFixed(4)}` +
    ` (threshold=${hThresh.toFixed(4)})`,
  );

  // Train — calibrate thresholds at the heuristic's achieved recall, not 0.8.
  console.log('Training...');
  const model = trainModel(trainRows, DATASET_COLUMNS, heuristicRecall);
  console.log(`Model version: ${model.version}`);
  console.log(`Thresholds: found=${model.thresholds.found.toFixed(4)}, not_found=${model.thresholds.not_found.toFixed(4)}`);

  // Write output
  const outDir = path.dirname(out);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(out, JSON.stringify(model, null, 2), 'utf-8');
  console.log(`Model written to ${out}`);
}

main().catch((err) => {
  console.error('train: fatal error:', err);
  process.exit(1);
});
