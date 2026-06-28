/**
 * Canonical path helpers for the Searchlight adaptive-learning engine.
 *
 * All paths are resolved via deferred require('electron') so this module stays
 * importable in Vitest without an Electron runtime.
 *
 * Constraints:
 *   - No Math.random / no Date.now.
 *   - No network egress.
 *   - Pure path computation — no I/O performed here.
 */

import { join } from 'node:path';

// ---------------------------------------------------------------------------
// learningDir
// ---------------------------------------------------------------------------

/**
 * Absolute path to the learning/ subdirectory inside the user's app data.
 * All per-user learning artefacts (corpus, vectors, meta) live under this root.
 */
export function learningDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'searchlight', 'learning');
}

// ---------------------------------------------------------------------------
// corpusFile
// ---------------------------------------------------------------------------

/**
 * Absolute path to corpus.json — the persisted personal label corpus.
 */
export function corpusFile(): string {
  return join(learningDir(), 'corpus.json');
}

// ---------------------------------------------------------------------------
// vectorsFile
// ---------------------------------------------------------------------------

/**
 * Absolute path to the per-case vector store file.
 * Each sweep result's pre-computed feature vector is stored here so that
 * labelResult can use main-process-captured features, not renderer-supplied ones.
 *
 * @param caseId - UUID of the Searchlight case the sweep was run for.
 */
export function vectorsFile(caseId: string): string {
  return join(learningDir(), 'vectors', `${caseId}.json`);
}

// ---------------------------------------------------------------------------
// seedFile
// ---------------------------------------------------------------------------

/**
 * Absolute path to the vendored Aliens_eye seed_dataset.csv.
 * Location mirrors the model.json pattern in model-store.ts:
 *   - packaged build  → process.resourcesPath/searchlight/seed_dataset.csv
 *   - dev / test      → app.getAppPath()/resources/searchlight/seed_dataset.csv
 */
export function seedFile(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, app.isPackaged ? 'searchlight' : 'resources/searchlight', 'seed_dataset.csv');
}
