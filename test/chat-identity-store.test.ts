import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { ChatIdentityStore } from '../src/main/chat/identity-store';
import { contactId } from '../src/main/chat/identity';

async function file(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dcs98-cid-')), 'identity.json');
}

describe('ChatIdentityStore', () => {
  it('creates + persists an identity, and returns the same on reload', async () => {
    const path = await file();
    const s1 = new ChatIdentityStore(path);
    const id = await s1.loadOrCreate();
    expect(id.publicKeys.ed25519.length).toBe(32);
    expect(id.x25519Secret.length).toBe(32);

    const same = await s1.loadOrCreate(); // idempotent
    expect(contactId(same.publicKeys)).toBe(contactId(id.publicKeys));

    const s2 = new ChatIdentityStore(path); // fresh instance reads persisted
    const reloaded = await s2.loadOrCreate();
    expect(contactId(reloaded.publicKeys)).toBe(contactId(id.publicKeys));
    expect(Array.from(reloaded.ed25519Secret)).toEqual(Array.from(id.ed25519Secret));
  });

  it('persists the onion key blob', async () => {
    const path = await file();
    const s = new ChatIdentityStore(path);
    await s.loadOrCreate();
    expect(await s.getOnionKey()).toBeNull();
    await s.setOnionKey('ED25519-V3:SOMEKEY==');
    expect(await s.getOnionKey()).toBe('ED25519-V3:SOMEKEY==');
    // survives reload
    expect(await new ChatIdentityStore(path).getOnionKey()).toBe('ED25519-V3:SOMEKEY==');
  });

  it('setOnionKey before init throws', async () => {
    const s = new ChatIdentityStore(await file());
    await expect(s.setOnionKey('ED25519-V3:X')).rejects.toThrow();
  });
});
