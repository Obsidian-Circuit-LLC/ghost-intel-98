/**
 * Preload — the *only* surface the renderer sees. Every call goes through here.
 * Renderer never imports node, never sees ipcRenderer, never touches the FS directly.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { channels } from '../shared/ipc-contracts';

const api = {
  cases: {
    list: () => ipcRenderer.invoke(channels.cases.list),
    create: (input: unknown) => ipcRenderer.invoke(channels.cases.create, input),
    read: (id: string) => ipcRenderer.invoke(channels.cases.read, id),
    rename: (id: string, title: string) => ipcRenderer.invoke(channels.cases.rename, id, title),
    update: (id: string, patch: unknown) => ipcRenderer.invoke(channels.cases.update, id, patch),
    archive: (id: string, archived: boolean) => ipcRenderer.invoke(channels.cases.archive, id, archived),
    delete: (id: string) => ipcRenderer.invoke(channels.cases.delete, id),
    addTimeline: (id: string, ev: unknown) => ipcRenderer.invoke(channels.cases.addTimeline, id, ev),
    addTask: (id: string, text: string, dueAt?: string) => ipcRenderer.invoke(channels.cases.addTask, id, text, dueAt),
    toggleTask: (id: string, taskId: string) => ipcRenderer.invoke(channels.cases.toggleTask, id, taskId),
    deleteTask: (id: string, taskId: string) => ipcRenderer.invoke(channels.cases.deleteTask, id, taskId),
    addLink: (id: string, url: string, title: string) => ipcRenderer.invoke(channels.cases.addLink, id, url, title),
    deleteLink: (id: string, linkId: string) => ipcRenderer.invoke(channels.cases.deleteLink, id, linkId),
    addReminder: (id: string, r: unknown) => ipcRenderer.invoke(channels.cases.addReminder, id, r),
    deleteReminder: (id: string, rid: string) => ipcRenderer.invoke(channels.cases.deleteReminder, id, rid)
  },
  files: {
    /** Translate a renderer-side File (from a drop event) into the absolute OS path the main process needs. */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    importDropped: (id: string, list: { sourcePath: string; originalName: string }[]) =>
      ipcRenderer.invoke(channels.files.importDropped, id, list),
    listAttachments: (id: string) => ipcRenderer.invoke(channels.files.listAttachments, id),
    revealAttachment: (id: string, name: string) => ipcRenderer.invoke(channels.files.revealAttachment, id, name),
    deleteAttachment: (id: string, name: string) => ipcRenderer.invoke(channels.files.deleteAttachment, id, name)
  },
  notes: {
    list: (id: string) => ipcRenderer.invoke(channels.notes.list, id),
    read: (id: string, name: string) => ipcRenderer.invoke(channels.notes.read, id, name),
    write: (id: string, name: string, body: string) => ipcRenderer.invoke(channels.notes.write, id, name, body),
    delete: (id: string, name: string) => ipcRenderer.invoke(channels.notes.delete, id, name)
  },
  settings: {
    read: () => ipcRenderer.invoke(channels.settings.read),
    update: (patch: unknown) => ipcRenderer.invoke(channels.settings.update, patch)
  },
  reminders: {
    listGlobal: () => ipcRenderer.invoke(channels.reminders.listGlobal),
    upsertGlobal: (r: unknown) => ipcRenderer.invoke(channels.reminders.upsertGlobal, r),
    deleteGlobal: (id: string) => ipcRenderer.invoke(channels.reminders.deleteGlobal, id)
  },
  shred: {
    list: () => ipcRenderer.invoke(channels.shred.list),
    restore: (id: string) => ipcRenderer.invoke(channels.shred.restore, id),
    purge: (id: string) => ipcRenderer.invoke(channels.shred.purge, id),
    purgeAll: () => ipcRenderer.invoke(channels.shred.purgeAll)
  },
  system: {
    appInfo: () => ipcRenderer.invoke(channels.system.appInfo),
    openExternal: (url: string) => ipcRenderer.invoke(channels.system.openExternal, url),
    onReminderFired: (cb: (payload: { reminder: unknown }) => void) => {
      const listener = (_e: unknown, payload: { reminder: unknown }) => cb(payload);
      ipcRenderer.on(channels.system.onReminderFired, listener);
      return () => ipcRenderer.removeListener(channels.system.onReminderFired, listener);
    }
  }
} as const;

contextBridge.exposeInMainWorld('api', api);

export type GhostApi = typeof api;
