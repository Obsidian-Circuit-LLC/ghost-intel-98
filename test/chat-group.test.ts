import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import {
  encodeEnvelope,
  decodeEnvelope,
  SessionError,
  GROUP_ID_LEN,
  CONTACT_ID_LEN,
  MAX_GROUP_MEMBERS,
  type MessageContent
} from '../src/main/chat/session';
import { GroupStore } from '../src/main/chat/group-store';
import { randomBytes } from '../src/main/chat/crypto';

const gid = (): Uint8Array => randomBytes(GROUP_ID_LEN);
const cid = (): Uint8Array => randomBytes(CONTACT_ID_LEN);
const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

describe('group envelope (Phase 3) — round-trips + bounds', () => {
  it('round-trips a group-text message', () => {
    const msg: MessageContent = { type: 'group-text', groupId: gid(), text: 'hello team 🛡' };
    expect(decodeEnvelope(encodeEnvelope(msg))).toEqual(msg);
  });

  it('round-trips a group-invite with a member list', () => {
    const inv: MessageContent = { type: 'group-invite', groupId: gid(), name: 'case-7', memberIds: [cid(), cid(), cid()] };
    const decoded = decodeEnvelope(encodeEnvelope(inv));
    expect(decoded.type).toBe('group-invite');
    if (decoded.type !== 'group-invite') throw new Error('type');
    expect(hex(decoded.groupId)).toBe(hex(inv.groupId));
    expect(decoded.name).toBe('case-7');
    expect(decoded.memberIds.map(hex)).toEqual(inv.memberIds.map(hex));
  });

  it('round-trips a group-invite with an empty member list', () => {
    const inv: MessageContent = { type: 'group-invite', groupId: gid(), name: 'solo', memberIds: [] };
    const decoded = decodeEnvelope(encodeEnvelope(inv));
    expect(decoded.type === 'group-invite' && decoded.memberIds.length).toBe(0);
  });

  it('rejects an invite with too many members on encode', () => {
    const tooMany = Array.from({ length: MAX_GROUP_MEMBERS + 1 }, () => cid());
    expect(() => encodeEnvelope({ type: 'group-invite', groupId: gid(), name: 'x', memberIds: tooMany })).toThrow(SessionError);
  });

  it('rejects an invite with a bad member-id length on encode', () => {
    expect(() => encodeEnvelope({ type: 'group-invite', groupId: gid(), name: 'x', memberIds: [randomBytes(16)] })).toThrow(SessionError);
  });

  it('rejects an empty group name on encode', () => {
    expect(() => encodeEnvelope({ type: 'group-invite', groupId: gid(), name: '', memberIds: [] })).toThrow(SessionError);
  });

  it('rejects a truncated group message on decode', () => {
    // a group-text envelope must carry at least the 16-byte groupId after the 2-byte header
    expect(() => decodeEnvelope(new Uint8Array([1, 4, 0, 0, 0]))).toThrow(SessionError);
  });

  it('rejects an invite whose member count disagrees with the body length', () => {
    const inv: MessageContent = { type: 'group-invite', groupId: gid(), name: 'x', memberIds: [cid(), cid()] };
    const wire = encodeEnvelope(inv);
    // bump the count field (last 2 bytes before the member blob) — the length check must catch it.
    // count sits at: header(2) + groupId(16) + nameLen(2) + name(1 'x') = offset 21
    new DataView(wire.buffer).setUint16(2 + GROUP_ID_LEN + 2 + 1, 5);
    expect(() => decodeEnvelope(wire)).toThrow(SessionError);
  });
});

describe('GroupStore', () => {
  async function store(): Promise<GroupStore> {
    const dir = await mkdtemp(join(tmpdir(), 'dcs98-grp-'));
    return new GroupStore(join(dir, 'groups.json'));
  }
  const g32 = (): string => hex(randomBytes(16));
  const c64 = (): string => hex(randomBytes(32));

  it('creates, lists, and gets a group', async () => {
    const s = await store();
    const id = g32();
    const m = [c64(), c64()];
    await s.upsert({ groupId: id, name: 'team', memberIds: m, createdAt: 1 });
    expect((await s.list())).toHaveLength(1);
    expect((await s.get(id))?.name).toBe('team');
    expect((await s.get(id))?.memberIds).toEqual(m);
  });

  it('upsert merges members and updates the name (peer reconciliation)', async () => {
    const s = await store();
    const id = g32();
    const a = c64();
    const b = c64();
    const c = c64();
    await s.upsert({ groupId: id, name: 'v1', memberIds: [a, b], createdAt: 1 });
    await s.upsert({ groupId: id, name: 'v2', memberIds: [b, c], createdAt: 2 });
    const g = await s.get(id);
    expect(g?.name).toBe('v2');
    expect(new Set(g?.memberIds)).toEqual(new Set([a, b, c])); // union, deduped
    expect((await s.list())).toHaveLength(1); // still one row
  });

  it('setMembers replaces the member list; remove deletes the group', async () => {
    const s = await store();
    const id = g32();
    await s.upsert({ groupId: id, name: 't', memberIds: [c64()], createdAt: 1 });
    const next = [c64(), c64()];
    await s.setMembers(id, next);
    expect((await s.get(id))?.memberIds).toEqual(next);
    await s.remove(id);
    expect(await s.get(id)).toBeNull();
  });
});
