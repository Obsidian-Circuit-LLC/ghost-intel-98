/**
 * Regression test for the inbox-retrieval bug: a full inbox of unseen mail used to fill every slot
 * with the OLDEST unseen messages (FETCH yields ascending sequence order, and the code broke at the
 * first `limit`), so a just-arrived message — e.g. a self-sent test — was never retrieved. The fix
 * fetches the NEWEST `limit` by sequence (`start:*`), independent of the \Seen flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake ImapFlow whose `fetch` records the requested range and yields a fixed message list.
const fetchCalls: { range: unknown }[] = [];
let MESSAGES: Array<{ uid: number; seq: number; subject: string; flags: Set<string>; date: Date }> = [];
let MBOX_EXISTS = 0;

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    mailboxOpen: vi.fn().mockResolvedValue({ exists: MBOX_EXISTS }),
    // imapflow's fetch(range, query) returns an async iterable of message objects.
    fetch: vi.fn((range: unknown) => {
      fetchCalls.push({ range });
      return (async function* () {
        for (const m of MESSAGES) {
          yield { uid: m.uid, seq: m.seq, envelope: { subject: m.subject, from: [], to: [] }, internalDate: m.date, flags: m.flags };
        }
      })();
    })
  }))
}));

import * as accountStore from '../src/main/storage/accounts';
import { secretStore } from '../src/main/secrets';
import { fetchInbox } from '../src/main/services/mail';

const ACCT = {
  id: 'a1', label: 'Test', imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
  smtpHost: 's', smtpPort: 465, smtpSecure: true, user: 'me@example.com', passwordRef: 'ref'
};

beforeEach(() => {
  fetchCalls.length = 0;
  vi.spyOn(accountStore, 'listAccounts').mockResolvedValue([ACCT] as never);
  vi.spyOn(secretStore, 'get').mockResolvedValue('pw');
});

describe('fetchInbox', () => {
  it('requests the newest `limit` by sequence range, not a seen/unseen slice', async () => {
    MBOX_EXISTS = 1000;
    MESSAGES = [{ uid: 9001, seq: 1000, subject: 'newest', flags: new Set(), date: new Date('2026-06-13T20:00:00Z') }];
    await fetchInbox('a1', 30);
    // start = 1000 - 30 + 1 = 971 → range '971:*'
    expect(fetchCalls[0].range).toBe('971:*');
  });

  it('never asks for a sequence below 1 even when the inbox is smaller than the limit', async () => {
    MBOX_EXISTS = 5;
    MESSAGES = [{ uid: 1, seq: 1, subject: 's', flags: new Set(), date: new Date() }];
    await fetchInbox('a1', 30);
    expect(fetchCalls[0].range).toBe('1:*');
  });

  it('returns empty (and does not fetch) for an empty mailbox', async () => {
    MBOX_EXISTS = 0;
    MESSAGES = [];
    expect(await fetchInbox('a1', 30)).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
  });

  it('derives `unseen` from the \\Seen flag, not the fetch bucket', async () => {
    MBOX_EXISTS = 2;
    MESSAGES = [
      { uid: 1, seq: 1, subject: 'read', flags: new Set(['\\Seen']), date: new Date('2026-06-13T10:00:00Z') },
      { uid: 2, seq: 2, subject: 'unread', flags: new Set(), date: new Date('2026-06-13T11:00:00Z') }
    ];
    const out = await fetchInbox('a1', 30);
    const read = out.find((m) => m.uid === 1)!;
    const unread = out.find((m) => m.uid === 2)!;
    expect(read.unseen).toBe(false);
    expect(unread.unseen).toBe(true);
    // newest-first ordering by date
    expect(out[0].uid).toBe(2);
  });
});
