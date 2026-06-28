/**
 * Tests for src/main/searchlight/learning/seed.ts
 *
 * Uses a one-row inline fixture matching the Aliens_eye seed_dataset.csv format
 * (31 columns: 27 base signals + 2 fingerprint cols + heuristic_score + label).
 * The fixture sets og_type_profile=1.0 so the interaction-term invariant is
 * verifiable numerically.
 */

import { describe, it, expect } from 'vitest';
import { projectSeedRow, loadSeedRows } from '../src/main/searchlight/learning/seed';
import { DATASET_COLUMNS } from '../src/shared/searchlight/ml/collect-core';

// ---------------------------------------------------------------------------
// Inline fixture — 31-column seed CSV format
// ---------------------------------------------------------------------------

// Header: 27 base signal cols + 2 fingerprint cols + heuristic_score + label
const FIXTURE_HEADER = [
  'http_200', 'http_3xx', 'http_404', 'http_4xx', 'http_5xx',
  'has_username_in_path', 'is_homepage', 'has_auth_pattern',
  'error_keyword_count', 'positive_keyword_count',
  'meta_error_keyword_count', 'meta_positive_keyword_count',
  'profile_section_count', 'error_section_count',
  'img_count', 'input_count', 'form_count',
  'title_has_username', 'meta_has_username',
  'response_time', 'content_length', 'redirect_count',
  // fingerprint columns — present in seed, absent from DATASET_COLUMNS
  'fingerprint_match_found', 'fingerprint_match_not_found',
  'og_type_profile', 'has_json_ld_person', 'username_in_canonical',
  'link_count', 'text_length',
  'heuristic_score',
  'label',
].join(',');

// Values: http_200=1 (soft=true), og_type_profile=1.0, heuristic_score=17.5, label=1.0
// fingerprint cols set to non-zero to confirm they do not appear in vec.
const FIXTURE_VALUES = [
  '1.0', '0.0', '0.0', '0.0', '0.0',
  '1.0', '0.0', '0.0',
  '2.0', '9.0',
  '0.0', '5.0',
  '0.0', '5.0',
  '1.0', '0.0', '0.0',
  '1.0', '1.0',
  '0.64', '42663.0', '0.0',
  // fingerprint values — must NOT appear in the projected vec
  '0.7', '0.3',
  '1.0', '0.0', '0.0',
  '0.0', '0.0',
  '17.5',
  '1.0',
].join(',');

const FIXTURE_CSV = `${FIXTURE_HEADER}\n${FIXTURE_VALUES}\n`;

// Build the row object directly (matching what parseCsv produces).
const FIXTURE_ROW: Record<string, string> = Object.fromEntries(
  FIXTURE_HEADER.split(',').map((k, i) => [k, FIXTURE_VALUES.split(',')[i]]),
);

// ---------------------------------------------------------------------------
// projectSeedRow
// ---------------------------------------------------------------------------

describe('projectSeedRow', () => {
  it('produces features.length === DATASET_COLUMNS.length', () => {
    const { features } = projectSeedRow(FIXTURE_ROW);
    expect(features.length).toBe(DATASET_COLUMNS.length);
  });

  it('fingerprint columns are absent from vec', () => {
    const { vec } = projectSeedRow(FIXTURE_ROW);
    expect(vec['fingerprint_match_found']).toBeUndefined();
    expect(vec['fingerprint_match_not_found']).toBeUndefined();
  });

  it('heuristic_x_og_type === heuristic_score * og_type_profile', () => {
    const { vec } = projectSeedRow(FIXTURE_ROW);
    // With heuristic_score=17.5 and og_type_profile=1.0 the product is 17.5.
    expect(vec['heuristic_x_og_type']).toBeCloseTo(vec['heuristic_score'] * vec['og_type_profile']);
    expect(vec['heuristic_x_og_type']).toBeCloseTo(17.5);
  });

  it('label is 1 when row.label >= 0.5', () => {
    const { label } = projectSeedRow(FIXTURE_ROW);
    expect(label).toBe(1);
  });

  it('label is 0 when row.label < 0.5', () => {
    const { label } = projectSeedRow({ ...FIXTURE_ROW, label: '0.0' });
    expect(label).toBe(0);
  });

  it('soft is true when http_200 === 1', () => {
    const { soft } = projectSeedRow(FIXTURE_ROW);
    expect(soft).toBe(true);
  });

  it('soft is false when http_200 !== 1', () => {
    const { soft } = projectSeedRow({ ...FIXTURE_ROW, http_200: '0.0' });
    expect(soft).toBe(false);
  });

  it('features are zero-filled for absent columns', () => {
    // Row with only heuristic_score set; all others default to 0.
    const sparse = { heuristic_score: '5.0', label: '1.0', http_200: '0.0' };
    const { features } = projectSeedRow(sparse);
    expect(features.length).toBe(DATASET_COLUMNS.length);
    // heuristic_score should appear at its DATASET_COLUMNS position.
    const hIdx = DATASET_COLUMNS.indexOf('heuristic_score');
    expect(features[hIdx]).toBeCloseTo(5.0);
  });
});

// ---------------------------------------------------------------------------
// loadSeedRows
// ---------------------------------------------------------------------------

describe('loadSeedRows', () => {
  it('maps all CSV rows to EvalRow format', () => {
    const rows = loadSeedRows(FIXTURE_CSV);
    expect(rows.length).toBe(1);
    expect(rows[0].features.length).toBe(DATASET_COLUMNS.length);
  });

  it('returns empty array for header-only CSV', () => {
    const rows = loadSeedRows(FIXTURE_HEADER + '\n');
    expect(rows).toHaveLength(0);
  });
});
