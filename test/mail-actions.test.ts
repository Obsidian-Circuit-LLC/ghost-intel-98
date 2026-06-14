import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { method: string; args: unknown[] }[] = [];
let MBOX_EXISTS = 0;
let MESSAGES: Array<{ uid: number; seq: number; subject: string; flags: Set<string>; date: Date }> = [];
let MAILBOXES: Array<{ path: string; specialUse?: string }> = [];

function rec(method: string) {
  return vi.fn((...args: unknown[]) => { calls.push({ method, args }); return Promise.resolve(undefined); });
}

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    mailboxOpen: vi.fn().mockResolvedValue({ exists: MBOX_EXISTS }),
    list: vi.fn(() => Promise.resolve(MAILBOXES)),
    messageFlagsAdd: rec('messageFlagsAdd'),
    messageFlagsRemove: rec('messageFlagsRemove'),
    messageMove: rec('messageMove'),
    fetch: vi.fn(() => (async function* () {
      for (const m of MESSAGES) yield { uid: m.uid, seq: m.seq, envelope: { subject: m.subject, from: [], to: [] }, internalDate: m.date, flags: m.flags };
    })())
  }))
}));

import * as accountStore from '../src/main/storage/accounts';
import { secretStore } from '../src/main/secrets';
import { fetchInbox } from '../src/main/services/mail';

const ACCT = { id: 'a1', label: 'T', imapHost: 'h', imapPort: 993, imapSecure: true, smtpHost: 's', smtpPort: 465, smtpSecure: true, user: 'me@example.com', passwordRef: 'ref' };

beforeEach(() => {
  calls.length = 0;
  MAILBOXES = [];
  vi.spyOn(accountStore, 'listAccounts').mockResolvedValue([ACCT] as never);
  vi.spyOn(secretStore, 'get').mockResolvedValue('pw');
});

describe('fetchInbox flagged', () => {
  it('sets flagged from the \\Flagged flag', async () => {
    MBOX_EXISTS = 1;
    MESSAGES = [{ uid: 7, seq: 1, subject: 's', flags: new Set(['\\Flagged']), date: new Date('2026-06-14T00:00:00Z') }];
    const out = await fetchInbox('a1', 30);
    expect(out[0].flagged).toBe(true);
  });
});

import { setFlag } from '../src/main/services/mail';

describe('setFlag', () => {
  it('adds the flag when value is true', async () => {
    await setFlag('a1', 7, '\\Flagged', true);
    const c = calls.find((x) => x.method === 'messageFlagsAdd')!;
    expect(c.args[0]).toBe('7');
    expect(c.args[1]).toEqual(['\\Flagged']);
  });
  it('removes the flag when value is false', async () => {
    await setFlag('a1', 7, '\\Flagged', false);
    expect(calls.some((x) => x.method === 'messageFlagsRemove')).toBe(true);
  });
});
