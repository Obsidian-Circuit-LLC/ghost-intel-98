import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { MessageStore, type ChatMessage } from '../src/main/chat/message-store';

const CID = 'a'.repeat(64);
const CID2 = 'b'.repeat(64);
const msg = (id: string, seq: number, dir: 'in' | 'out' = 'out'): ChatMessage => ({
  id, direction: dir, seq, ts: 1717000000000 + seq, text: `m${seq}`, state: dir === 'out' ? 'queued' : 'received'
});
async function store(): Promise<MessageStore> {
  return new MessageStore(await mkdtemp(join(tmpdir(), 'dcs98-msg-')));
}

describe('MessageStore', () => {
  it('appends and lists per contact', async () => {
    const s = await store();
    await s.append(CID, msg('1', 0));
    await s.append(CID, msg('2', 1, 'in'));
    await s.append(CID2, msg('3', 0));
    const a = await s.list(CID);
    expect(a.map((m) => m.id)).toEqual(['1', '2']);
    expect((await s.list(CID2)).map((m) => m.id)).toEqual(['3']);
  });

  it('dedups by id', async () => {
    const s = await store();
    await s.append(CID, msg('1', 0));
    await s.append(CID, msg('1', 0));
    expect(await s.list(CID)).toHaveLength(1);
  });

  it('caps history to the most recent (configurable cap)', async () => {
    const s = new MessageStore(await mkdtemp(join(tmpdir(), 'dcs98-msg-')), 5);
    for (let i = 0; i < 15; i += 1) await s.append(CID, msg(`m${i}`, i));
    const list = await s.list(CID);
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe('m10'); // oldest dropped
    expect(list[list.length - 1].id).toBe('m14');
  });

  it('updates message state (delivery ack)', async () => {
    const s = await store();
    await s.append(CID, msg('1', 0));
    await s.updateState(CID, '1', 'delivered');
    expect((await s.list(CID))[0].state).toBe('delivered');
    await s.updateState(CID, 'nope', 'sent'); // unknown id → no-op, no throw
  });

  it('rejects a malformed contactId', async () => {
    const s = await store();
    await expect(s.list('not-hex')).rejects.toThrow();
  });
});
