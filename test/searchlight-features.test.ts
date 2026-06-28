import { describe, it, expect } from 'vitest';
import { buildInteractionFeatures, INTERACTION_KEYS } from '../src/shared/searchlight/features';

describe('buildInteractionFeatures', () => {
  it('multiplies heuristic_score by each structural signal', () => {
    const v = { heuristic_score: 10, og_type_profile: 1, has_json_ld_person: 0, error_keyword_count: 3, error_section_count: 0 };
    const out = buildInteractionFeatures(v);
    expect(out.heuristic_x_og_type).toBe(10);
    expect(out.heuristic_x_json_ld).toBe(0);
    expect(out.heuristic_x_error_kw).toBe(30);
    expect(out.heuristic_x_error_section).toBe(0);
    expect(out.heuristic_score).toBe(10); // original preserved
  });
  it('treats missing keys as 0 and lists all interaction keys', () => {
    expect(buildInteractionFeatures({}).heuristic_x_og_type).toBe(0);
    expect(INTERACTION_KEYS).toEqual(['heuristic_x_og_type','heuristic_x_json_ld','heuristic_x_error_kw','heuristic_x_error_section']);
  });
  it('is pure (does not mutate input)', () => {
    const v = { heuristic_score: 5 }; buildInteractionFeatures(v); expect(Object.keys(v)).toEqual(['heuristic_score']);
  });
});
