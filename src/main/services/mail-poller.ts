/**
 * Background mail poller (opt-in via settings.mailBackgroundCheck). Runs in main so it
 * checks mail even when the Mail window is closed. Tracks a per-account unseen baseline,
 * primes on first poll without firing, and emits mail:onNewMail when unseen increases.
 * No idle egress unless the setting is on.
 */
import type { BrowserWindow } from 'electron';
import { channels } from '@shared/ipc-contracts';
import { settingsStore } from '../storage/json-fs';
import { listAccounts, fetchInbox } from './mail';

const POLL_MS = 60_000;
const baseline = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;

export async function pollOnce(getWindow: () => BrowserWindow | null): Promise<void> {
  if (!(await settingsStore.read()).mailBackgroundCheck) return;
  let accounts: { id: string }[] = [];
  try { accounts = await listAccounts(); } catch { return; }
  for (const acc of accounts) {
    try {
      const list = await fetchInbox(acc.id, 30);
      const unseen = list.filter((m: { unseen?: boolean }) => m.unseen).length;
      const prev = baseline.get(acc.id);
      baseline.set(acc.id, unseen);
      if (prev === undefined) continue;          // prime, do not fire
      if (unseen > prev) {
        getWindow()?.webContents.send(channels.mail.onNewMail, { accountId: acc.id, unseenCount: unseen });
      }
    } catch { /* silent: transient IMAP errors don't spam */ }
  }
}

export function startMailPoller(getWindow: () => BrowserWindow | null): void {
  if (timer) return;
  timer = setInterval(() => { void pollOnce(getWindow); }, POLL_MS);
}

export function stopMailPoller(): void {
  if (timer) { clearInterval(timer); timer = null; }
  baseline.clear();
}
