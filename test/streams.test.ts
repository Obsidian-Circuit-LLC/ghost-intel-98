import { describe, it, expect } from 'vitest';
import { streamsToMasterTree } from '@main/services/cctv-export';

describe('coordinates flow to master CCTV tree', () => {
  it('emits coordinates for a geocoded camera and omits them otherwise', () => {
    const tree = streamsToMasterTree([
      { id: '1', label: 'A', url: 'https://cam.test/a', kind: 'mjpeg', caseId: null, addedAt: '', notes: '',
        country: 'Testland', region: 'Reg', city: 'Town', lat: 12.5, lon: -7.25, source: '' } as any,
      { id: '2', label: 'B', url: 'https://cam.test/b', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', source: '' } as any,
    ]);
    const town = tree['Testland']['Reg']['Town'];
    expect(town[0].coordinates).toEqual({ latitude: 12.5, longitude: -7.25 });
    // geo-less camera lands in the literal Unknown/Unknown/Unknown bucket with NO coordinates key
    const camB = tree['Unknown']['Unknown']['Unknown'].find((c: any) => c.stream_url === 'https://cam.test/b');
    expect(camB).toBeTruthy();
    expect(camB.coordinates).toBeUndefined();
  });
});
