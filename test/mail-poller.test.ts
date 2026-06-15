import { describe, it, expect, vi, beforeEach } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

let bgEnabled = true;
let accounts: { id: string }[] = [{ id: 'acc1' }];
let unseenByAccount: Record<string, number> = { acc1: 0 };

vi.mock('../src/main/storage/json-fs', () => ({
  settingsStore: { read: () => Promise.resolve({ mailBackgroundCheck: bgEnabled }) }
}));
vi.mock('../src/main/services/mail', () => ({
  listAccounts: () => Promise.resolve(accounts),
  fetchInbox: (accId: string) =>
    Promise.resolve(Array.from({ length: unseenByAccount[accId] ?? 0 }, () => ({ unseen: true })))
}));

import { pollOnce, stopMailPoller } from '../src/main/services/mail-poller';

function fakeWindow() {
  const sent: { ch: string; payload: any }[] = [];
  return { win: { webContents: { send: (ch: string, payload: any) => sent.push({ ch, payload }) } }, sent };
}

beforeEach(() => {
  stopMailPoller();               // clears the module-level baseline between tests
  bgEnabled = true; accounts = [{ id: 'acc1' }]; unseenByAccount = { acc1: 0 };
});

describe('mail-poller pollOnce', () => {
  it('primes the baseline on first poll without emitting', async () => {
    unseenByAccount.acc1 = 3;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any);
    expect(sent.length).toBe(0);
  });
  it('emits onNewMail when unseen increases after priming', async () => {
    unseenByAccount.acc1 = 1;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any);   // prime at 1
    unseenByAccount.acc1 = 4;
    await pollOnce(() => win as any);   // increase → emit
    const evt = sent.find((s) => s.ch === channels.mail.onNewMail);
    expect(evt?.payload).toEqual({ accountId: 'acc1', unseenCount: 4 });
  });
  it('does not emit when unseen does not increase', async () => {
    unseenByAccount.acc1 = 2;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any);   // prime at 2
    unseenByAccount.acc1 = 2;
    await pollOnce(() => win as any);   // same → no emit
    expect(sent.length).toBe(0);
  });
  it('does nothing when mailBackgroundCheck is off', async () => {
    bgEnabled = false;
    unseenByAccount.acc1 = 5;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any);
    await pollOnce(() => win as any);
    expect(sent.length).toBe(0);
  });
});
