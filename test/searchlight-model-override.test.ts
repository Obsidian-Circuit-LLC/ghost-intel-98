import { describe, it, expect } from 'vitest';
import { pickModel } from '../src/main/searchlight/model-store';

describe('pickModel', () => {
  it('override wins over vendored', () => {
    const o = { version: 'local' } as any, v = { version: 'vendored' } as any;
    expect(pickModel(o, v).version).toBe('local');
    expect(pickModel(null, v).version).toBe('vendored');
    expect(pickModel(null, null)).toBeNull();
  });
});
