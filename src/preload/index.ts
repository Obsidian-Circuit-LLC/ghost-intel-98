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
    deleteAttachment: (id: string, name: string) => ipcRenderer.invoke(channels.files.deleteAttachment, id, name),
    readAttachmentText: (id: string, name: string) => ipcRenderer.invoke(channels.files.readAttachmentText, id, name),
    readAttachmentBytes: (id: string, name: string, offset: number, length: number) =>
      ipcRenderer.invoke(channels.files.readAttachmentBytes, id, name, offset, length),
    readEml: (id: string, name: string) => ipcRenderer.invoke(channels.files.readEml, id, name),
    extractAttachmentMeta: (id: string, name: string) => ipcRenderer.invoke(channels.files.extractAttachmentMeta, id, name),
    renameAttachment: (id: string, name: string, newName: string) => ipcRenderer.invoke(channels.files.renameAttachment, id, name, newName),
    pickOpen: (opts?: { multi?: boolean; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke(channels.files.pickOpen, opts),
    pickSave: (opts?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke(channels.files.pickSave, opts)
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
    },
    onDiagnostic: (cb: (payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[] }) => void) => {
      const listener = (_e: unknown, payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[] }) => cb(payload);
      ipcRenderer.on(channels.system.onDiagnostic, listener);
      return () => ipcRenderer.removeListener(channels.system.onDiagnostic, listener);
    }
  },
  mail: {
    listAccounts: () => ipcRenderer.invoke(channels.mail.listAccounts),
    upsertAccount: (input: unknown) => ipcRenderer.invoke(channels.mail.upsertAccount, input),
    deleteAccount: (id: string) => ipcRenderer.invoke(channels.mail.deleteAccount, id),
    testAccount: (input: unknown) => ipcRenderer.invoke(channels.mail.testAccount, input),
    fetchInbox: (id: string, limit?: number) => ipcRenderer.invoke(channels.mail.fetchInbox, id, limit),
    fetchMessage: (id: string, uid: number) => ipcRenderer.invoke(channels.mail.fetchMessage, id, uid),
    send: (input: unknown) => ipcRenderer.invoke(channels.mail.send, input),
    listDrafts: (accountId?: string) => ipcRenderer.invoke(channels.mail.listDrafts, accountId),
    upsertDraft: (input: unknown) => ipcRenderer.invoke(channels.mail.upsertDraft, input),
    deleteDraft: (id: string) => ipcRenderer.invoke(channels.mail.deleteDraft, id),
    saveAttachment: (input: { filename: string; contentBase64: string }) => ipcRenderer.invoke(channels.mail.saveAttachment, input)
  },
  browser: {
    listBookmarks: () => ipcRenderer.invoke(channels.browser.listBookmarks),
    addBookmark: (title: string, url: string) => ipcRenderer.invoke(channels.browser.addBookmark, title, url),
    deleteBookmark: (id: string) => ipcRenderer.invoke(channels.browser.deleteBookmark, id),
    listHistory: (limit?: number) => ipcRenderer.invoke(channels.browser.listHistory, limit),
    addHistory: (url: string, title: string) => ipcRenderer.invoke(channels.browser.addHistory, url, title),
    clearHistory: () => ipcRenderer.invoke(channels.browser.clearHistory)
  },
  ssh: {
    listHosts: () => ipcRenderer.invoke(channels.ssh.listHosts),
    upsertHost: (input: unknown) => ipcRenderer.invoke(channels.ssh.upsertHost, input),
    deleteHost: (id: string) => ipcRenderer.invoke(channels.ssh.deleteHost, id),
    connect: (hostId: string) => ipcRenderer.invoke(channels.ssh.connect, hostId),
    write: (sessionId: string, data: string) => ipcRenderer.invoke(channels.ssh.write, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke(channels.ssh.resize, sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.invoke(channels.ssh.disconnect, sessionId),
    onData: (cb: (payload: { sessionId: string; data: string }) => void) => {
      const l = (_e: unknown, p: { sessionId: string; data: string }) => cb(p);
      ipcRenderer.on(channels.ssh.onData, l);
      return () => ipcRenderer.removeListener(channels.ssh.onData, l);
    },
    onClose: (cb: (payload: { sessionId: string; reason: string }) => void) => {
      const l = (_e: unknown, p: { sessionId: string; reason: string }) => cb(p);
      ipcRenderer.on(channels.ssh.onClose, l);
      return () => ipcRenderer.removeListener(channels.ssh.onClose, l);
    }
  },
  streams: {
    list: () => ipcRenderer.invoke(channels.streams.list),
    upsert: (input: unknown) => ipcRenderer.invoke(channels.streams.upsert, input),
    delete: (id: string) => ipcRenderer.invoke(channels.streams.delete, id)
  },
  ai: {
    chatStream: (streamId: string, req: unknown) => ipcRenderer.invoke(channels.ai.chatStream, streamId, req),
    cancel: (streamId: string) => ipcRenderer.invoke(channels.ai.chat, streamId),
    setApiKey: (value: string) => ipcRenderer.invoke(channels.ai.setApiKey, value),
    onChunk: (cb: (payload: { streamId: string; chunk?: string; done?: boolean; error?: string }) => void) => {
      const l = (_e: unknown, p: { streamId: string; chunk?: string; done?: boolean; error?: string }) => cb(p);
      ipcRenderer.on(channels.ai.onChatChunk, l);
      return () => ipcRenderer.removeListener(channels.ai.onChatChunk, l);
    }
  },
  entities: {
    listAll: () => ipcRenderer.invoke(channels.entities.listAll),
    create: (input: unknown) => ipcRenderer.invoke(channels.entities.create, input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke(channels.entities.update, id, patch),
    delete: (id: string) => ipcRenderer.invoke(channels.entities.delete, id),
    merge: (keepId: string, mergeId: string) => ipcRenderer.invoke(channels.entities.merge, keepId, mergeId),
    linkToCase: (caseId: string, entityId: string, opts: unknown) => ipcRenderer.invoke(channels.entities.linkToCase, caseId, entityId, opts),
    unlinkFromCase: (caseId: string, entityId: string) => ipcRenderer.invoke(channels.entities.unlinkFromCase, caseId, entityId),
    setRelationship: (caseId: string, entityId: string, rel: string | null) => ipcRenderer.invoke(channels.entities.setRelationship, caseId, entityId, rel),
    casesForEntity: (entityId: string) => ipcRenderer.invoke(channels.entities.casesForEntity, entityId)
  },
  bioImages: {
    add: (caseId: string, input: unknown) => ipcRenderer.invoke(channels.bioImages.add, caseId, input),
    delete: (caseId: string, id: string) => ipcRenderer.invoke(channels.bioImages.delete, caseId, id),
    setPrimary: (caseId: string, id: string) => ipcRenderer.invoke(channels.bioImages.setPrimary, caseId, id),
    updateCaption: (caseId: string, id: string, caption: string) => ipcRenderer.invoke(channels.bioImages.updateCaption, caseId, id, caption),
    readOriginal: (caseId: string, id: string) => ipcRenderer.invoke(channels.bioImages.readOriginal, caseId, id),
    reveal: (caseId: string, fileName: string) => ipcRenderer.invoke(channels.bioImages.reveal, caseId, fileName)
  },
  export: {
    summaryHtml: (caseId: string) => ipcRenderer.invoke(channels.export.summaryHtml, caseId),
    summaryPdf: (caseId: string) => ipcRenderer.invoke(channels.export.summaryPdf, caseId),
    timelineCsv: (caseId: string) => ipcRenderer.invoke(channels.export.timelineCsv, caseId),
    linksCsv: (caseId: string) => ipcRenderer.invoke(channels.export.linksCsv, caseId),
    entitiesCsv: (caseId: string) => ipcRenderer.invoke(channels.export.entitiesCsv, caseId),
    attachmentsCsv: (caseId: string) => ipcRenderer.invoke(channels.export.attachmentsCsv, caseId),
    text: (defaultName: string, content: string) => ipcRenderer.invoke(channels.export.text, defaultName, content)
  },
  search: {
    query: (q: string) => ipcRenderer.invoke(channels.search.query, q)
  }
} as const;

contextBridge.exposeInMainWorld('api', api);

export type GhostApi = typeof api;
