import { describe, it, expect } from 'vitest';
import { featureDrift } from '../src/shared/searchlight/ml/drift';

describe('featureDrift', () => {
  it('ignores response_time, flags real drift', () => {
    const d = featureDrift(
      { og_type_profile: 1, response_time: 0.1 },
      { og_type_profile: 0, response_time: 9 },
      ['response_time'],
    );
    expect(d).toEqual([{ key: 'og_type_profile', a: 1, b: 0 }]);
  });

  it('returns empty when vectors match within epsilon', () => {
    expect(featureDrift({ a: 1, b: 2 }, { a: 1, b: 2 + 1e-12 }, [])).toEqual([]);
  });

  it('treats a missing key as 0 on either side', () => {
    expect(featureDrift({ x: 1 }, {}, [])).toEqual([{ key: 'x', a: 1, b: 0 }]);
    expect(featureDrift({}, { y: 2 }, [])).toEqual([{ key: 'y', a: 0, b: 2 }]);
  });

  it('output order is deterministic (sorted by key)', () => {
    const d = featureDrift({ z: 1, a: 1 }, { z: 0, a: 0 }, []);
    expect(d.map((e) => e.key)).toEqual(['a', 'z']);
  });
});
