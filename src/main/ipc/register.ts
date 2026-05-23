/**
 * Wires every IPC channel from src/shared/ipc-contracts.ts to a storage-layer call.
 * Called once at app ready.
 */

import { app, ipcMain, shell, BrowserWindow } from 'electron';
import { channels } from '@shared/ipc-contracts';
import {
  caseStore,
  fileStore,
  noteStore,
  reminderStore,
  settingsStore,
  shredStore
} from '../storage/json-fs';
import { fileStore as files } from '../storage/json-fs';
import { showNotification } from '../notifications';
import { dataRoot } from '../storage/paths';

export function registerIpc(): void {
  // ---- system ----
  ipcMain.handle(channels.system.appInfo, () => ({
    version: app.getVersion(),
    userData: dataRoot(),
    platform: process.platform
  }));
  ipcMain.handle(channels.system.openExternal, async (_e, url: string) => {
    await shell.openExternal(url);
  });

  // ---- settings ----
  ipcMain.handle(channels.settings.read, () => settingsStore.read());
  ipcMain.handle(channels.settings.update, (_e, patch) => settingsStore.update(patch));

  // ---- cases ----
  ipcMain.handle(channels.cases.list, () => caseStore.list());
  ipcMain.handle(channels.cases.create, (_e, input) => caseStore.create(input));
  ipcMain.handle(channels.cases.read, (_e, id) => caseStore.read(id));
  ipcMain.handle(channels.cases.rename, (_e, id, title) => caseStore.rename(id, title));
  ipcMain.handle(channels.cases.update, (_e, id, patch) => caseStore.update(id, patch));
  ipcMain.handle(channels.cases.archive, (_e, id, archived) => caseStore.archive(id, archived));
  ipcMain.handle(channels.cases.delete, (_e, id) => caseStore.softDelete(id));
  ipcMain.handle(channels.cases.addTimeline, (_e, id, ev) => caseStore.addTimeline(id, ev));
  ipcMain.handle(channels.cases.addTask, (_e, id, text, dueAt) => caseStore.addTask(id, text, dueAt));
  ipcMain.handle(channels.cases.toggleTask, (_e, id, taskId) => caseStore.toggleTask(id, taskId));
  ipcMain.handle(channels.cases.deleteTask, (_e, id, taskId) => caseStore.deleteTask(id, taskId));
  ipcMain.handle(channels.cases.addLink, (_e, id, url, title) => caseStore.addLink(id, url, title));
  ipcMain.handle(channels.cases.deleteLink, (_e, id, linkId) => caseStore.deleteLink(id, linkId));
  ipcMain.handle(channels.cases.addReminder, (_e, id, r) => caseStore.addReminder(id, r));
  ipcMain.handle(channels.cases.deleteReminder, (_e, id, rid) => caseStore.deleteReminder(id, rid));

  // ---- files ----
  ipcMain.handle(channels.files.importDropped, (_e, id, list) => files.importDropped(id, list));
  ipcMain.handle(channels.files.listAttachments, (_e, id) => fileStore.listAttachments(id));
  ipcMain.handle(channels.files.deleteAttachment, (_e, id, name) => fileStore.deleteAttachment(id, name));
  ipcMain.handle(channels.files.revealAttachment, (_e, id, name) => {
    const path = fileStore.attachmentAbsolutePath(id, name);
    shell.showItemInFolder(path);
  });

  // ---- notes ----
  ipcMain.handle(channels.notes.list, (_e, id) => noteStore.list(id));
  ipcMain.handle(channels.notes.read, (_e, id, name) => noteStore.read(id, name));
  ipcMain.handle(channels.notes.write, (_e, id, name, body) => noteStore.write(id, name, body));
  ipcMain.handle(channels.notes.delete, (_e, id, name) => noteStore.delete(id, name));

  // ---- reminders (global) ----
  ipcMain.handle(channels.reminders.listGlobal, () => reminderStore.listGlobal());
  ipcMain.handle(channels.reminders.upsertGlobal, (_e, r) => reminderStore.upsertGlobal(r));
  ipcMain.handle(channels.reminders.deleteGlobal, (_e, id) => reminderStore.deleteGlobal(id));

  // ---- shred ----
  ipcMain.handle(channels.shred.list, () => shredStore.list());
  ipcMain.handle(channels.shred.restore, (_e, id) => shredStore.restore(id));
  ipcMain.handle(channels.shred.purge, (_e, id) => shredStore.purge(id));
  ipcMain.handle(channels.shred.purgeAll, () => shredStore.purgeAll());
}

/** Reminder tick: every 30s, pull due reminders, fire notifications + emit IPC to renderer. */
export function startReminderTicker(getWindow: () => BrowserWindow | null): NodeJS.Timeout {
  const interval = setInterval(async () => {
    try {
      const due = await reminderStore.drainDue(new Date());
      if (due.length === 0) return;
      const win = getWindow();
      for (const r of due) {
        showNotification(r.title, r.body);
        if (win) win.webContents.send(channels.system.onReminderFired, { reminder: r });
      }
    } catch (err) {
      // never crash the ticker; surface in main-process log
      console.error('[reminder-ticker]', err);
    }
  }, 30_000);
  return interval;
}
