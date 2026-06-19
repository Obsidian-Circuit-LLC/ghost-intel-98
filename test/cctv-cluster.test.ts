import { describe, it, expect } from 'vitest';
import { cellDegForZoom, clusterCameras, type Bounds } from '../src/renderer/modules/geoint/cctvCluster';
import type { CameraStream } from '../src/shared/post-mvp-types';

const WORLD: Bounds = { west: -180, south: -85, east: 180, north: 85 };

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

describe('cellDegForZoom', () => {
  it('is positive and monotonically non-increasing as zoom rises', () => {
    expect(cellDegForZoom(2)).toBeGreaterThan(cellDegForZoom(5));
    expect(cellDegForZoom(5)).toBeGreaterThan(cellDegForZoom(10));
    expect(cellDegForZoom(15)).toBeGreaterThan(0);
  });
  it('clamps to a sane range', () => {
    expect(cellDegForZoom(0)).toBeLessThanOrEqual(90);
    expect(cellDegForZoom(22)).toBeGreaterThanOrEqual(0.0008);
  });
});

describe('clusterCameras', () => {
  it('collapses co-located cameras into one cluster (count, sorted ids, no singleton)', () => {
    const cells = clusterCameras([
      cam({ id: 'b', lat: 51.5074, lon: -0.1278 }),
      cam({ id: 'a', lat: 51.5076, lon: -0.1279 })
    ], 3, WORLD);
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(2);
    expect(cells[0].streamIds).toEqual(['a', 'b']);
    expect(cells[0].singleton).toBeUndefined();
  });

  it('emits a singleton for an isolated camera, carrying the stream', () => {
    const s = cam({ id: 'solo', lat: -33.8688, lon: 151.2093 });
    const cells = clusterCameras([s], 3, WORLD);
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(1);
    expect(cells[0].singleton).toEqual(s);
  });

  it('filters cameras outside the viewport bounds', () => {
    const inView = cam({ id: 'in', lat: 51.5, lon: -0.1 });
    const off = cam({ id: 'off', lat: 51.5, lon: 179 });
    const cells = clusterCameras([inView, off], 8, { west: -1, south: 51, east: 0, north: 52 });
    const ids = cells.flatMap((c) => c.streamIds);
    expect(ids).toContain('in');
    expect(ids).not.toContain('off');
  });

  it('separates distinct nearby cameras into singletons at high zoom', () => {
    const cells = clusterCameras([
      cam({ id: 'p', lat: 51.5000, lon: -0.1000 }),
      cam({ id: 'q', lat: 51.5200, lon: -0.1400 })
    ], 14, WORLD);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.count === 1)).toBe(true);
  });

  it('skips non-finite coords and returns cells stably sorted by key', () => {
    const cells = clusterCameras([
      cam({ id: 'nan', lat: NaN, lon: 0 }),
      cam({ id: 'z', lat: 10, lon: 100 }),
      cam({ id: 'a', lat: -10, lon: -100 })
    ], 4, WORLD);
    expect(cells.flatMap((c) => c.streamIds)).not.toContain('nan');
    const keys = cells.map((c) => c.key);
    expect([...keys].sort()).toEqual(keys); // already sorted
  });
});
