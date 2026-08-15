/**
 * Preload — the *only* surface the renderer sees. Every call goes through here.
 * Renderer never imports node, never sees ipcRenderer, never touches the FS directly.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { channels } from '../shared/ipc-contracts';
import type { LocalAiStatus, LocalAiProgress, MemoryStatus, MemoryProgress, MemoryItem, RecallPreview, LibraryDoc, MemoryGraphShape, BondShape, ScrapingCaseStoreId, PdfSignPlacement } from '../shared/ipc-contracts';
import type { InvestigationScene, SceneDelta } from '../shared/investigation-graph';
import type { EntityType, AppSettings } from '../shared/types';
import type { RunEvent } from '../shared/investigation-agent';
import type { RunBudget } from '../shared/investigation-types';
import type { IntelReport } from '../shared/investigation-report';
import type { XCollectionSettings } from '../shared/x-listening-collection-settings';
import type { XImageMode } from '../shared/x-listening-image-policy';
import type { XScheduleStatus } from '../shared/x-listening-schedule';
import type { GeocodeMatch, SavedLocation, Units, WeatherEgressState } from '../shared/weather/types';

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
  documents: {
    list: (relDir: string) => ipcRenderer.invoke(channels.documents.list, relDir),
    mkdir: (relDir: string, name: string) => ipcRenderer.invoke(channels.documents.mkdir, relDir, name),
    rename: (relPath: string, newName: string) => ipcRenderer.invoke(channels.documents.rename, relPath, newName),
    remove: (relPath: string) => ipcRenderer.invoke(channels.documents.remove, relPath),
    copy: (srcRel: string, destDir: string) => ipcRenderer.invoke(channels.documents.copy, srcRel, destDir),
    move: (srcRel: string, destDir: string) => ipcRenderer.invoke(channels.documents.move, srcRel, destDir),
    importDropped: (destDir: string, list: { sourcePath: string; originalName: string }[]) =>
      ipcRenderer.invoke(channels.documents.importDropped, destDir, list),
    reveal: (relPath: string) => ipcRenderer.invoke(channels.documents.reveal, relPath),
    export: (relPath: string) => ipcRenderer.invoke(channels.documents.export, relPath),
    writeText: (relDir: string, name: string, body: string, overwrite?: boolean) =>
      ipcRenderer.invoke(channels.documents.writeText, relDir, name, body, overwrite),
    readText: (relPath: string) => ipcRenderer.invoke(channels.documents.readText, relPath),
    readBytes: (relPath: string) => ipcRenderer.invoke(channels.documents.readBytes, relPath)
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
    pickWallpaper: () => ipcRenderer.invoke(channels.settings.pickWallpaper),
    pickBootSplash: () => ipcRenderer.invoke(channels.settings.pickBootSplash),
    onChanged: (cb: (s: AppSettings) => void) => {
      const listener = (_e: unknown, s: AppSettings) => cb(s);
      ipcRenderer.on(channels.settings.changed, listener);
      return () => ipcRenderer.removeListener(channels.settings.changed, listener);
    }
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
    onDiagnostic: (cb: (payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[]; scope?: string }) => void) => {
      const listener = (_e: unknown, payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[]; scope?: string }) => cb(payload);
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
    synthesize: (text: string, rate?: number, voiceId?: string) => ipcRenderer.invoke(channels.tts.synthesize, text, rate, voiceId),
    cancel: () => ipcRenderer.invoke(channels.tts.cancel),
    listVoices: () => ipcRenderer.invoke(channels.tts.listVoices),
    revealVoicesFolder: () => ipcRenderer.invoke(channels.tts.revealVoicesFolder)
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
    changePin: (oldPin: string, newPin: string) => ipcRenderer.invoke(channels.journal.changePin, oldPin, newPin),
    putAsset: (bytes: number[], mime: string) => ipcRenderer.invoke(channels.journal.putAsset, { bytes, mime }),
    getAsset: (ref: string) => ipcRenderer.invoke(channels.journal.getAsset, ref)
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
    requestEnable: (program?: 'cmd' | 'powershell') => ipcRenderer.invoke(channels.shell.requestEnable, program),
    disable: () => ipcRenderer.invoke(channels.shell.disable),
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
    detect: (url: string) => ipcRenderer.invoke(channels.streams.detect, url),
    exportCctv: () => ipcRenderer.invoke(channels.streams.exportCctv)
  },
  satellites: {
    list: () => ipcRenderer.invoke(channels.satellites.list),
    upsert: (input: unknown) => ipcRenderer.invoke(channels.satellites.upsert, input),
    remove: (id: string) => ipcRenderer.invoke(channels.satellites.remove, id),
    fetchGroup: (group: string) => ipcRenderer.invoke(channels.satellites.fetchGroup, group),
    snapshot: () => ipcRenderer.invoke(channels.satellites.snapshot)
  },
  walls: {
    list: () => ipcRenderer.invoke(channels.walls.list),
    get: (id: string) => ipcRenderer.invoke(channels.walls.get, id),
    save: (wall: unknown) => ipcRenderer.invoke(channels.walls.save, wall),
    delete: (id: string) => ipcRenderer.invoke(channels.walls.delete, id)
  },
  sounds: {
    mailChime: () => ipcRenderer.invoke(channels.sounds.mailChime),
    openFolder: () => ipcRenderer.invoke(channels.sounds.openFolder)
  },
  media: {
    getSnapshot: () => ipcRenderer.invoke(channels.media.getSnapshot),
    addRoot: () => ipcRenderer.invoke(channels.media.addRoot),
    removeRoot: (root: string) => ipcRenderer.invoke(channels.media.removeRoot, root),
    refresh: () => ipcRenderer.invoke(channels.media.refresh),
    clearLibrary: () => ipcRenderer.invoke(channels.media.clearLibrary),
    openFiles: () => ipcRenderer.invoke(channels.media.openFiles),
    loadPlaylist: () => ipcRenderer.invoke(channels.media.loadPlaylist),
    savePlaylist: (queue: unknown) => ipcRenderer.invoke(channels.media.savePlaylist, queue),
    upsertStation: (input: unknown) => ipcRenderer.invoke(channels.media.upsertStation, input),
    deleteStation: (id: string) => ipcRenderer.invoke(channels.media.deleteStation, id),
    reorderStations: (ids: string[]) => ipcRenderer.invoke(channels.media.reorderStations, ids),
    exportStations: () => ipcRenderer.invoke(channels.media.exportStations)
  },
  invoices: {
    list: () => ipcRenderer.invoke(channels.invoices.list),
    save: (invoice: unknown) => ipcRenderer.invoke(channels.invoices.save, invoice),
    remove: (id: string) => ipcRenderer.invoke(channels.invoices.remove, id),
    duplicate: (id: string) => ipcRenderer.invoke(channels.invoices.duplicate, id),
    nextNumber: () => ipcRenderer.invoke(channels.invoices.nextNumber),
    listProfiles: () => ipcRenderer.invoke(channels.invoices.listProfiles),
    saveProfile: (profile: unknown) => ipcRenderer.invoke(channels.invoices.saveProfile, profile),
    removeProfile: (id: string) => ipcRenderer.invoke(channels.invoices.removeProfile, id),
    putAsset: (bytes: number[], mime: string) => ipcRenderer.invoke(channels.invoices.putAsset, { bytes, mime }),
    getAsset: (ref: string) => ipcRenderer.invoke(channels.invoices.getAsset, ref),
    exportPdf: (html: string) => ipcRenderer.invoke(channels.invoices.exportPdf, { html }),
    exportDocx: (args: { invoice: unknown; assets: Record<string, string> }) => ipcRenderer.invoke(channels.invoices.exportDocx, args)
  },
  reports: {
    list: () => ipcRenderer.invoke(channels.reports.list),
    save: (report: unknown) => ipcRenderer.invoke(channels.reports.save, report),
    remove: (id: string) => ipcRenderer.invoke(channels.reports.remove, id),
    putAsset: (bytes: number[], mime: string) => ipcRenderer.invoke(channels.reports.putAsset, { bytes, mime }),
    getAsset: (ref: string) => ipcRenderer.invoke(channels.reports.getAsset, ref),
    copyAsset: (ref: string) => ipcRenderer.invoke(channels.reports.copyAsset, ref),
    contacts: {
      list: () => ipcRenderer.invoke(channels.reports.contactsList),
      save: (contact: unknown) => ipcRenderer.invoke(channels.reports.contactsSave, contact),
      remove: (id: string) => ipcRenderer.invoke(channels.reports.contactsRemove, id)
    },
    descriptors: {
      list: () => ipcRenderer.invoke(channels.reports.descriptorsList),
      save: (descriptor: unknown) => ipcRenderer.invoke(channels.reports.descriptorsSave, descriptor),
      remove: (id: string) => ipcRenderer.invoke(channels.reports.descriptorsRemove, id)
    },
    introductions: {
      list: () => ipcRenderer.invoke(channels.reports.introductionsList),
      save: (introduction: unknown) => ipcRenderer.invoke(channels.reports.introductionsSave, introduction),
      remove: (id: string) => ipcRenderer.invoke(channels.reports.introductionsRemove, id)
    },
    templates: {
      list: () => ipcRenderer.invoke(channels.reports.templatesList),
      save: (template: unknown) => ipcRenderer.invoke(channels.reports.templatesSave, template),
      remove: (id: string) => ipcRenderer.invoke(channels.reports.templatesRemove, id)
    },
    // Main builds the template's buildReportHtml (assets resolved main-side) for the sandboxed preview.
    previewTemplate: (id: string) => ipcRenderer.invoke(channels.reports.previewTemplate, id),
    // Main resolves the report/contact/assets itself from the id for both exporters.
    exportPdf: (id: string) => ipcRenderer.invoke(channels.reports.exportPdf, id),
    exportDocx: (id: string) => ipcRenderer.invoke(channels.reports.exportDocx, id)
  },
  pdfsign: {
    // Capped transient read of a host path (picked via files.pickOpen) — never written to the vault.
    read: (path: string) => ipcRenderer.invoke(channels.pdfsign.read, path),
    // Main validates the placement/signature, overlays it (pdf-lib signPdf) and saves via the OS dialog.
    sign: (args: { pdfBytes: Uint8Array; signatureDataUrl: string; placement: PdfSignPlacement; sourceName?: string }) =>
      ipcRenderer.invoke(channels.pdfsign.sign, args)
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
    fetchKev: () => ipcRenderer.invoke(channels.geoint.fetchKev),
    getMonitors: () => ipcRenderer.invoke(channels.geoint.getMonitors),
    setMonitors: (ids: string[]) => ipcRenderer.invoke(channels.geoint.setMonitors, ids),
    addMonitor: (id: string) => ipcRenderer.invoke(channels.geoint.addMonitor, id),
    removeMonitor: (id: string) => ipcRenderer.invoke(channels.geoint.removeMonitor, id),
    cctvTorReady: () => ipcRenderer.invoke(channels.geoint.cctvTorReady),
    summarizeEvent: (description: string) => ipcRenderer.invoke(channels.geoint.summarizeEvent, description)
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
    write: (caseId: string, board: unknown) => ipcRenderer.invoke(channels.whiteboard.write, caseId, board),
    exportPdf: (caseId: string, payload: { png: string; nodes: unknown[]; edges: unknown[] }) =>
      ipcRenderer.invoke(channels.whiteboard.exportPdf, caseId, payload),
    exportDocx: (caseId: string, payload: { png: string; nodes: unknown[]; edges: unknown[] }) =>
      ipcRenderer.invoke(channels.whiteboard.exportDocx, caseId, payload),
    exportFile: (caseId: string) => ipcRenderer.invoke(channels.whiteboard.exportFile, caseId),
    importFile: (caseId: string) => ipcRenderer.invoke(channels.whiteboard.importFile, caseId)
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
    reindexAll: (): Promise<{ cases: number; chunks: number; failures: { label: string; error: string }[] }> =>
      ipcRenderer.invoke(channels.memory.reindexAll),
    onProgress: (cb: (p: MemoryProgress) => void): (() => void) => {
      const listener = (_e: unknown, payload: MemoryProgress): void => cb(payload);
      ipcRenderer.on(channels.memory.onProgress, listener);
      return () => ipcRenderer.removeListener(channels.memory.onProgress, listener);
    },
    embedHealth: (): Promise<'ready' | 'starting' | 'unavailable' | 'model-missing'> => ipcRenderer.invoke(channels.memory.embedHealth),
    profileList: (scope?: string): Promise<MemoryItem[]> => ipcRenderer.invoke(channels.memory.profileList, scope),
    profileSummaries: (): Promise<Record<string, string>> => ipcRenderer.invoke(channels.memory.profileSummaries),
    profileUpsert: (item: Pick<MemoryItem, 'id' | 'scope' | 'text' | 'pinned'>): Promise<MemoryItem[]> =>
      ipcRenderer.invoke(channels.memory.profileUpsert, item),
    profileDelete: (ids: string[]): Promise<void> => ipcRenderer.invoke(channels.memory.profileDelete, ids),
    profileWipe: (scope?: string): Promise<void> => ipcRenderer.invoke(channels.memory.profileWipe, scope),
    // Recall-preview transparency (Task 8): NOT its own IPC channel — `ai.ts` already emits
    // `{rag, profile}` as a `recall` field on the final `ai:onChatChunk` event of every
    // generation (Task 7). This filters/republishes that same stream under `memory.onRecall` so
    // the Memory panel (Task 10) can subscribe without reaching into the chat-stream plumbing.
    onRecall: (cb: (r: RecallPreview) => void): (() => void) => {
      const listener = (_e: unknown, payload: { recall?: RecallPreview }): void => {
        if (payload.recall) cb(payload.recall);
      };
      ipcRenderer.on(channels.ai.onChatChunk, listener);
      return () => ipcRenderer.removeListener(channels.ai.onChatChunk, listener);
    },
    library: {
      list: (): Promise<LibraryDoc[]> => ipcRenderer.invoke(channels.memory.libraryList),
      add: (input: { title: string; mime: string; text: string }): Promise<LibraryDoc> =>
        ipcRenderer.invoke(channels.memory.libraryAdd, input),
      remove: (docId: string): Promise<void> => ipcRenderer.invoke(channels.memory.libraryRemove, docId)
    },
    /** Mind's Eye curation: forget a `doc`-kind node — removes it from the library AND reindexes
     *  synchronously so the node/evidence is gone from the graph and recall right away. */
    forgetDoc: (docId: string): Promise<void> => ipcRenderer.invoke(channels.memory.forgetDoc, docId),
    /** Mind's Eye curation: forget a conversation's memory — a reversible tombstone. The chat stays
     *  in the AI Assistant; it stops being indexed/recalled and its graph node disappears. */
    forgetConversation: (id: string): Promise<void> => ipcRenderer.invoke(channels.memory.forgetConversation, id),
    /** Undo forgetConversation — clears the tombstone and reindexes so the node/chunks return. */
    rememberConversation: (id: string): Promise<void> => ipcRenderer.invoke(channels.memory.rememberConversation, id),
    /** Merge a duplicate fact (`dropId`) into another (`keepId`) — unions provenance, keeps the
     *  higher confidence, drops the other. Returns the full post-merge item set. */
    mergeItems: (keepId: string, dropId: string): Promise<MemoryItem[]> =>
      ipcRenderer.invoke(channels.memory.mergeItems, { keepId, dropId }),
    /** The assembled Mind's Eye graph (nodes + auto-edges, deterministically laid out). */
    graph: (): Promise<MemoryGraphShape> => ipcRenderer.invoke(channels.memory.graph),
    /** Mind's Eye: user-drawn retrieval bonds — drag node-to-node to draw, click a bond edge to
     *  cut. Undirected; `add`/`remove` take the two node ids in either order. */
    bonds: {
      list: (): Promise<BondShape[]> => ipcRenderer.invoke(channels.memory.bondList),
      add: (a: string, b: string): Promise<void> => ipcRenderer.invoke(channels.memory.bondAdd, a, b),
      remove: (a: string, b: string): Promise<void> => ipcRenderer.invoke(channels.memory.bondRemove, a, b)
    }
  },
  /** SP-4 investigation graph: per-case scene fetch + live delta push as evidence is appended
   *  to the SP-2 provenance ledger, plus the manual add-node/draw-edge write path (Task 7) — both
   *  append a `manual` evidence record and stream through the same delta channel. */
  investigation: {
    graph: (caseId: string): Promise<InvestigationScene> => ipcRenderer.invoke(channels.investigation.graph, caseId),
    onGraphDelta: (caseId: string, cb: (delta: SceneDelta) => void): (() => void) => {
      const listener = (_e: unknown, payload: { caseId: string; delta: SceneDelta }): void => {
        if (payload.caseId === caseId) cb(payload.delta);
      };
      ipcRenderer.on(channels.investigation.onGraphDelta, listener);
      return () => ipcRenderer.removeListener(channels.investigation.onGraphDelta, listener);
    },
    addNode: (caseId: string, type: EntityType, value: string): Promise<void> =>
      ipcRenderer.invoke(channels.investigation.addNode, caseId, type, value),
    addEdge: (caseId: string, fromId: string, toId: string, relation: string): Promise<void> =>
      ipcRenderer.invoke(channels.investigation.addEdge, caseId, fromId, toId, relation),
    /** SP-6 free-form orchestrator: the run harness's start/control surface + its event stream.
     *  `onEvent` fans every live run's events through one channel — filter by `runId` if you only
     *  care about a single run (mirrors `onGraphDelta`'s per-caseId filtering above). */
    run: {
      /** Capability probe: `getBrain() != null` — true once the reasoning pack is installed. */
      available: (): Promise<boolean> => ipcRenderer.invoke(channels.investigation.run.available),
      start: (caseId: string, seedIds: string[], objective: string, budget: RunBudget): Promise<string> =>
        ipcRenderer.invoke(channels.investigation.run.start, caseId, seedIds, objective, budget),
      pause: (runId: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.pause, runId),
      resume: (runId: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.resume, runId),
      stop: (runId: string, reason: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.stop, runId, reason),
      addScope: (runId: string, target: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.addScope, runId, target),
      removeScope: (runId: string, target: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.removeScope, runId, target),
      focus: (runId: string, entityId: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.focus, runId, entityId),
      ignore: (runId: string, entityId: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.ignore, runId, entityId),
      answer: (runId: string, text: string): Promise<void> => ipcRenderer.invoke(channels.investigation.run.answer, runId, text),
      onEvent: (cb: (p: { runId: string; event: RunEvent }) => void): (() => void) => {
        const listener = (_e: unknown, payload: { runId: string; event: RunEvent }): void => cb(payload);
        ipcRenderer.on(channels.investigation.run.onEvent, listener);
        return () => ipcRenderer.removeListener(channels.investigation.run.onEvent, listener);
      }
    },
    /** SP-7 INTELREPORT: assemble the deterministic report model (key actors + findings +
     *  methodology + boxed narrative) for on-screen preview. Omit `runId` for the case aggregate;
     *  pass it to narrow to a single run. */
    report: {
      generate: (caseId: string, opts?: { runId?: string }): Promise<IntelReport> =>
        ipcRenderer.invoke(channels.investigation.report.generate, caseId, opts),
      /** Render the report as a PDF and save it via the OS dialog; resolves the saved path, or
       *  `null` if the user cancels. Same `runId` scoping as `generate`. */
      save: (caseId: string, opts?: { runId?: string }): Promise<string | null> =>
        ipcRenderer.invoke(channels.investigation.report.save, caseId, opts)
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
  },
  hostinfo: {
    resolve: (url: string, opts?: { force?: boolean }) => ipcRenderer.invoke(channels.hostinfo.resolve, url, opts)
  },
  livefeeds: {
    fetchAdsb: (bounds: unknown) => ipcRenderer.invoke(channels.livefeeds.fetchAdsb, bounds),
    aisStart: (bounds: unknown) => ipcRenderer.invoke(channels.livefeeds.aisStart, bounds),
    aisStop: () => ipcRenderer.invoke(channels.livefeeds.aisStop),
    aisSetBbox: (bounds: unknown) => ipcRenderer.invoke(channels.livefeeds.aisSetBbox, bounds),
    onAisPositions: (cb: (p: { positions: unknown[] }) => void) => {
      const l = (_e: unknown, p: { positions: unknown[] }) => cb(p);
      ipcRenderer.on(channels.livefeeds.onAisPositions, l);
      return () => ipcRenderer.removeListener(channels.livefeeds.onAisPositions, l);
    },
  },
  searchlight: {
    catalog: () => ipcRenderer.invoke(channels.searchlight.catalog),
    startSweep: (req: { username: string; siteIds: string[]; useTor: boolean }) => ipcRenderer.invoke(channels.searchlight.startSweep, req),
    cancelSweep: (jobId: string) => ipcRenderer.invoke(channels.searchlight.cancelSweep, jobId),
    importSites: (jsonText: string) => ipcRenderer.invoke(channels.searchlight.importSites, jsonText),
    listCases: () => ipcRenderer.invoke(channels.searchlight.listCases),
    saveCase: (c: unknown) => ipcRenderer.invoke(channels.searchlight.saveCase, c),
    loadCase: (id: string) => ipcRenderer.invoke(channels.searchlight.loadCase, id),
    deleteCase: (id: string) => ipcRenderer.invoke(channels.searchlight.deleteCase, id),
    exportCase: (id: string) => ipcRenderer.invoke(channels.searchlight.exportCase, id),
    importCase: (jsonText: string) => ipcRenderer.invoke(channels.searchlight.importCase, jsonText),
    onSweepResult: (cb: (r: unknown) => void) => {
      const l = (_e: unknown, r: unknown) => cb(r);
      ipcRenderer.on(channels.searchlight.onSweepResult, l);
      return () => ipcRenderer.removeListener(channels.searchlight.onSweepResult, l);
    },
    onSweepDone: (cb: (f: unknown) => void) => {
      const l = (_e: unknown, f: unknown) => cb(f);
      ipcRenderer.on(channels.searchlight.onSweepDone, l);
      return () => ipcRenderer.removeListener(channels.searchlight.onSweepDone, l);
    },
    favicon: (name: string) => ipcRenderer.invoke(channels.searchlight.favicon, name),
    addCustomSite: (i: { name: string; url: string; category?: string }) => ipcRenderer.invoke(channels.searchlight.addCustomSite, i),
    exportSites: () => ipcRenderer.invoke(channels.searchlight.exportSites),
    exportPdf: (args: { html: string; filename: string }) => ipcRenderer.invoke(channels.searchlight.exportPdf, args),
    saveReport: (args: { content: string; defaultName: string }) => ipcRenderer.invoke(channels.searchlight.saveReport, args),
    torStatus: () => ipcRenderer.invoke(channels.searchlight.torStatus),
    connectTor: () => ipcRenderer.invoke(channels.searchlight.connectTor),
    revealSiteDbDir: () => ipcRenderer.invoke(channels.searchlight.revealSiteDbDir),
    labelResult: (payload: { resultId: string; label: 0 | 1; siteName: string; caseId: string }) =>
      ipcRenderer.invoke(channels.searchlight.labelResult, payload),
    learningStatus: () => ipcRenderer.invoke(channels.searchlight.learningStatus),
    trainModel: () => ipcRenderer.invoke(channels.searchlight.trainModel),
    setMlEnabled: (enabled: boolean) => ipcRenderer.invoke(channels.searchlight.setMlEnabled, enabled)
  },
  socmint: {
    addChannel: (caseId: string, channel: unknown) => ipcRenderer.invoke(channels.socmint.addChannel, caseId, channel),
    removeChannel: (caseId: string, channelId: string) => ipcRenderer.invoke(channels.socmint.removeChannel, caseId, channelId),
    listChannels: (caseId: string) => ipcRenderer.invoke(channels.socmint.listChannels, caseId),
    listItems: (caseId: string) => ipcRenderer.invoke(channels.socmint.listItems, caseId),
    rankItems: (caseId: string, keyword: string) => ipcRenderer.invoke(channels.socmint.rankItems, caseId, keyword),
    recordLabel: (caseId: string, label: unknown) => ipcRenderer.invoke(channels.socmint.recordLabel, caseId, label),
    setBurner: (burnerId: string, credentials: unknown) => ipcRenderer.invoke(channels.socmint.setBurner, burnerId, credentials),
    hasBurner: (burnerId: string) => ipcRenderer.invoke(channels.socmint.hasBurner, burnerId),
    startMonitor: (req: unknown) => ipcRenderer.invoke(channels.socmint.startMonitor, req),
    stopMonitor: (jobId: string) => ipcRenderer.invoke(channels.socmint.stopMonitor, jobId),
    // WhatsApp linking ceremony (WA-T5 contracts; bodies implemented in WA-T6/T7; full
    // register.ts wiring in WA-T10 after operator smoke-test). Exposed here so the
    // renderer (WA-T8) can call them without type errors.
    setWhatsappBurnerPairingCode: (burnerId: string, phone: string) =>
      ipcRenderer.invoke(channels.socmint.setWhatsappBurnerPairingCode, burnerId, phone),
    hasWhatsappBurner: (burnerId: string) =>
      ipcRenderer.invoke(channels.socmint.hasWhatsappBurner, burnerId),
    unlinkWhatsappBurner: (burnerId: string) =>
      ipcRenderer.invoke(channels.socmint.unlinkWhatsappBurner, burnerId),
    // Telegram Hunter capture-window engine (TG5). The Telegram tab drives connect/capture/
    // members/export through these; no credential ever crosses this bridge.
    telegram: {
      connect: () => ipcRenderer.invoke(channels.socmint.telegram.connect),
      capture: (req: unknown) => ipcRenderer.invoke(channels.socmint.telegram.capture, req),
      captureMembers: (req: unknown) =>
        ipcRenderer.invoke(channels.socmint.telegram.captureMembers, req),
      captureProfile: (req: unknown) =>
        ipcRenderer.invoke(channels.socmint.telegram.captureProfile, req),
      exportItems: (req: unknown) => ipcRenderer.invoke(channels.socmint.telegram.exportItems, req),
      importExport: (req: unknown) => ipcRenderer.invoke(channels.socmint.telegram.importExport, req),
      keywordScan: (req: unknown) => ipcRenderer.invoke(channels.socmint.telegram.keywordScan, req)
    },
    /**
     * Subscribe to live harvested items streamed from an active monitor session.
     * Each call to the callback receives a single HarvestedItem pushed from main.
     * Returns an unsubscribe function (call to stop receiving updates).
     * Items arrive via textContent-safe fields only — renderer must not innerHTML them.
     */
    onMonitorItem: (cb: (item: unknown) => void) => {
      const l = (_e: unknown, item: unknown) => cb(item);
      ipcRenderer.on(channels.socmint.monitorItem, l);
      return () => ipcRenderer.removeListener(channels.socmint.monitorItem, l);
    }
  },
  // X Listening Station — Tor-default (by default), campaign-scoped visible-DOM capture (see
  // ipc-contracts.ts). The prior clearnet-only connect/capture/thread/followers/following/
  // archive-cycle surface was retired at Task 16 — every surviving capture method below is
  // Tor-safe. No credential value ever crosses this bridge.
  xListening: {
    saveNote: (req: { caseId: string; findingId: string; text: string }) =>
      ipcRenderer.invoke(channels.xListening.saveNote, req),
    readNotes: (caseId: string) =>
      ipcRenderer.invoke(channels.xListening.readNotes, caseId),
    removeNote: (req: { caseId: string; findingId: string }) =>
      ipcRenderer.invoke(channels.xListening.removeNote, req),

    // ---- Phase-1 Enterprise-port surface (plan Task 6) --------------------------------
    openSession: (caseId: string) => ipcRenderer.invoke(channels.xListening.openSession, caseId),
    sessionStatus: (caseId: string) =>
      ipcRenderer.invoke(channels.xListening.sessionStatus, caseId),
    closeSession: (caseId: string) =>
      ipcRenderer.invoke(channels.xListening.closeSession, caseId),
    captureTimeline: (req: {
      caseId: string;
      jobId?: string;
      channelId: string;
      channelLabel?: string;
      targetUsername: string;
    }) => ipcRenderer.invoke(channels.xListening.captureTimeline, req),
    postsList: (caseId: string) => ipcRenderer.invoke(channels.xListening.postsList, caseId),
    campaignsList: () => ipcRenderer.invoke(channels.xListening.campaignsList),
    campaignsCreate: (name: string) =>
      ipcRenderer.invoke(channels.xListening.campaignsCreate, name),
    campaignsSwitch: (id: string) => ipcRenderer.invoke(channels.xListening.campaignsSwitch, id),
    campaignsUpdate: (req: { id: string; name: string; purpose?: string; description?: string }) =>
      ipcRenderer.invoke(channels.xListening.campaignsUpdate, req),
    campaignsDelete: (id: string) => ipcRenderer.invoke(channels.xListening.campaignsDelete, id),
    campaignsDuplicate: (id: string) =>
      ipcRenderer.invoke(channels.xListening.campaignsDuplicate, id),
    campaignsMeta: () => ipcRenderer.invoke(channels.xListening.campaignsMeta),
    analysis: (caseId: string) => ipcRenderer.invoke(channels.xListening.analysis, caseId),
    health: (caseId: string) => ipcRenderer.invoke(channels.xListening.health, caseId),
    entities: (caseId: string) => ipcRenderer.invoke(channels.xListening.entities, caseId),
    presetsRead: (caseId: string) => ipcRenderer.invoke(channels.xListening.presetsRead, caseId),
    presetsSave: (req: {
      caseId: string;
      id: string;
      name: string;
      keywords: string[];
      mode?: 'any' | 'all';
      caseSensitive?: boolean;
      profileIds?: string[];
      enabled?: boolean;
    }) => ipcRenderer.invoke(channels.xListening.presetsSave, req),
    presetsRemove: (req: { caseId: string; id: string }) =>
      ipcRenderer.invoke(channels.xListening.presetsRemove, req),
    presetsRun: (req: { caseId: string; id: string }) =>
      ipcRenderer.invoke(channels.xListening.presetsRun, req),

    // ---- Task 15: remaining tab wiring + Phase-2 gap closure -----------------------
    networksList: (caseId: string) => ipcRenderer.invoke(channels.xListening.networksList, caseId),
    archiveStatus: (caseId: string) => ipcRenderer.invoke(channels.xListening.archiveStatus, caseId),
    archiveRun: (req: {
      caseId: string;
      channelId: string;
      channelLabel?: string;
      targetUsername: string;
      maxCycles?: number;
    }) => ipcRenderer.invoke(channels.xListening.archiveRun, req),
    loadDemoData: (caseId: string) => ipcRenderer.invoke(channels.xListening.loadDemoData, caseId),
    exportPostsToFile: (req: { caseId: string; format: 'json' | 'csv' | 'pdf' }) =>
      ipcRenderer.invoke(channels.xListening.exportPostsToFile, req),
    exportNetworkToFile: (caseId: string) =>
      ipcRenderer.invoke(channels.xListening.exportNetworkToFile, caseId),
    mediaRead: (req: { caseId: string; ref: string }) =>
      ipcRenderer.invoke(channels.xListening.mediaRead, req),
    changeEvents: (caseId: string) => ipcRenderer.invoke(channels.xListening.changeEvents, caseId),
    verifyPost: (req: { caseId: string; postId: string }) =>
      ipcRenderer.invoke(channels.xListening.verifyPost, req),
    runLog: (caseId: string) => ipcRenderer.invoke(channels.xListening.runLog, caseId),
    openInX: (req: { kind: 'thread' | 'profile' | 'identity'; ref: string }) =>
      ipcRenderer.invoke(channels.xListening.openInX, req),
    captureNetwork: (req: {
      caseId: string;
      channelId: string;
      targetUsername: string;
      kind: 'followers' | 'following';
    }) => ipcRenderer.invoke(channels.xListening.captureNetwork, req),
    removeSource: (req: { caseId: string; sourceKey: string }) =>
      ipcRenderer.invoke(channels.xListening.removeSource, req),
    getCollectionSettings: (caseId: string): Promise<XCollectionSettings> =>
      ipcRenderer.invoke(channels.xListening.getCollectionSettings, caseId),
    saveCollectionSettings: (req: { caseId: string; settings: Partial<XCollectionSettings> }): Promise<XCollectionSettings> =>
      ipcRenderer.invoke(channels.xListening.saveCollectionSettings, req),
    getImagePolicy: (caseId: string): Promise<{ modes: Record<string, XImageMode>; retrieveImages: boolean }> =>
      ipcRenderer.invoke(channels.xListening.getImagePolicy, caseId),
    setProfileImageMode: (
      req: { caseId: string; sourceKey: string; mode: XImageMode },
    ): Promise<{ sourceKey: string; imageMode: XImageMode; effective: boolean }> =>
      ipcRenderer.invoke(channels.xListening.setProfileImageMode, req),
    scheduleStatus: (caseId: string): Promise<XScheduleStatus> =>
      ipcRenderer.invoke(channels.xListening.scheduleStatus, caseId)
  },
  // Weather tool (OURS, 2026-08-15) — Tor-default Open-Meteo client + encrypted saved-locations store.
  weather: {
    geocode: (query: string): Promise<GeocodeMatch[]> =>
      ipcRenderer.invoke(channels.weather.geocode, query),
    locationsList: (): Promise<SavedLocation[]> =>
      ipcRenderer.invoke(channels.weather.locationsList),
    locationsAdd: (input: {
      name: string;
      country: string;
      admin1?: string;
      latitude: number;
      longitude: number;
    }): Promise<SavedLocation[]> => ipcRenderer.invoke(channels.weather.locationsAdd, input),
    locationsRemove: (id: string): Promise<SavedLocation[]> =>
      ipcRenderer.invoke(channels.weather.locationsRemove, id),
    locationsReorder: (ids: string[]): Promise<SavedLocation[]> =>
      ipcRenderer.invoke(channels.weather.locationsReorder, ids),
    forecast: (id: string): Promise<import('../shared/weather/types').WeatherForecastResult> =>
      ipcRenderer.invoke(channels.weather.forecast, { id }),
    unitsGet: (): Promise<Units> => ipcRenderer.invoke(channels.weather.unitsGet),
    unitsSet: (units: Units): Promise<Units> => ipcRenderer.invoke(channels.weather.unitsSet, units),
    egressState: (): Promise<WeatherEgressState> =>
      ipcRenderer.invoke(channels.weather.egressState)
  },
  // Scraping cases (W4) — the isolated SOCMINT/X collection-run stores. Every call passes a
  // `store: 'socmint' | 'x'` discriminator that main validates against an allowlist and routes
  // to the matching namespace store. Distinct from window.api.cases (investigation cases).
  scrapingCases: {
    list: (store: ScrapingCaseStoreId) => ipcRenderer.invoke(channels.scrapingCases.list, store),
    create: (store: ScrapingCaseStoreId, name: string) => ipcRenderer.invoke(channels.scrapingCases.create, store, name),
    rename: (store: ScrapingCaseStoreId, id: string, name: string) => ipcRenderer.invoke(channels.scrapingCases.rename, store, id, name),
    remove: (store: ScrapingCaseStoreId, id: string) => ipcRenderer.invoke(channels.scrapingCases.remove, store, id),
    importToCase: (store: ScrapingCaseStoreId, scrapingCaseId: string, mainCaseId: string) =>
      ipcRenderer.invoke(channels.scrapingCases.importToCase, store, scrapingCaseId, mainCaseId),
    saveArtifact: (store: ScrapingCaseStoreId, scrapingCaseId: string, name: string, content: string) =>
      ipcRenderer.invoke(channels.scrapingCases.saveArtifact, store, scrapingCaseId, name, content)
  }
} as const;

contextBridge.exposeInMainWorld('api', api);

contextBridge.exposeInMainWorld('apiPlugins', {
  listVerified: () => ipcRenderer.invoke(channels.plugins.listVerified),
  invoke: (id: string, name: string, args: unknown[]) => ipcRenderer.invoke(channels.plugins.invoke, id, name, args)
});

export type GhostApi = typeof api;
