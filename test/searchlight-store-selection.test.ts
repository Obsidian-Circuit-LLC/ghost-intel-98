import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchlightStore } from '../src/renderer/modules/searchlight/store';

describe('searchlight store — selectedJobId', () => {
  beforeEach(() => {
    useSearchlightStore.setState({ cases: [], activeCaseId: null, selectedJobId: null });
  });

  it('defaults to null', () => {
    expect(useSearchlightStore.getState().selectedJobId).toBeNull();
  });

  it('setSelectedJobId updates the field without throwing (no persistence side-effect)', () => {
    useSearchlightStore.getState().setSelectedJobId('job-123');
    expect(useSearchlightStore.getState().selectedJobId).toBe('job-123');
    useSearchlightStore.getState().setSelectedJobId(null);
    expect(useSearchlightStore.getState().selectedJobId).toBeNull();
  });
});
