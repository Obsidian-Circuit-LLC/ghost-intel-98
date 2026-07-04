import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
describe('library channels', () => {
  it('declares library channels', () => {
    expect(channels.memory.libraryList).toBe('memory:libraryList');
    expect(channels.memory.libraryAdd).toBe('memory:libraryAdd');
    expect(channels.memory.libraryRemove).toBe('memory:libraryRemove');
  });
});
