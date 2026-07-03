// test/memory-embed-health-ipc.test.ts — assert the facade re-exports embedHealth
import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-health') } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({
  embedHealth: async () => 'ready', ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'x'
}));
import * as memory from '../src/main/services/memory';
describe('memory facade', () => {
  it('re-exports embedHealth', async () => { expect(await memory.embedHealth()).toBe('ready'); });
});
