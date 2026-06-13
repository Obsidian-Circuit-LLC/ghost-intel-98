/**
 * GeoINT MapErrorBoundary captures the real exception (message + stack) so the recovery UI can show
 * it ON-DEVICE — the change that turns an unreproducible field crash into a readable report. Tests
 * the pure static reducer; no React render needed.
 */
import { describe, it, expect } from 'vitest';
import { MapErrorBoundary } from '../src/renderer/modules/geoint/MapErrorBoundary';

describe('MapErrorBoundary.getDerivedStateFromError', () => {
  it('captures message and stack from a thrown Error', () => {
    const err = new Error('Cannot read properties of undefined (reading networkEnabled)');
    const s = MapErrorBoundary.getDerivedStateFromError(err);
    expect(s.hasError).toBe(true);
    expect(s.message).toBe('Cannot read properties of undefined (reading networkEnabled)');
    expect(s.stack).toContain('Error: Cannot read properties');
  });

  it('coerces a non-Error throw to a string message and empty stack', () => {
    const s = MapErrorBoundary.getDerivedStateFromError('boom');
    expect(s.hasError).toBe(true);
    expect(s.message).toBe('boom');
    expect(s.stack).toBe('');
  });

  it('handles a null/undefined throw without itself throwing', () => {
    const s = MapErrorBoundary.getDerivedStateFromError(undefined);
    expect(s.hasError).toBe(true);
    expect(typeof s.message).toBe('string');
    expect(s.stack).toBe('');
  });
});
