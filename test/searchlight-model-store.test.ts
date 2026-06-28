import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Electron stub — required so model-store.ts module can be imported
// (modelPath / userDataModelPath use deferred require('electron'), which is
// not interceptable in this Vitest ESM setup, so we import readOverrideAt
// for the disk-read tests instead of calling getModel() directly).
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (_name: string) => '/mock/userData',
    getAppPath: () => resolve(__dirname, '..'),
  },
}));

import {
  parseModel,
  pickModel,
  readOverrideAt,
  clearModelCache,
  setModelOverride,
} from '../src/main/searchlight/model-store';

const REAL_JSON = readFileSync(resolve(__dirname, '../resources/searchlight/model.json'), 'utf8');

// ---------------------------------------------------------------------------
// parseModel — pure, no Electron dependency
// ---------------------------------------------------------------------------

describe('parseModel', () => {
  it('parses the real vendored model.json and returns a valid MlModel', () => {
    const m = parseModel(REAL_JSON);
    expect(m).not.toBeNull();
    expect(m!.feature_schema.length).toBe(30);
    expect(typeof m!.ml_weight).toBe('number');
    expect(m!.mean.length).toBe(30);
    expect(m!.scale.length).toBe(30);
    expect(m!.coef.length).toBe(30);
    expect(typeof m!.intercept).toBe('number');
    expect(typeof m!.thresholds.found).toBe('number');
    expect(typeof m!.thresholds.not_found).toBe('number');
  });

  it('returns null for malformed JSON', () => {
    expect(parseModel('{bad')).toBeNull();
  });

  it('returns null when feature_schema length mismatches mean', () => {
    const obj = JSON.parse(REAL_JSON);
    obj.mean = [0, 1]; // wrong length
    expect(parseModel(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when feature_schema length mismatches scale', () => {
    const obj = JSON.parse(REAL_JSON);
    obj.scale = [1]; // wrong length
    expect(parseModel(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when feature_schema length mismatches coef', () => {
    const obj = JSON.parse(REAL_JSON);
    obj.coef = []; // wrong length
    expect(parseModel(JSON.stringify(obj))).toBeNull();
  });

  it('returns null when feature_schema is missing', () => {
    const obj = JSON.parse(REAL_JSON);
    delete obj.feature_schema;
    expect(parseModel(JSON.stringify(obj))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pickModel — pure precedence helper
// ---------------------------------------------------------------------------

describe('pickModel', () => {
  it('returns override when both are set', () => {
    const override = parseModel(REAL_JSON)!;
    const vendored = parseModel(REAL_JSON)!;
    override.version = 'override';
    vendored.version = 'vendored';
    expect(pickModel(override, vendored)!.version).toBe('override');
  });

  it('falls back to vendored when override is null', () => {
    const vendored = parseModel(REAL_JSON)!;
    vendored.version = 'vendored';
    expect(pickModel(null, vendored)!.version).toBe('vendored');
  });

  it('returns null when both are null', () => {
    expect(pickModel(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readOverrideAt — disk-read rehydration (the core of the bug fix)
//
// This exercises the function that getModel() calls to rehydrate the trained
// override model from userDataModelPath() on first call after a restart.
// readOverrideAt has no Electron dependency (takes an explicit path) so it
// is directly testable with real filesystem ops.
// ---------------------------------------------------------------------------

describe('readOverrideAt', () => {
  const TEMP = mkdtempSync(join(tmpdir(), 'model-override-test-'));
  const OVERRIDE_DIR  = join(TEMP, 'searchlight', 'learning');
  const OVERRIDE_PATH = join(OVERRIDE_DIR, 'model.json');

  beforeEach(() => {
    try { rmSync(OVERRIDE_PATH); } catch { /* not present */ }
  });

  afterEach(() => {
    try { rmSync(OVERRIDE_PATH); } catch { /* not present */ }
  });

  it('returns null (ENOENT) when no file exists', () => {
    expect(readOverrideAt(OVERRIDE_PATH)).toBeNull();
  });

  it('returns a valid MlModel when the file contains a valid trained model', () => {
    const overrideObj = JSON.parse(REAL_JSON);
    overrideObj.version = 'trained-v1';
    mkdirSync(OVERRIDE_DIR, { recursive: true });
    writeFileSync(OVERRIDE_PATH, JSON.stringify(overrideObj), 'utf8');

    const m = readOverrideAt(OVERRIDE_PATH);
    expect(m).not.toBeNull();
    expect(m!.version).toBe('trained-v1');
  });

  it('returns null when the file fails shape validation', () => {
    // An empty feature_schema fails parseModel shape check
    mkdirSync(OVERRIDE_DIR, { recursive: true });
    writeFileSync(OVERRIDE_PATH, JSON.stringify({ version: 'bad', feature_schema: [] }), 'utf8');

    expect(readOverrideAt(OVERRIDE_PATH)).toBeNull();
  });

  it('preserves all model fields on a round-trip from disk', () => {
    const vendored = parseModel(REAL_JSON)!;
    mkdirSync(OVERRIDE_DIR, { recursive: true });
    writeFileSync(OVERRIDE_PATH, JSON.stringify(vendored), 'utf8');

    const reloaded = readOverrideAt(OVERRIDE_PATH)!;
    expect(reloaded.feature_schema).toEqual(vendored.feature_schema);
    expect(reloaded.mean).toEqual(vendored.mean);
    expect(reloaded.scale).toEqual(vendored.scale);
    expect(reloaded.coef).toEqual(vendored.coef);
    expect(reloaded.intercept).toBe(vendored.intercept);
    expect(reloaded.ml_weight).toBe(vendored.ml_weight);
    expect(reloaded.thresholds).toEqual(vendored.thresholds);
  });

  it('override returned by readOverrideAt takes precedence via pickModel', () => {
    const overrideObj = JSON.parse(REAL_JSON);
    overrideObj.version = 'user-trained';
    overrideObj.ml_weight = 0.999;
    mkdirSync(OVERRIDE_DIR, { recursive: true });
    writeFileSync(OVERRIDE_PATH, JSON.stringify(overrideObj), 'utf8');

    const override = readOverrideAt(OVERRIDE_PATH);
    const vendored = parseModel(REAL_JSON);
    const chosen = pickModel(override, vendored);

    expect(chosen).not.toBeNull();
    expect(chosen!.version).toBe('user-trained');
    expect(chosen!.ml_weight).toBe(0.999);
  });
});

// ---------------------------------------------------------------------------
// clearModelCache / setModelOverride interaction
//
// Verifies that clearing both caches resets state so getModel() will reload
// on next call (tested via the exports that DON'T need electron).
// ---------------------------------------------------------------------------

describe('clearModelCache', () => {
  it('resets both caches without throwing', () => {
    // Just checking it does not throw — the state is module-internal
    expect(() => clearModelCache()).not.toThrow();
  });
});
