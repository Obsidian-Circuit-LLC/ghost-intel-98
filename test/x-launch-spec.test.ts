import { describe, it, expect } from 'vitest';
import { xLaunchSpec } from '../src/renderer/modules/socmint/x-launch-spec';

describe('xLaunchSpec', () => {
  it('targets the x module with a stable title', () => {
    const s = xLaunchSpec();
    expect(s.module).toBe('x');
    expect(s.title).toBe('X / Twitter');
    expect(s.props).toBeUndefined();
  });
  it('carries caseId when one is loaded', () => {
    expect(xLaunchSpec('case-1').props).toEqual({ caseId: 'case-1' });
  });
  it('omits props for blank/whitespace caseId', () => {
    expect(xLaunchSpec('   ').props).toBeUndefined();
    expect(xLaunchSpec('').props).toBeUndefined();
  });
});
