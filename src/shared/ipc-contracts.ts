/**
 * Single source of truth for IPC channel names + payload contracts.
 * Both preload and main process import from this file — typos become compile errors.
 */

import type {
  AppSettings,
  AttachmentBytesResult,
  AttachmentMeta,
  AttachmentTextResult,
  CaseId,
  CaseRecord,
  CaseSummary,
  CreateCaseInput,
  EmlPreview,
  ExtractedAttachmentMeta,
  Reminder,
  TaskItem,
  TimelineEvent,
  WebLink
} from './types';

export const channels = {
  cases: {
    list: 'cases:list',
    create: 'cases:create',
    read: 'cases:read',
    rename: 'cases:rename',
    update: 'cases:update',
    archive: 'cases:archive',
    delete: 'cases:delete',
    addTimeline: 'cases:addTimeline',
    addTask: 'cases:addTask',
    toggleTask: 'cases:toggleTask',
    deleteTask: 'cases:deleteTask',
    addLink: 'cases:addLink',
    deleteLink: 'cases:deleteLink',
    addReminder: 'cases:addReminder',
    deleteReminder: 'cases:deleteReminder'
  },
  notes: {
    list: 'notes:list',
    read: 'notes:read',
    write: 'notes:write',
    delete: 'notes:delete'
  },
  settings: {
    read: 'settings:read',
    update: 'settings:update'
  },
  reminders: {
    listGlobal: 'reminders:listGlobal',
    upsertGlobal: 'reminders:upsertGlobal',
    deleteGlobal: 'reminders:deleteGlobal'
  },
  shred: {
    list: 'shred:list',
    restore: 'shred:restore',
    purge: 'shred:purge',
    purgeAll: 'shred:purgeAll'
  },
  system: {
    appInfo: 'system:appInfo',
    openExternal: 'system:openExternal',
    onReminderFired: 'system:onReminderFired',
    onDiagnostic: 'system:onDiagnostic'
  },
  mail: {
    listAccounts: 'mail:listAccounts',
    upsertAccount: 'mail:upsertAccount',
    deleteAccount: 'mail:deleteAccount',
    testAccount: 'mail:testAccount',
    fetchInbox: 'mail:fetchInbox',
    fetchMessage: 'mail:fetchMessage',
    send: 'mail:send',
    listDrafts: 'mail:listDrafts',
    upsertDraft: 'mail:upsertDraft',
    deleteDraft: 'mail:deleteDraft',
    saveAttachment: 'mail:saveAttachment'
  },
  browser: {
    listBookmarks: 'browser:listBookmarks',
    addBookmark: 'browser:addBookmark',
    deleteBookmark: 'browser:deleteBookmark',
    listHistory: 'browser:listHistory',
    addHistory: 'browser:addHistory',
    clearHistory: 'browser:clearHistory'
  },
  files: {
    importDropped: 'files:importDropped',
    listAttachments: 'files:listAttachments',
    revealAttachment: 'files:revealAttachment',
    deleteAttachment: 'files:deleteAttachment',
    readAttachmentText: 'files:readAttachmentText',
    readAttachmentBytes: 'files:readAttachmentBytes',
    readEml: 'files:readEml',
    extractAttachmentMeta: 'files:extractAttachmentMeta',
    renameAttachment: 'files:renameAttachment',
    pickOpen: 'files:pickOpen',
    pickSave: 'files:pickSave'
  },
  ssh: {
    listHosts: 'ssh:listHosts',
    upsertHost: 'ssh:upsertHost',
    deleteHost: 'ssh:deleteHost',
    connect: 'ssh:connect',
    write: 'ssh:write',
    resize: 'ssh:resize',
    disconnect: 'ssh:disconnect',
    onData: 'ssh:onData',
    onClose: 'ssh:onClose'
  },
  streams: {
    list: 'streams:list',
    upsert: 'streams:upsert',
    delete: 'streams:delete'
  },
  ai: {
    chat: 'ai:chat',
    chatStream: 'ai:chatStream',
    setApiKey: 'ai:setApiKey',
    onChatChunk: 'ai:onChatChunk'
  }
} as const;

export type Channels = typeof channels;

/** Payload + return signatures, keyed by channel string. */
export interface ApiContracts {
  [channels.cases.list]: { args: []; returns: CaseSummary[] };
  [channels.cases.create]: { args: [CreateCaseInput]; returns: CaseSummary };
  [channels.cases.read]: { args: [CaseId]; returns: CaseRecord };
  [channels.cases.rename]: { args: [CaseId, string]; returns: void };
  [channels.cases.update]: { args: [CaseId, Partial<CaseRecord>]; returns: CaseRecord };
  [channels.cases.archive]: { args: [CaseId, boolean]; returns: void };
  [channels.cases.delete]: { args: [CaseId]; returns: void };
  [channels.cases.addTimeline]: { args: [CaseId, Omit<TimelineEvent, 'id' | 'at'>]; returns: TimelineEvent };
  [channels.cases.addTask]: { args: [CaseId, string, string | undefined]; returns: TaskItem };
  [channels.cases.toggleTask]: { args: [CaseId, string]; returns: TaskItem };
  [channels.cases.deleteTask]: { args: [CaseId, string]; returns: void };
  [channels.cases.addLink]: { args: [CaseId, string, string]; returns: WebLink };
  [channels.cases.deleteLink]: { args: [CaseId, string]; returns: void };
  [channels.cases.addReminder]: { args: [CaseId, Omit<Reminder, 'id' | 'fired' | 'caseId'>]; returns: Reminder };
  [channels.cases.deleteReminder]: { args: [CaseId, string]; returns: void };

  [channels.files.importDropped]: { args: [CaseId, { sourcePath: string; originalName: string }[]]; returns: AttachmentMeta[] };
  [channels.files.listAttachments]: { args: [CaseId]; returns: AttachmentMeta[] };
  [channels.files.revealAttachment]: { args: [CaseId, string]; returns: void };
  [channels.files.deleteAttachment]: { args: [CaseId, string]; returns: void };
  [channels.files.readAttachmentText]: { args: [CaseId, string]; returns: AttachmentTextResult };
  [channels.files.readAttachmentBytes]: { args: [CaseId, string, number, number]; returns: AttachmentBytesResult };
  [channels.files.readEml]: { args: [CaseId, string]; returns: EmlPreview };
  [channels.files.extractAttachmentMeta]: { args: [CaseId, string]; returns: ExtractedAttachmentMeta };
  [channels.files.renameAttachment]: { args: [CaseId, string, string]; returns: string };

  [channels.notes.list]: { args: [CaseId]; returns: { name: string; updatedAt: string }[] };
  [channels.notes.read]: { args: [CaseId, string]; returns: string };
  [channels.notes.write]: { args: [CaseId, string, string]; returns: void };
  [channels.notes.delete]: { args: [CaseId, string]; returns: void };

  [channels.settings.read]: { args: []; returns: AppSettings };
  [channels.settings.update]: { args: [Partial<AppSettings>]; returns: AppSettings };

  [channels.reminders.listGlobal]: { args: []; returns: Reminder[] };
  [channels.reminders.upsertGlobal]: { args: [Reminder]; returns: Reminder };
  [channels.reminders.deleteGlobal]: { args: [string]; returns: void };

  [channels.shred.list]: { args: []; returns: { id: string; kind: 'case' | 'attachment'; label: string; deletedAt: string }[] };
  [channels.shred.restore]: { args: [string]; returns: void };
  [channels.shred.purge]: { args: [string]; returns: void };
  [channels.shred.purgeAll]: { args: []; returns: void };

  [channels.system.appInfo]: { args: []; returns: { version: string; userData: string; platform: NodeJS.Platform } };
  [channels.system.openExternal]: { args: [string]; returns: void };
  [channels.system.onReminderFired]: { args: [(payload: { reminder: Reminder }) => void]; returns: () => void };
}
