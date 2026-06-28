/**
 * Loads and caches the vendored Aliens_eye logistic-regression model.
 *
 * The model file (resources/searchlight/model.json) ships verbatim from
 * Aliens_eye (© 2021 Aaron Thomas, MIT licence — see THIRD_PARTY_LICENSES).
 *
 * Two exports:
 *   parseModel(json: string): MlModel | null  — pure, testable without Electron
 *   getModel(): MlModel | null                — reads from resources, cached after first load
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { MlModel } from '@shared/searchlight/types';
import { secureWriteFile } from '../storage/secure-fs';

// ---------------------------------------------------------------------------
// Pure precedence helper — unit-testable without Electron
// ---------------------------------------------------------------------------

/**
 * Returns the override model when set, otherwise the vendored model.
 * Pure: no I/O, no Electron dependency — safe to call in tests.
 */
export function pickModel(override: MlModel | null, vendored: MlModel | null): MlModel | null {
  return override ?? vendored;
}

// ---------------------------------------------------------------------------
// Pure parse + validate helper (no Electron dependency — testable in Vitest)
// ---------------------------------------------------------------------------

/**
 * Parse and shape-validate a JSON string as an MlModel.
 *
 * Validation rules:
 *   - feature_schema, mean, scale, coef must all be arrays of equal length
 *   - ml_weight, intercept must be numbers
 *   - thresholds.found and thresholds.not_found must be numbers
 *
 * Returns null on any parse error or shape mismatch — never throws.
 */
export function parseModel(json: string): MlModel | null {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  const schema = o['feature_schema'];
  const mean   = o['mean'];
  const scale  = o['scale'];
  const coef   = o['coef'];

  if (!Array.isArray(schema) || schema.length === 0) return null;
  if (!Array.isArray(mean)   || mean.length   !== schema.length) return null;
  if (!Array.isArray(scale)  || scale.length  !== schema.length) return null;
  if (!Array.isArray(coef)   || coef.length   !== schema.length) return null;

  if (typeof o['intercept'] !== 'number') return null;
  if (typeof o['ml_weight'] !== 'number') return null;

  const thr = o['thresholds'];
  if (!thr || typeof thr !== 'object') return null;
  const t = thr as Record<string, unknown>;
  if (typeof t['found'] !== 'number' || typeof t['not_found'] !== 'number') return null;

  return {
    version:        typeof o['version'] === 'string' ? o['version'] : '',
    feature_schema: schema as string[],
    mean:           mean   as number[],
    scale:          scale  as number[],
    coef:           coef   as number[],
    intercept:      o['intercept'] as number,
    ml_weight:      o['ml_weight'] as number,
    thresholds:     { found: t['found'] as number, not_found: t['not_found'] as number },
  };
}

// ---------------------------------------------------------------------------
// Resource-path resolver (mirrors site-db.ts pattern)
// ---------------------------------------------------------------------------

function modelPath(): string {
  // Inline the app import so this module is still importable in Vitest (the
  // import is never executed by the tests; they only call parseModel).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, app.isPackaged ? 'searchlight' : 'resources/searchlight', 'model.json');
}

// ---------------------------------------------------------------------------
// userData override (written by the trainer, takes precedence over vendored)
// ---------------------------------------------------------------------------

/**
 * Path where a trained model override is stored in the user's app data.
 * Written by the trainer (learning/trainer.ts) via setModelOverride.
 * Uses a deferred require('electron') so this module stays importable in Vitest.
 */
export function userDataModelPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'searchlight', 'learning', 'model.json');
}

/** In-memory override cache. undefined = not yet set; null = explicitly cleared; MlModel = active. */
let overrideCache: MlModel | null | undefined = undefined;

/**
 * Persist an override model to userData (or remove it) and update the in-memory cache.
 * Callers: the train handler (Task 10). All persistence goes through secureWriteFile.
 *
 * @param m non-null → write to disk + cache; null → remove file + clear cache.
 */
export async function setModelOverride(m: MlModel | null): Promise<void> {
  if (m !== null) {
    await secureWriteFile(userDataModelPath(), JSON.stringify(m));
    overrideCache = m;
  } else {
    try {
      await unlink(userDataModelPath());
    } catch {
      // File may not exist — that is fine; we are clearing anyway.
    }
    overrideCache = null;
  }
}

// ---------------------------------------------------------------------------
// Vendored-model cached loader
// ---------------------------------------------------------------------------

let modelCache: MlModel | null | undefined = undefined; // undefined = not yet loaded

/**
 * Returns the loaded and validated model, or null if the file is absent or
 * the JSON fails shape validation. Cached after the first load.
 *
 * Now routes through pickModel so a trained override takes precedence over the
 * vendored model without any additional logic at call sites.
 */
export function getModel(): MlModel | null {
  if (modelCache === undefined) {
    try {
      const json = readFileSync(modelPath(), 'utf8');
      const m = parseModel(json);
      if (!m) {
        console.warn('[model-store] model.json failed shape validation — ML disabled');
      }
      modelCache = m;
    } catch (err) {
      console.warn('[model-store] could not read model.json:', err);
      modelCache = null;
    }
  }

  return pickModel(overrideCache ?? null, modelCache ?? null);
}

/** Reset the vendored model cache (for testing). Does NOT clear the override cache. */
export function resetModelCache(): void {
  modelCache = undefined;
}

/** Clear both the vendored-model cache and the override cache (full reset for testing / retrain). */
export function clearModelCache(): void {
  modelCache = undefined;
  overrideCache = undefined;
}
