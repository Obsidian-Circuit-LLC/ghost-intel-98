// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-spectre-test' } }));
import { readKeys, saveKeys, keyStatus } from '../src/main/spectre/store';

beforeEach(async () => { await rm('/tmp/ga98-spectre-test', { recursive: true, force: true }); });

describe('spectre key store (encrypted, main-only values)', () => {
  it('round-trips keys and reports status without leaking values', async () => {
    await saveKeys({ wigleName: 'me', wigleToken: 'tok' });
    expect(await readKeys()).toMatchObject({ wigleName: 'me', wigleToken: 'tok', shodan: '' });
    // keyStatus is the ONLY thing the renderer ever sees — booleans, never values.
    const status = await keyStatus();
    expect(status).toMatchObject({ wigleName: true, wigleToken: true, shodan: false });
    expect(JSON.stringify(status)).not.toContain('tok');
  });

  it('a partial save keeps untouched slots; an empty string clears one', async () => {
    await saveKeys({ wigleName: 'me', wigleToken: 'tok', shodan: 'sh' });
    await saveKeys({ shodan: '' }); // clear shodan, leave wigle
    const keys = await readKeys();
    expect(keys.wigleName).toBe('me');
    expect(keys.wigleToken).toBe('tok');
    expect(keys.shodan).toBe('');
  });

  it('an absent store reads as empty, not an error', async () => {
    expect((await keyStatus()).wigleName).toBe(false);
  });
});
