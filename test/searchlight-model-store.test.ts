import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModel } from '../src/main/searchlight/model-store';

const REAL_JSON = readFileSync(resolve(__dirname, '../resources/searchlight/model.json'), 'utf8');

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
