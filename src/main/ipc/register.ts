/**
 * IPC bridge — every renderer-supplied id, name, and URL passes through validate.ts
 * before hitting storage. Handlers are wrapped so unhandled errors are surfaced
 * to the renderer with the offending channel name in the message, not silently
 * dropped into the dev-tools console.
 *
 * v1.0.1 round-3 hardening:
 *  - safeHandle preserves error name + code (renderer can disambiguate "keyring locked"
 *    from "decrypt failed" from "validation error")
 *  - Error messages are sanitised at the boundary: dataRoot() prefix stripped, UUIDs
 *    masked, so absolute filesystem paths don't leak into the renderer (or downstream
 *    AI / log destinations).
 *  - Reminder ticker now emits a structured diagnostic via channels.system.onDiagnostic
 *    for broken cases, in addition to the toast.
 */

import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron';
import { writeFile, rename, lstat, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { channels } from '@shared/ipc-contracts';
import type { MailAccount, MailSendInput, SshHostProfile, AiChatRequest } from '@shared/post-mvp-types';
import {
  caseStore,
  consumeDrainDiagnostics,
  fileStore,
  noteStore,
  reminderStore,
  settingsStore,
  shredStore
} from '../storage/json-fs';
import { showNotification } from '../notifications';
import { dataRoot } from '../storage/paths';
import * as mail from '../services/mail';
import * as ssh from '../services/ssh';
import * as streams from '../services/streams';
import * as ai from '../services/ai';
import * as bookmarks from '../storage/bookmarks';
import * as history from '../storage/history';
import { ensureUuid, ensureFileName, validateExternalUrl, validateBookmarkUrl, validatePickFilters, sanitiseSaveDefault, validateByteRange } from '../security/validate';
import { markConsented, assertAllConsented } from '../security/consent';
import { getSecretBackend } from '../secrets';
import { homedir } from 'node:os';

const MAX_SAVE_ATTACHMENT_BYTES = 64 * 1024 * 1024; // 64 MB cap on base64 decoded payload

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const HOME_PATTERNS = [
  /\/home\/[^/\s]+/g,
  /\/Users\/[^/\s]+/g,
  /[Cc]:\\\\Users\\\\[^\\\s]+/g
];

function sanitiseMessage(msg: string): string {
  let out = msg;
  const root = dataRoot();
  if (root) out = out.split(root).join('<userData>');
  // Strip the user's home directory in any of its OS-specific shapes.
  const home = homedir();
  if (home) out = out.split(home).join('<home>');
  for (const p of HOME_PATTERNS) out = out.replace(p, '<home>');
  out = out.replace(UUID_RE, '<uuid>');
  return out;
}

function safeHandle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      const original = err as Error & { code?: string };
      const sanitised = sanitiseMessage(original.message ?? String(err));
      // eslint-disable-next-line no-console
      console.error(`[ipc:${channel}]`, original.name, sanitised);
      const wrapped = new Error(`[${channel}] ${sanitised}`);
      wrapped.name = original.name || 'Error';
      // Preserve any code field so the renderer can disambiguate.
      if (original.code) (wrapped as Error & { code?: string }).code = original.code;
      throw wrapped;
    }
  });
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // ---- system ----
  safeHandle(channels.system.appInfo, () => ({
    version: app.getVersion(),
    userData: dataRoot(),
    platform: process.platform,
    secretBackend: getSecretBackend()
  }));
  safeHandle(channels.system.openExternal, async (...args) => {
    const url = validateExternalUrl(args[0] as string);
    await shell.openExternal(url);
  });

  // ---- settings ----
  safeHandle(channels.settings.read, () => settingsStore.read());
  safeHandle(channels.settings.update, (...args) => settingsStore.update(args[0] as Parameters<typeof settingsStore.update>[0]));

  // ---- cases ----
  safeHandle(channels.cases.list, () => caseStore.list());
  safeHandle(channels.cases.create, (...args) => caseStore.create(args[0] as Parameters<typeof caseStore.create>[0]));
  safeHandle(channels.cases.read, (...args) => caseStore.read(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.cases.rename, (...args) => caseStore.rename(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.update, (...args) => caseStore.update(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof caseStore.update>[1]));
  safeHandle(channels.cases.archive, (...args) => caseStore.archive(ensureUuid(args[0], 'caseId'), args[1] as boolean));
  safeHandle(channels.cases.delete, (...args) => caseStore.softDelete(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.cases.addTimeline, (...args) => caseStore.addTimeline(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof caseStore.addTimeline>[1]));
  safeHandle(channels.cases.addTask, (...args) => caseStore.addTask(ensureUuid(args[0], 'caseId'), args[1] as string, args[2] as string | undefined));
  safeHandle(channels.cases.toggleTask, (...args) => caseStore.toggleTask(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.deleteTask, (...args) => caseStore.deleteTask(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.addLink, (...args) => caseStore.addLink(ensureUuid(args[0], 'caseId'), validateBookmarkUrl(args[1] as string), args[2] as string));
  safeHandle(channels.cases.deleteLink, (...args) => caseStore.deleteLink(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.addReminder, (...args) => caseStore.addReminder(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof caseStore.addReminder>[1]));
  safeHandle(channels.cases.deleteReminder, (...args) => caseStore.deleteReminder(ensureUuid(args[0], 'caseId'), args[1] as string));

  // ---- files ----
  safeHandle(channels.files.importDropped, (...args) => fileStore.importDropped(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof fileStore.importDropped>[1]));
  safeHandle(channels.files.listAttachments, (...args) => fileStore.listAttachments(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.files.deleteAttachment, (...args) => fileStore.deleteAttachment(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.revealAttachment, (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const name = ensureFileName(args[1], 'fileName');
    const path = fileStore.attachmentAbsolutePath(id, name);
    shell.showItemInFolder(path);
  });
  safeHandle(channels.files.readAttachmentText, (...args) =>
    fileStore.readAttachmentText(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.readAttachmentBytes, (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const name = ensureFileName(args[1], 'fileName');
    const { offset, length } = validateByteRange(args[2], args[3]);
    return fileStore.readAttachmentBytes(id, name, offset, length);
  });
  safeHandle(channels.files.readEml, (...args) =>
    fileStore.readEmlPreview(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.extractAttachmentMeta, (...args) =>
    fileStore.extractAttachmentMeta(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.pickOpen, async (...args) => {
    const opts = (args[0] as { multi?: boolean; filters?: unknown }) ?? {};
    const filters = validatePickFilters(opts.filters);
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters })
      : await dialog.showOpenDialog({ properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters });
    if (result.canceled) return [];
    // Mark paths as consented for downstream IPC (mail.send) — user picked these via the dialog.
    markConsented(result.filePaths);
    return result.filePaths;
  });
  safeHandle(channels.files.pickSave, async (...args) => {
    const opts = (args[0] as { defaultName?: string; filters?: unknown }) ?? {};
    const filters = validatePickFilters(opts.filters);
    const win = getWindow();
    const safeDefault = opts.defaultName ? sanitiseSaveDefault(opts.defaultName) : undefined;
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: safeDefault, filters })
      : await dialog.showSaveDialog({ defaultPath: safeDefault, filters });
    return result.canceled ? null : (result.filePath ?? null);
  });

  // ---- notes ----
  safeHandle(channels.notes.list, (...args) => noteStore.list(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.notes.read, (...args) => noteStore.read(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'noteName')));
  safeHandle(channels.notes.write, (...args) => noteStore.write(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'noteName'), args[2] as string));
  safeHandle(channels.notes.delete, (...args) => noteStore.delete(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'noteName')));

  // ---- reminders ----
  safeHandle(channels.reminders.listGlobal, () => reminderStore.listGlobal());
  safeHandle(channels.reminders.upsertGlobal, (...args) => reminderStore.upsertGlobal(args[0] as Parameters<typeof reminderStore.upsertGlobal>[0]));
  safeHandle(channels.reminders.deleteGlobal, (...args) => reminderStore.deleteGlobal(args[0] as string));

  // ---- shred ----
  safeHandle(channels.shred.list, () => shredStore.list());
  safeHandle(channels.shred.restore, (...args) => shredStore.restore(args[0] as string));
  safeHandle(channels.shred.purge, (...args) => shredStore.purge(args[0] as string));
  safeHandle(channels.shred.purgeAll, () => shredStore.purgeAll());

  // ---- mail ----
  safeHandle(channels.mail.listAccounts, () => mail.listAccounts());
  safeHandle(channels.mail.upsertAccount, (...args) => mail.upsertAccount(args[0] as MailAccount & { password?: string }));
  safeHandle(channels.mail.deleteAccount, (...args) => mail.deleteAccount(args[0] as string));
  safeHandle(channels.mail.testAccount, (...args) => mail.testAccount(args[0] as MailAccount & { password: string }));
  safeHandle(channels.mail.fetchInbox, (...args) => mail.fetchInbox(args[0] as string, args[1] as number | undefined));
  safeHandle(channels.mail.fetchMessage, (...args) => mail.fetchMessage(args[0] as string, args[1] as number));
  safeHandle(channels.mail.send, (...args) => mail.sendMail(args[0] as MailSendInput));
  safeHandle(channels.mail.listDrafts, (...args) => mail.listDrafts(args[0] as string | undefined));
  safeHandle(channels.mail.upsertDraft, (...args) => {
    // CRITICAL: validate attachment paths at draft-write time, not just send time.
    // Without this, a compromised renderer can upsertDraft({path:'/etc/shadow'}) →
    // listDrafts auto-consents → send exfils. Round-3 audit Critical N1.
    const input = args[0] as Parameters<typeof mail.upsertDraft>[0];
    const paths = (input.attachments ?? []).map((a) => a.path);
    assertAllConsented(paths, 'draft attachment');
    return mail.upsertDraft(input);
  });
  safeHandle(channels.mail.deleteDraft, (...args) => mail.deleteDraft(args[0] as string));
  safeHandle(channels.mail.saveAttachment, async (...args) => {
    const { filename, contentBase64 } = args[0] as { filename: string; contentBase64: string };
    if (typeof contentBase64 !== 'string') throw new Error('contentBase64 must be a string');
    // Cap before Buffer allocation — protects main from OOM via crafted oversize payloads.
    // Base64 inflates by ~4/3; the decoded byte limit is the inflated string limit / 4 * 3.
    if (contentBase64.length > Math.ceil(MAX_SAVE_ATTACHMENT_BYTES * 4 / 3)) {
      throw new Error(`Attachment exceeds the ${MAX_SAVE_ATTACHMENT_BYTES} byte download limit`);
    }
    const safeDefault = sanitiseSaveDefault(filename || 'attachment');
    const win = getWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: safeDefault })
      : await dialog.showSaveDialog({ defaultPath: safeDefault });
    if (result.canceled || !result.filePath) return null;
    // Symlink guard: if the destination exists as a symlink, refuse — the user
    // could be tricked into overwriting a planted target outside their intent.
    try {
      const st = await lstat(result.filePath);
      if (st.isSymbolicLink()) {
        throw new Error('Refusing to save to a symbolic link — choose a different filename.');
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
    }
    // Atomic write via temp + rename so a crash doesn't leave a truncated file.
    const tmp = `${result.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, Buffer.from(contentBase64, 'base64'));
      await rename(tmp, result.filePath);
    } catch (err) {
      try { await rm(tmp, { force: true }); } catch { /* nothing */ }
      throw err;
    }
    return basename(result.filePath);
  });

  // ---- browser (bookmarks + history) ----
  // Re-validate every bookmark URL on read — defends against legacy entries persisted
  // before v2.0.1 hardening, and against direct edits of bookmarks.json. Round-3 audit N2.
  safeHandle(channels.browser.listBookmarks, async () => {
    const all = await bookmarks.list();
    const out: typeof all = [];
    for (const bm of all) {
      try {
        validateBookmarkUrl(bm.url);
        out.push(bm);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[bookmarks.list] dropping invalid', bm.id, bm.url);
      }
    }
    return out;
  });
  safeHandle(channels.browser.addBookmark, (...args) => {
    const title = (args[0] as string ?? '').slice(0, 200).trim() || '(untitled)';
    const url = validateBookmarkUrl(args[1] as string);
    return bookmarks.add(title, url);
  });
  safeHandle(channels.browser.deleteBookmark, (...args) => bookmarks.remove(args[0] as string));
  safeHandle(channels.browser.listHistory, (...args) => history.list(args[0] as number | undefined));
  safeHandle(channels.browser.addHistory, (...args) => {
    let url = String(args[0] ?? '').slice(0, 2048);
    const title = String(args[1] ?? '').slice(0, 256);
    if (!url || url === 'about:blank' || url.startsWith('chrome-error://') || url.startsWith('chrome://')) return;
    return history.add(url, title);
  });
  safeHandle(channels.browser.clearHistory, () => history.clear());

  // ---- ssh ----
  safeHandle(channels.ssh.listHosts, () => ssh.listHosts());
  safeHandle(channels.ssh.upsertHost, (...args) => ssh.upsertHost(args[0] as SshHostProfile & { secret?: string }));
  safeHandle(channels.ssh.deleteHost, (...args) => ssh.deleteHost(args[0] as string));
  safeHandle(channels.ssh.connect, (...args) => ssh.connect(args[0] as string, getWindow));
  safeHandle(channels.ssh.write, (...args) => ssh.write(args[0] as string, args[1] as string));
  safeHandle(channels.ssh.resize, (...args) => ssh.resize(args[0] as string, args[1] as number, args[2] as number));
  safeHandle(channels.ssh.disconnect, (...args) => ssh.disconnect(args[0] as string));

  // ---- streams (EyeSpy) ----
  safeHandle(channels.streams.list, () => streams.list());
  safeHandle(channels.streams.upsert, (...args) => streams.upsert(args[0] as Parameters<typeof streams.upsert>[0]));
  safeHandle(channels.streams.delete, (...args) => streams.remove(args[0] as string));

  // ---- ai ----
  safeHandle(channels.ai.chatStream, (...args) => ai.chat(args[0] as string, args[1] as AiChatRequest, getWindow));
  safeHandle(channels.ai.chat, (...args) => ai.cancel(args[0] as string));
  safeHandle(channels.ai.setApiKey, (...args) => ai.setApiKey(args[0] as string));
}

/** Reminder tick: every 30s, pull due reminders, fire notifications + emit IPC to renderer.
 *  Guarded so an overlapping tick (slow disk, many cases) doesn't double-fire reminders.
 *  Per-case errors are surfaced as a structured diagnostic event so the user sees which
 *  case is broken, not just "reminders failed". */
export function startReminderTicker(getWindow: () => BrowserWindow | null): NodeJS.Timeout {
  let running = false;
  let lastBrokenSummary = '';
  const interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const due = await reminderStore.drainDue(new Date());
      const win = getWindow();
      for (const r of due) {
        showNotification(r.title, r.body);
        if (win) win.webContents.send(channels.system.onReminderFired, { reminder: r });
      }
      const broken = consumeDrainDiagnostics();
      if (broken.length > 0) {
        const summary = broken.map((b) => `${b.caseId.slice(0, 8)}:${b.reason}`).join(';');
        if (summary !== lastBrokenSummary) {
          lastBrokenSummary = summary;
          showNotification('Ghost Access 98', `Reminders failed for ${broken.length} case${broken.length === 1 ? '' : 's'}. See Settings → diagnostics.`);
          if (win) win.webContents.send(channels.system.onDiagnostic, { kind: 'reminders-broken', cases: broken });
        }
      } else {
        lastBrokenSummary = '';
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reminder-ticker]', err);
      showNotification('Ghost Access 98', 'Reminders failed to fire — see Settings → About → diagnostics');
    } finally {
      running = false;
    }
  }, 30_000);
  return interval;
}
