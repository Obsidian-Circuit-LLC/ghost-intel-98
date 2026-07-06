import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('documents IPC surface', () => {
  it('declares every documents channel', () => {
    expect(channels.documents).toEqual({
      list: 'documents:list',
      mkdir: 'documents:mkdir',
      rename: 'documents:rename',
      remove: 'documents:remove',
      copy: 'documents:copy',
      move: 'documents:move',
      importDropped: 'documents:importDropped',
      reveal: 'documents:reveal'
    });
  });
});
