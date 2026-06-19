import { describe, it, expect } from 'vitest';
import { cameraWindowAction, cameraWindowId, MAX_CAMERA_WINDOWS } from '../src/renderer/modules/cameraview/cameraWindow';

describe('cameraWindowId', () => {
  it('namespaces the id by stream', () => {
    expect(cameraWindowId('abc')).toBe('camera-view:abc');
  });
});

describe('cameraWindowAction', () => {
  it('focuses when a window for this stream is already open', () => {
    expect(cameraWindowAction(['camera-view:abc'], 'abc')).toBe('focus');
  });
  it('opens when below the cap', () => {
    expect(cameraWindowAction(['camera-view:x'], 'abc', 8)).toBe('open');
  });
  it('denies a new stream when at the cap', () => {
    const open = Array.from({ length: MAX_CAMERA_WINDOWS }, (_, i) => `camera-view:s${i}`);
    expect(cameraWindowAction(open, 'new', MAX_CAMERA_WINDOWS)).toBe('deny');
  });
  it('still focuses an already-open stream even at the cap', () => {
    const open = Array.from({ length: MAX_CAMERA_WINDOWS }, (_, i) => `camera-view:s${i}`);
    expect(cameraWindowAction(open, 's0', MAX_CAMERA_WINDOWS)).toBe('focus');
  });
});
