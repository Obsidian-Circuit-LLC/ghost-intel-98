import { describe, it, expect } from 'vitest';
import { cameraHeaderText } from '../src/renderer/modules/cameraview/CameraViewModule';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'A40 Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

describe('cameraHeaderText', () => {
  it('joins label with the present location parts (city · region · country)', () => {
    expect(cameraHeaderText(cam({ city: 'London', region: 'Greater London', country: 'United Kingdom' })))
      .toBe('A40 Cam — London · Greater London · United Kingdom');
  });
  it('omits the dash when no location is present', () => {
    expect(cameraHeaderText(cam())).toBe('A40 Cam');
  });
  it('skips blank location parts', () => {
    expect(cameraHeaderText(cam({ city: 'Paris', country: '' }))).toBe('A40 Cam — Paris');
  });
});
