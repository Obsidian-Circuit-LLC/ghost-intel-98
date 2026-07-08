import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('media IPC channels', () => {
  it('exposes reorderStations + exportStations', () => {
    expect(channels.media.reorderStations).toBe('media:reorderStations');
    expect(channels.media.exportStations).toBe('media:exportStations');
  });
});
