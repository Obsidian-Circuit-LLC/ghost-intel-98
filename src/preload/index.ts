/**
 * Preload — the *only* surface the renderer sees. Every call goes through here.
 * Renderer never imports node, never sees ipcRenderer, never touches the FS directly.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { channels } from '../shared/ipc-contracts';
import type { LocalAiStatus, LocalAiProgress, MemoryStatus, MemoryProgress } from '../shared/ipc-contracts';

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
    deleteReminder: (id: string, rid: string) => ipcRenderer.invoke(channels.cases.deleteReminder, id, rid),
    exportBundle: (id: string) => ipcRenderer.invoke(channels.cases.exportBundle, id),
    importBundle: () => ipcRenderer.invoke(channels.cases.importBundle),
    stageEvidence: (id: string) => ipcRenderer.invoke(channels.cases.stageEvidence, id),
    exportToDesktop: (id: string) => ipcRenderer.invoke(channels.cases.exportToDesktop, id)
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
    mediaUrl: (id: string, name: string) => ipcRenderer.invoke(channels.files.mediaUrl, id, name),
    extractAttachmentMeta: (id: string, name: string) => ipcRenderer.invoke(channels.files.extractAttachmentMeta, id, name),
    exif: (id: string, name: string) => ipcRenderer.invoke(channels.files.exif, id, name),
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
    update: (patch: unknown) => ipcRenderer.invoke(channels.settings.update, patch),
    pickWallpaper: () => ipcRenderer.invoke(channels.settings.pickWallpaper)
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
    quit: () => ipcRenderer.invoke(channels.system.quit),
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
  chat: {
    status: () => ipcRenderer.invoke(channels.chat.status),
    enable: () => ipcRenderer.invoke(channels.chat.enable),
    disable: () => ipcRenderer.invoke(channels.chat.disable),
    createInvite: () => ipcRenderer.invoke(channels.chat.createInvite),
    acceptInvite: (link: string) => ipcRenderer.invoke(channels.chat.acceptInvite, link),
    listContacts: () => ipcRenderer.invoke(channels.chat.listContacts),
    setVerified: (contactId: string, verified: boolean) => ipcRenderer.invoke(channels.chat.setVerified, contactId, verified),
    send: (contactId: string, text: string) => ipcRenderer.invoke(channels.chat.send, contactId, text),
    sendFile: (contactId: string) => ipcRenderer.invoke(channels.chat.sendFile, contactId),
    shareAttachment: (contactId: string, caseId: string, fileName: string) => ipcRenderer.invoke(channels.chat.shareAttachment, contactId, caseId, fileName),
    saveFile: (contactId: string, transferId: string) => ipcRenderer.invoke(channels.chat.saveFile, contactId, transferId),
    history: (contactId: string) => ipcRenderer.invoke(channels.chat.history, contactId),
    createGroup: (name: string, memberIds: string[]) => ipcRenderer.invoke(channels.chat.createGroup, name, memberIds),
    listGroups: () => ipcRenderer.invoke(channels.chat.listGroups),
    groupHistory: (groupId: string) => ipcRenderer.invoke(channels.chat.groupHistory, groupId),
    sendGroup: (groupId: string, text: string) => ipcRenderer.invoke(channels.chat.sendGroup, groupId, text),
    onMessage: (cb: (p: { contactId: string; message: unknown }) => void) => {
      const l = (_e: unknown, p: { contactId: string; message: unknown }) => cb(p);
      ipcRenderer.on(channels.chat.onMessage, l);
      return () => ipcRenderer.removeListener(channels.chat.onMessage, l);
    },
    onContactStatus: (cb: (p: { contactId: string; status: string }) => void) => {
      const l = (_e: unknown, p: { contactId: string; status: string }) => cb(p);
      ipcRenderer.on(channels.chat.onContactStatus, l);
      return () => ipcRenderer.removeListener(channels.chat.onContactStatus, l);
    },
    onDelivery: (cb: (p: { contactId: string; messageId: string; state: string }) => void) => {
      const l = (_e: unknown, p: { contactId: string; messageId: string; state: string }) => cb(p);
      ipcRenderer.on(channels.chat.onDelivery, l);
      return () => ipcRenderer.removeListener(channels.chat.onDelivery, l);
    },
    onFileStatus: (cb: (p: { contactId: string; transferId: string; status: string; progress?: { received: number; total: number } }) => void) => {
      const l = (_e: unknown, p: { contactId: string; transferId: string; status: string; progress?: { received: number; total: number } }) => cb(p);
      ipcRenderer.on(channels.chat.onFileStatus, l);
      return () => ipcRenderer.removeListener(channels.chat.onFileStatus, l);
    },
    onGroupMessage: (cb: (p: { groupId: string; message: unknown }) => void) => {
      const l = (_e: unknown, p: { groupId: string; message: unknown }) => cb(p);
      ipcRenderer.on(channels.chat.onGroupMessage, l);
      return () => ipcRenderer.removeListener(channels.chat.onGroupMessage, l);
    },
    onGroupInvite: (cb: (p: { groupId: string }) => void) => {
      const l = (_e: unknown, p: { groupId: string }) => cb(p);
      ipcRenderer.on(channels.chat.onGroupInvite, l);
      return () => ipcRenderer.removeListener(channels.chat.onGroupInvite, l);
    },
    onTorStatus: (cb: (p: { status: string; onion: string | null }) => void) => {
      const l = (_e: unknown, p: { status: string; onion: string | null }) => cb(p);
      ipcRenderer.on(channels.chat.onTorStatus, l);
      return () => ipcRenderer.removeListener(channels.chat.onTorStatus, l);
    }
  },
  tts: {
    piperStatus: () => ipcRenderer.invoke(channels.tts.piperStatus),
    synthesize: (text: string, rate?: number) => ipcRenderer.invoke(channels.tts.synthesize, text, rate),
    cancel: () => ipcRenderer.invoke(channels.tts.cancel)
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
    saveAttachment: (input: { filename: string; contentBase64: string }) => ipcRenderer.invoke(channels.mail.saveAttachment, input),
    deleteMessage: (id: string, uid: number) => ipcRenderer.invoke(channels.mail.deleteMessage, id, uid),
    setFlag: (id: string, uid: number, flag: string, value: boolean) => ipcRenderer.invoke(channels.mail.setFlag, id, uid, flag, value),
    printMessage: (id: string, uid: number) => ipcRenderer.invoke(channels.mail.printMessage, id, uid),
    onNewMail: (cb: (payload: { accountId: string; unseenCount: number }) => void) => {
      const l = (_e: unknown, p: { accountId: string; unseenCount: number }) => cb(p);
      ipcRenderer.on(channels.mail.onNewMail, l);
      return () => ipcRenderer.removeListener(channels.mail.onNewMail, l);
    }
  },
  browser: {
    listBookmarks: () => ipcRenderer.invoke(channels.browser.listBookmarks),
    addBookmark: (title: string, url: string) => ipcRenderer.invoke(channels.browser.addBookmark, title, url),
    deleteBookmark: (id: string) => ipcRenderer.invoke(channels.browser.deleteBookmark, id),
    listHistory: (limit?: number) => ipcRenderer.invoke(channels.browser.listHistory, limit),
    addHistory: (url: string, title: string) => ipcRenderer.invoke(channels.browser.addHistory, url, title),
    clearHistory: () => ipcRenderer.invoke(channels.browser.clearHistory),
    firefoxStatus: () => ipcRenderer.invoke(channels.browser.firefoxStatus),
    launchFirefox: (url: string, title?: string) => ipcRenderer.invoke(channels.browser.launchFirefox, url, title),
    revealFirefoxDir: () => ipcRenderer.invoke(channels.browser.revealFirefoxDir)
  },
  voice: {
    modelStatus: () => ipcRenderer.invoke(channels.voice.modelStatus)
  },
  bookmarks: {
    get: () => ipcRenderer.invoke(channels.bookmarks.get),
    save: (board: unknown) => ipcRenderer.invoke(channels.bookmarks.save, board),
    exportBoard: () => ipcRenderer.invoke(channels.bookmarks.exportBoard),
    importBoard: () => ipcRenderer.invoke(channels.bookmarks.importBoard),
    fetchFavicon: (url: string) => ipcRenderer.invoke(channels.bookmarks.fetchFavicon, url)
  },
  stickyNotes: {
    get: () => ipcRenderer.invoke(channels.stickyNotes.get),
    save: (state: unknown) => ipcRenderer.invoke(channels.stickyNotes.save, state)
  },
  aiConvos: {
    list: () => ipcRenderer.invoke(channels.aiConvos.list),
    get: (id: string) => ipcRenderer.invoke(channels.aiConvos.get, id),
    save: (convo: unknown) => ipcRenderer.invoke(channels.aiConvos.save, convo),
    delete: (id: string) => ipcRenderer.invoke(channels.aiConvos.delete, id)
  },
  briefcase: {
    list: () => ipcRenderer.invoke(channels.briefcase.list),
    read: (id: string) => ipcRenderer.invoke(channels.briefcase.read, id),
    save: (note: unknown) => ipcRenderer.invoke(channels.briefcase.save, note),
    delete: (id: string) => ipcRenderer.invoke(channels.briefcase.delete, id)
  },
  journal: {
    list: () => ipcRenderer.invoke(channels.journal.list),
    read: (id: string) => ipcRenderer.invoke(channels.journal.read, id),
    save: (entry: unknown) => ipcRenderer.invoke(channels.journal.save, entry),
    delete: (id: string) => ipcRenderer.invoke(channels.journal.delete, id),
    hasPin: () => ipcRenderer.invoke(channels.journal.hasPin),
    setPin: (pin: string) => ipcRenderer.invoke(channels.journal.setPin, pin),
    verifyPin: (pin: string) => ipcRenderer.invoke(channels.journal.verifyPin, pin),
    changePin: (oldPin: string, newPin: string) => ipcRenderer.invoke(channels.journal.changePin, oldPin, newPin)
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
  shell: {
    connect: (program?: 'cmd' | 'powershell') => ipcRenderer.invoke(channels.shell.connect, program),
    write: (sessionId: string, data: string) => ipcRenderer.invoke(channels.shell.write, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke(channels.shell.resize, sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.invoke(channels.shell.disconnect, sessionId),
    onData: (cb: (payload: { sessionId: string; data: string }) => void) => {
      const l = (_e: unknown, p: { sessionId: string; data: string }) => cb(p);
      ipcRenderer.on(channels.shell.onData, l);
      return () => ipcRenderer.removeListener(channels.shell.onData, l);
    },
    onClose: (cb: (payload: { sessionId: string; reason: string }) => void) => {
      const l = (_e: unknown, p: { sessionId: string; reason: string }) => cb(p);
      ipcRenderer.on(channels.shell.onClose, l);
      return () => ipcRenderer.removeListener(channels.shell.onClose, l);
    }
  },
  streams: {
    list: () => ipcRenderer.invoke(channels.streams.list),
    upsert: (input: unknown) => ipcRenderer.invoke(channels.streams.upsert, input),
    delete: (id: string) => ipcRenderer.invoke(channels.streams.delete, id),
    clear: () => ipcRenderer.invoke(channels.streams.clear),
    import: (stamp?: { country?: string; region?: string; city?: string }) => ipcRenderer.invoke(channels.streams.import, stamp),
    detect: (url: string) => ipcRenderer.invoke(channels.streams.detect, url)
  },
  walls: {
    list: () => ipcRenderer.invoke(channels.walls.list),
    get: (id: string) => ipcRenderer.invoke(channels.walls.get, id),
    save: (wall: unknown) => ipcRenderer.invoke(channels.walls.save, wall),
    delete: (id: string) => ipcRenderer.invoke(channels.walls.delete, id)
  },
  media: {
    getSnapshot: () => ipcRenderer.invoke(channels.media.getSnapshot),
    addRoot: () => ipcRenderer.invoke(channels.media.addRoot),
    removeRoot: (root: string) => ipcRenderer.invoke(channels.media.removeRoot, root),
    refresh: () => ipcRenderer.invoke(channels.media.refresh),
    openFiles: () => ipcRenderer.invoke(channels.media.openFiles),
    loadPlaylist: () => ipcRenderer.invoke(channels.media.loadPlaylist),
    savePlaylist: (queue: unknown) => ipcRenderer.invoke(channels.media.savePlaylist, queue),
    upsertStation: (input: unknown) => ipcRenderer.invoke(channels.media.upsertStation, input),
    deleteStation: (id: string) => ipcRenderer.invoke(channels.media.deleteStation, id)
  },
  geoint: {
    snapshot: () => ipcRenderer.invoke(channels.geoint.snapshot),
    addSource: (s: unknown) => ipcRenderer.invoke(channels.geoint.addSource, s),
    updateSource: (id: string, patch: unknown) => ipcRenderer.invoke(channels.geoint.updateSource, id, patch),
    removeSource: (id: string) => ipcRenderer.invoke(channels.geoint.removeSource, id),
    importOpml: () => ipcRenderer.invoke(channels.geoint.importOpml),
    refresh: (id?: string) => ipcRenderer.invoke(channels.geoint.refresh, id),
    geocode: (query: string) => ipcRenderer.invoke(channels.geoint.geocode, query),
    setItemLocation: (id: string, loc: unknown) => ipcRenderer.invoke(channels.geoint.setItemLocation, id, loc),
    saveToCase: (caseId: string, item: unknown, opts: unknown) => ipcRenderer.invoke(channels.geoint.saveToCase, caseId, item, opts),
    listCaseEvents: (caseId: string) => ipcRenderer.invoke(channels.geoint.listCaseEvents, caseId),
    removeCaseEvent: (caseId: string, eventId: string) => ipcRenderer.invoke(channels.geoint.removeCaseEvent, caseId, eventId),
    purgeCache: () => ipcRenderer.invoke(channels.geoint.purgeCache),
    fetchThreatLayer: (layerId: string, opts: { feed?: string; country?: string; query?: string }) => ipcRenderer.invoke(channels.geoint.fetchThreatLayer, layerId, opts),
    setLayerKey: (layerId: string, key: string) => ipcRenderer.invoke(channels.geoint.setLayerKey, layerId, key),
    hasLayerKey: (layerId: string) => ipcRenderer.invoke(channels.geoint.hasLayerKey, layerId),
    fetchKev: () => ipcRenderer.invoke(channels.geoint.fetchKev)
  },
  markets: {
    fetch: () => ipcRenderer.invoke(channels.markets.fetch)
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
  },
  ftp: {
    connect: (hostId: string) => ipcRenderer.invoke(channels.ftp.connect, hostId),
    list: (sessionId: string) => ipcRenderer.invoke(channels.ftp.list, sessionId),
    cd: (sessionId: string, path: string) => ipcRenderer.invoke(channels.ftp.cd, sessionId, path),
    download: (sessionId: string, name: string) => ipcRenderer.invoke(channels.ftp.download, sessionId, name),
    upload: (sessionId: string) => ipcRenderer.invoke(channels.ftp.upload, sessionId),
    disconnect: (sessionId: string) => ipcRenderer.invoke(channels.ftp.disconnect, sessionId)
  },
  backup: {
    create: () => ipcRenderer.invoke(channels.backup.create),
    restore: () => ipcRenderer.invoke(channels.backup.restore)
  },
  whiteboard: {
    read: (caseId: string) => ipcRenderer.invoke(channels.whiteboard.read, caseId),
    write: (caseId: string, board: unknown) => ipcRenderer.invoke(channels.whiteboard.write, caseId, board)
  },
  auth: {
    status: () => ipcRenderer.invoke(channels.auth.status),
    setup: (password: string) => ipcRenderer.invoke(channels.auth.setup, password),
    unlock: (password: string) => ipcRenderer.invoke(channels.auth.unlock, password),
    unlockRecovery: (recoveryKey: string) => ipcRenderer.invoke(channels.auth.unlockRecovery, recoveryKey),
    changePassword: (newPassword: string) => ipcRenderer.invoke(channels.auth.changePassword, newPassword),
    disable: (password: string) => ipcRenderer.invoke(channels.auth.disable, password),
    lock: () => ipcRenderer.invoke(channels.auth.lock)
  },
  localAi: {
    status: (): Promise<LocalAiStatus> => ipcRenderer.invoke(channels.localAi.status),
    setup: (opts: { mode: 'online' | 'bundled' }): Promise<LocalAiStatus> => ipcRenderer.invoke(channels.localAi.setup, opts),
    start: (): Promise<void> => ipcRenderer.invoke(channels.localAi.start),
    stop: (): Promise<void> => ipcRenderer.invoke(channels.localAi.stop),
    onProgress: (cb: (p: LocalAiProgress) => void): (() => void) => {
      const listener = (_e: unknown, payload: LocalAiProgress): void => cb(payload);
      ipcRenderer.on(channels.localAi.onProgress, listener);
      return () => ipcRenderer.removeListener(channels.localAi.onProgress, listener);
    }
  },
  memory: {
    status: (): Promise<MemoryStatus> => ipcRenderer.invoke(channels.memory.status),
    reindexAll: (): Promise<{ cases: number; chunks: number }> => ipcRenderer.invoke(channels.memory.reindexAll),
    onProgress: (cb: (p: MemoryProgress) => void): (() => void) => {
      const listener = (_e: unknown, payload: MemoryProgress): void => cb(payload);
      ipcRenderer.on(channels.memory.onProgress, listener);
      return () => ipcRenderer.removeListener(channels.memory.onProgress, listener);
    }
  },
  plugins: {
    listVerified: () => ipcRenderer.invoke(channels.plugins.listVerified),
    invoke: (id: string, name: string, args: unknown[]) => ipcRenderer.invoke(channels.plugins.invoke, id, name, args),
    status: () => ipcRenderer.invoke(channels.plugins.status)
  },
  offensive: {
    loadScope: (raw: unknown, token?: unknown) => ipcRenderer.invoke(channels.offensive.loadScope, raw, token),
    confirm: () => ipcRenderer.invoke(channels.offensive.confirm),
    startScan: () => ipcRenderer.invoke(channels.offensive.startScan),
    stopScan: () => ipcRenderer.invoke(channels.offensive.stopScan),
    status: () => ipcRenderer.invoke(channels.offensive.status)
  },
  bgconn: {
    list: () => ipcRenderer.invoke(channels.bgconn.list),
    status: () => ipcRenderer.invoke(channels.bgconn.status),
    start: (connId: string, params: { phone: string; routing: 'tor' | 'direct'; channelSetHash: string }, confirmed: boolean) =>
      ipcRenderer.invoke(channels.bgconn.start, connId, params, confirmed),
    stop: (connId: string) => ipcRenderer.invoke(channels.bgconn.stop, connId),
    configure: (cfg: { idleTeardownAfterMinutes: number | null; defaultRouting: 'tor' | 'direct'; maxReconnects: number; maxSessionAgeMinutes: number }) =>
      ipcRenderer.invoke(channels.bgconn.configure, cfg),
    clearCredentials: (pluginId: string, connId: string) => ipcRenderer.invoke(channels.bgconn.clearCredentials, pluginId, connId)
  }
} as const;

contextBridge.exposeInMainWorld('api', api);

contextBridge.exposeInMainWorld('apiPlugins', {
  listVerified: () => ipcRenderer.invoke(channels.plugins.listVerified),
  invoke: (id: string, name: string, args: unknown[]) => ipcRenderer.invoke(channels.plugins.invoke, id, name, args)
});

export type GhostApi = typeof api;
