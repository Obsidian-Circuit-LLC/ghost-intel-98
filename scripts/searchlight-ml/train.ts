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

  // Train
  console.log('Training...');
  const model = trainModel(trainRows, DATASET_COLUMNS);
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
