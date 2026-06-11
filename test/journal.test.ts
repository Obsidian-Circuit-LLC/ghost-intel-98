import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Mirror streams-service.test.ts: redirect the data root to a tmp dir and use the REAL secure-fs
// (plaintext on disk when no vault key is configured), so the journal store does real round-trips.
// A dedicated dir keeps the journal corpus isolated from the briefcase one — proving separation.
const DIR = '/tmp/ga98-journal-test';
vi.mock('electron', () => ({ app: { getPath: () => DIR } }));

import * as journal from '../src/main/storage/journal';
import * as briefcase from '../src/main/storage/briefcase';

// A monotonic fake clock so the lockout backoff is deterministic — no time.time() / Date.now()
// nondeterminism leaks into the security path under test.
let clock = 1_000_000;
function tick(ms: number): void { clock += ms; }

beforeEach(async () => {
  await rm(DIR, { recursive: true, force: true });
  clock = 1_000_000;
  journal._setClockForTest(() => clock);
  await journal._resetForTest();
});

afterAll(async () => { await rm(DIR, { recursive: true, force: true }); });

describe('journal store — entries', () => {
  it('round-trips an entry: save → read → list', async () => {
    const saved = await journal.save({ id: '', title: 'Day one', body: 'It begins.' });
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBeTruthy();

    const read = await journal.read(saved.id);
    expect(read?.title).toBe('Day one');
    expect(read?.body).toBe('It begins.');

    const list = await journal.list();
    expect(list.find((e) => e.id === saved.id)?.title).toBe('Day one');
  });

  it('updates an existing entry in place, preserving createdAt', async () => {
    const a = await journal.save({ id: '', title: 't', body: 'b1' });
    tick(5);
    const b = await journal.save({ id: a.id, title: 't', body: 'b2' });
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    const read = await journal.read(a.id);
    expect(read?.body).toBe('b2');
    expect((await journal.list()).filter((e) => e.id === a.id)).toHaveLength(1);
  });

  it('removes an entry', async () => {
    const a = await journal.save({ id: '', title: 'gone', body: 'x' });
    await journal.remove(a.id);
    expect(await journal.read(a.id)).toBeNull();
    expect((await journal.list()).find((e) => e.id === a.id)).toBeUndefined();
  });

  it('stores entries SEPARATELY from the briefcase — neither corpus bleeds into the other', async () => {
    const j = await journal.save({ id: '', title: 'journal', body: 'private' });
    await briefcase.save({ id: '11111111-1111-4111-8111-111111111111', name: 'bc', body: 'note' });

    // Journal entry is not visible to the briefcase, and vice versa.
    expect((await briefcase.list()).find((n) => n.id === j.id)).toBeUndefined();
    expect((await journal.list()).find((e) => e.name === 'bc')).toBeUndefined();

    // And they live in different files on disk.
    const journalRaw = await readFile(join(DIR, 'GhostAccess98', 'journal.json'), 'utf8');
    expect(journalRaw).toContain('private');
    expect(journalRaw).not.toContain('note');
  });
});

describe('journal store — PIN gate', () => {
  it('starts with no PIN set', async () => {
    expect(await journal.hasPin()).toBe(false);
  });

  it('sets a PIN, then verifies the correct one and rejects the wrong one', async () => {
    await journal.setPin('1234');
    expect(await journal.hasPin()).toBe(true);
    expect(await journal.verifyPin('1234')).toBe(true);
    expect(await journal.verifyPin('0000')).toBe(false);
  });

  it('never stores the plaintext PIN — only salt + hash + params', async () => {
    await journal.setPin('4242');
    const raw = await readFile(join(DIR, 'GhostAccess98', 'journal-meta.json'), 'utf8');
    expect(raw).not.toContain('4242');
    const meta = JSON.parse(raw);
    expect(typeof meta.salt).toBe('string');
    expect(typeof meta.hash).toBe('string');
    expect(meta.params).toBeTruthy();
  });

  it('rejects a malformed PIN at setPin', async () => {
    await expect(journal.setPin('12')).rejects.toThrow();
    await expect(journal.setPin('12345')).rejects.toThrow();
    await expect(journal.setPin('12a4')).rejects.toThrow();
  });

  it('locks out after 5 consecutive wrong attempts, then a correct PIN is also refused during the lockout window', async () => {
    await journal.setPin('1234');
    for (let i = 0; i < 5; i++) expect(await journal.verifyPin('0000')).toBe(false);
    // 6th attempt — even the CORRECT pin is refused while locked out.
    expect(await journal.verifyPin('1234')).toBe(false);
    // Advance past the backoff window — the correct pin now succeeds and resets the counter.
    tick(60_000);
    expect(await journal.verifyPin('1234')).toBe(true);
    // Counter reset: a fresh wrong attempt does not immediately re-lock.
    expect(await journal.verifyPin('0000')).toBe(false);
    expect(await journal.verifyPin('1234')).toBe(true);
  });

  it('a correct PIN before the threshold resets the failure counter', async () => {
    await journal.setPin('1234');
    expect(await journal.verifyPin('0000')).toBe(false);
    expect(await journal.verifyPin('0000')).toBe(false);
    expect(await journal.verifyPin('1234')).toBe(true); // resets
    // Now we should get a full fresh budget of 4 more wrongs without lockout of the correct pin.
    for (let i = 0; i < 4; i++) expect(await journal.verifyPin('0000')).toBe(false);
    expect(await journal.verifyPin('1234')).toBe(true);
  });

  it('changePin requires the old PIN and rotates to the new one', async () => {
    await journal.setPin('1234');
    expect(await journal.changePin('9999', '5678')).toBe(false); // wrong old pin
    expect(await journal.verifyPin('1234')).toBe(true); // unchanged
    expect(await journal.changePin('1234', '5678')).toBe(true);
    expect(await journal.verifyPin('5678')).toBe(true);
    expect(await journal.verifyPin('1234')).toBe(false);
  });

  it('changePin rejects a malformed new PIN and leaves the old one intact', async () => {
    await journal.setPin('1234');
    await expect(journal.changePin('1234', '12')).rejects.toThrow();
    expect(await journal.verifyPin('1234')).toBe(true);
  });
});
