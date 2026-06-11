/**
 * Single source of truth for IPC channel names + payload contracts.
 * Both preload and main process import from this file — typos become compile errors.
 */

import type {
  AppSettings,
  AttachmentBytesResult,
  AttachmentMeta,
  AttachmentTextResult,
  BioImage,
  CaseId,
  CaseRecord,
  CaseSummary,
  CreateCaseInput,
  EmlPreview,
  EntityRecord,
  EntityRelationship,
  EntityType,
  ExtractedAttachmentMeta,
  ImageMime,
  MediaUrlResult,
  SearchResult,
  Reminder,
  TaskItem,
  TimelineEvent,
  WebLink
} from './types';
import type { MediaLibrarySnapshot, MediaStation, MediaTrack, GeoSnapshot, GeoSource, GeoItem, SavedGeoEvent, MarketSnapshot } from './post-mvp-types';

export interface EntityCreateInput { type: EntityType; value: string; notes?: string; aliases?: string[] }
export interface EntityLinkOpts { relationship?: EntityRelationship; linkIds?: string[]; attachmentFileNames?: string[] }
export interface BioAddInput { originalName: string; mime: ImageMime; width: number; height: number; originalBase64: string; thumbBase64: string }

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
    deleteReminder: 'cases:deleteReminder',
    exportBundle: 'cases:exportBundle',
    importBundle: 'cases:importBundle',
    stageEvidence: 'cases:stageEvidence',
    exportToDesktop: 'cases:exportToDesktop'
  },
  notes: {
    list: 'notes:list',
    read: 'notes:read',
    write: 'notes:write',
    delete: 'notes:delete'
  },
  settings: {
    read: 'settings:read',
    update: 'settings:update',
    pickWallpaper: 'settings:pickWallpaper'
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
    quit: 'system:quit',
    onReminderFired: 'system:onReminderFired',
    onDiagnostic: 'system:onDiagnostic'
  },
  chat: {
    status: 'chat:status',
    enable: 'chat:enable',
    disable: 'chat:disable',
    createInvite: 'chat:createInvite',
    acceptInvite: 'chat:acceptInvite',
    listContacts: 'chat:listContacts',
    setVerified: 'chat:setVerified',
    send: 'chat:send',
    sendFile: 'chat:sendFile',
    shareAttachment: 'chat:shareAttachment',
    saveFile: 'chat:saveFile',
    history: 'chat:history',
    createGroup: 'chat:createGroup',
    listGroups: 'chat:listGroups',
    groupHistory: 'chat:groupHistory',
    sendGroup: 'chat:sendGroup',
    onMessage: 'chat:onMessage',
    onContactStatus: 'chat:onContactStatus',
    onDelivery: 'chat:onDelivery',
    onFileStatus: 'chat:onFileStatus',
    onGroupMessage: 'chat:onGroupMessage',
    onGroupInvite: 'chat:onGroupInvite',
    onTorStatus: 'chat:onTorStatus'
  },
  tts: {
    piperStatus: 'tts:piperStatus',
    synthesize: 'tts:synthesize',
    cancel: 'tts:cancel'
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
    clearHistory: 'browser:clearHistory',
    firefoxStatus: 'browser:firefoxStatus',
    launchFirefox: 'browser:launchFirefox',
    revealFirefoxDir: 'browser:revealFirefoxDir'
  },
  voice: {
    modelStatus: 'voice:modelStatus'
  },
  bookmarks: {
    get: 'bookmarks:get',
    save: 'bookmarks:save',
    exportBoard: 'bookmarks:exportBoard',
    importBoard: 'bookmarks:importBoard',
    fetchFavicon: 'bookmarks:fetchFavicon'
  },
  stickyNotes: {
    get: 'stickyNotes:get',
    save: 'stickyNotes:save'
  },
  aiConvos: {
    list: 'aiConvos:list',
    get: 'aiConvos:get',
    save: 'aiConvos:save',
    delete: 'aiConvos:delete'
  },
  briefcase: {
    list: 'briefcase:list',
    read: 'briefcase:read',
    save: 'briefcase:save',
    delete: 'briefcase:delete'
  },
  files: {
    importDropped: 'files:importDropped',
    listAttachments: 'files:listAttachments',
    revealAttachment: 'files:revealAttachment',
    deleteAttachment: 'files:deleteAttachment',
    readAttachmentText: 'files:readAttachmentText',
    readAttachmentBytes: 'files:readAttachmentBytes',
    readEml: 'files:readEml',
    mediaUrl: 'files:mediaUrl',
    extractAttachmentMeta: 'files:extractAttachmentMeta',
    exif: 'files:exif',
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
    delete: 'streams:delete',
    clear: 'streams:clear',
    import: 'streams:import'
  },
  media: {
    getSnapshot: 'media:getSnapshot',
    addRoot: 'media:addRoot',
    removeRoot: 'media:removeRoot',
    refresh: 'media:refresh',
    openFiles: 'media:openFiles',
    loadPlaylist: 'media:loadPlaylist',
    savePlaylist: 'media:savePlaylist',
    upsertStation: 'media:upsertStation',
    deleteStation: 'media:deleteStation'
  },
  geoint: {
    snapshot: 'geoint:snapshot',
    addSource: 'geoint:addSource',
    updateSource: 'geoint:updateSource',
    removeSource: 'geoint:removeSource',
    importOpml: 'geoint:importOpml',
    refresh: 'geoint:refresh',
    geocode: 'geoint:geocode',
    setItemLocation: 'geoint:setItemLocation',
    saveToCase: 'geoint:saveToCase',
    listCaseEvents: 'geoint:listCaseEvents',
    removeCaseEvent: 'geoint:removeCaseEvent'
  },
  markets: {
    fetch: 'markets:fetch'
  },
  ai: {
    chat: 'ai:chat',
    chatStream: 'ai:chatStream',
    setApiKey: 'ai:setApiKey',
    onChatChunk: 'ai:onChatChunk'
  },
  entities: {
    listAll: 'entities:listAll',
    create: 'entities:create',
    update: 'entities:update',
    delete: 'entities:delete',
    merge: 'entities:merge',
    linkToCase: 'entities:linkToCase',
    unlinkFromCase: 'entities:unlinkFromCase',
    setRelationship: 'entities:setRelationship',
    casesForEntity: 'entities:casesForEntity'
  },
  bioImages: {
    add: 'bioImages:add',
    delete: 'bioImages:delete',
    setPrimary: 'bioImages:setPrimary',
    updateCaption: 'bioImages:updateCaption',
    readOriginal: 'bioImages:readOriginal',
    reveal: 'bioImages:reveal'
  },
  export: {
    summaryHtml: 'export:summaryHtml',
    summaryPdf: 'export:summaryPdf',
    timelineCsv: 'export:timelineCsv',
    linksCsv: 'export:linksCsv',
    entitiesCsv: 'export:entitiesCsv',
    attachmentsCsv: 'export:attachmentsCsv',
    text: 'export:text'
  },
  search: {
    query: 'search:query'
  },
  ftp: {
    connect: 'ftp:connect',
    list: 'ftp:list',
    cd: 'ftp:cd',
    download: 'ftp:download',
    upload: 'ftp:upload',
    disconnect: 'ftp:disconnect'
  },
  backup: {
    create: 'backup:create',
    restore: 'backup:restore'
  },
  whiteboard: {
    read: 'whiteboard:read',
    write: 'whiteboard:write'
  },
  auth: {
    status: 'auth:status',
    setup: 'auth:setup',
    unlock: 'auth:unlock',
    unlockRecovery: 'auth:unlockRecovery',
    changePassword: 'auth:changePassword',
    disable: 'auth:disable',
    lock: 'auth:lock'
  },
  localAi: {
    status: 'localAi:status',
    setup: 'localAi:setup',
    start: 'localAi:start',
    stop: 'localAi:stop',
    onProgress: 'localAi:onProgress'
  },
  memory: {
    reindexAll: 'memory:reindexAll',
    status: 'memory:status',
    onProgress: 'memory:onProgress'
  },
  plugins: {
    listVerified: 'plugins:listVerified',
    invoke: 'plugins:invoke',
    status: 'plugins:status'
  },
  offensive: {
    loadScope: 'offensive:loadScope',
    confirm: 'offensive:confirm',
    startScan: 'offensive:startScan',
    stopScan: 'offensive:stopScan',
    status: 'offensive:status'
  },
  bgconn: {
    list: 'bgconn:list',
    start: 'bgconn:start',
    stop: 'bgconn:stop',
    configure: 'bgconn:configure',
    clearCredentials: 'bgconn:clearCredentials',
    status: 'bgconn:status'
  }
} as const;

export interface MemoryStatus { model: string; cases: number; chunks: number }
export interface MemoryProgress { done: number; total: number; label: string }

export interface AuthStatus { enabled: boolean; unlocked: boolean }

export type LocalAiState = 'using-existing' | 'bundled-ready' | 'running' | 'not-present' | 'downloading' | 'importing' | 'error';
export interface LocalAiStatus {
  state: LocalAiState;
  /** true when a responsive Ollama is reachable on the loopback endpoint right now */
  runtimeUp: boolean;
  /** true when the llama3.1 model is present in that runtime */
  modelPresent: boolean;
  /** true when this build shipped bundled runtime+model assets */
  bundled: boolean;
  message?: string;
}

export interface LocalAiProgress {
  phase: 'download' | 'import';
  receivedBytes?: number;
  totalBytes?: number | null;
  message?: string;
}

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
  [channels.files.mediaUrl]: { args: [CaseId, string]; returns: MediaUrlResult };
  [channels.files.extractAttachmentMeta]: { args: [CaseId, string]; returns: ExtractedAttachmentMeta };
  [channels.files.renameAttachment]: { args: [CaseId, string, string]; returns: string };

  [channels.entities.listAll]: { args: []; returns: EntityRecord[] };
  [channels.entities.create]: { args: [EntityCreateInput]; returns: EntityRecord };
  [channels.entities.update]: { args: [string, Partial<EntityCreateInput>]; returns: EntityRecord };
  [channels.entities.delete]: { args: [string]; returns: void };
  [channels.entities.merge]: { args: [string, string]; returns: EntityRecord };
  [channels.entities.linkToCase]: { args: [CaseId, string, EntityLinkOpts]; returns: void };
  [channels.entities.unlinkFromCase]: { args: [CaseId, string]; returns: void };
  [channels.entities.setRelationship]: { args: [CaseId, string, EntityRelationship | null]; returns: void };
  [channels.entities.casesForEntity]: { args: [string]; returns: { caseId: string; title: string }[] };

  [channels.bioImages.add]: { args: [CaseId, BioAddInput]; returns: BioImage };
  [channels.bioImages.delete]: { args: [CaseId, string]; returns: void };
  [channels.bioImages.setPrimary]: { args: [CaseId, string]; returns: void };
  [channels.bioImages.updateCaption]: { args: [CaseId, string, string]; returns: void };
  [channels.bioImages.readOriginal]: { args: [CaseId, string]; returns: string | null };
  [channels.bioImages.reveal]: { args: [CaseId, string]; returns: void };

  [channels.export.summaryHtml]: { args: [CaseId]; returns: string | null };
  [channels.export.summaryPdf]: { args: [CaseId]; returns: string | null };
  [channels.export.timelineCsv]: { args: [CaseId]; returns: string | null };
  [channels.export.linksCsv]: { args: [CaseId]; returns: string | null };
  [channels.export.entitiesCsv]: { args: [CaseId]; returns: string | null };
  [channels.export.attachmentsCsv]: { args: [CaseId]; returns: string | null };
  [channels.export.text]: { args: [string, string]; returns: string | null };

  [channels.search.query]: { args: [string]; returns: SearchResult[] };

  [channels.notes.list]: { args: [CaseId]; returns: { name: string; updatedAt: string }[] };
  [channels.notes.read]: { args: [CaseId, string]; returns: string };
  [channels.notes.write]: { args: [CaseId, string, string]; returns: void };
  [channels.notes.delete]: { args: [CaseId, string]; returns: void };

  [channels.settings.read]: { args: []; returns: AppSettings };
  [channels.settings.update]: { args: [Partial<AppSettings>]; returns: AppSettings };

  [channels.media.getSnapshot]: { args: []; returns: MediaLibrarySnapshot };
  [channels.media.addRoot]: { args: []; returns: MediaLibrarySnapshot };
  [channels.media.removeRoot]: { args: [string]; returns: MediaLibrarySnapshot };
  [channels.media.refresh]: { args: []; returns: MediaLibrarySnapshot };
  [channels.media.openFiles]: { args: []; returns: MediaTrack[] };
  [channels.media.loadPlaylist]: { args: []; returns: { title: string; path?: string; url?: string }[] };
  [channels.media.savePlaylist]: { args: [{ title: string; path?: string; url?: string }[]]; returns: string | null };
  [channels.media.upsertStation]: { args: [{ id?: string; label: string; url: string }]; returns: MediaStation };
  [channels.media.deleteStation]: { args: [string]; returns: void };

  [channels.geoint.snapshot]: { args: []; returns: GeoSnapshot };
  [channels.geoint.addSource]: { args: [{ label: string; url: string; type: 'rss' | 'atom' | 'geojson' }]; returns: GeoSource };
  [channels.geoint.updateSource]: { args: [string, Partial<GeoSource>]; returns: void };
  [channels.geoint.removeSource]: { args: [string]; returns: void };
  [channels.geoint.importOpml]: { args: []; returns: number };
  [channels.geoint.refresh]: { args: [string | undefined]; returns: { fetched: number; failed: number } };
  [channels.geoint.geocode]: { args: [string]; returns: { lat: number; lon: number; label: string } | null };
  [channels.geoint.setItemLocation]: { args: [string, { lat: number; lon: number } | null]; returns: void };
  [channels.geoint.saveToCase]: { args: [string, GeoItem, { form: 'record' | 'link' | 'note'; entityIds?: string[] }]; returns: { savedEventId?: string } };
  [channels.geoint.listCaseEvents]: { args: [string]; returns: SavedGeoEvent[] };
  [channels.geoint.removeCaseEvent]: { args: [string, string]; returns: void };

  [channels.markets.fetch]: { args: []; returns: MarketSnapshot };

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

  [channels.auth.status]: { args: []; returns: AuthStatus };
  [channels.auth.setup]: { args: [string]; returns: { recoveryKey: string } };
  [channels.auth.unlock]: { args: [string]; returns: void };
  [channels.auth.unlockRecovery]: { args: [string]; returns: void };
  [channels.auth.changePassword]: { args: [string]; returns: void };
  [channels.auth.disable]: { args: [string]; returns: void };
  [channels.auth.lock]: { args: []; returns: void };

  [channels.localAi.status]: { args: []; returns: LocalAiStatus };
  [channels.localAi.setup]: { args: [{ mode: 'online' | 'bundled' }]; returns: LocalAiStatus };
  [channels.localAi.start]: { args: []; returns: void };
  [channels.localAi.stop]: { args: []; returns: void };
  [channels.localAi.onProgress]: { args: [(payload: LocalAiProgress) => void]; returns: () => void };

  [channels.memory.reindexAll]: { args: []; returns: { cases: number; chunks: number } };
  [channels.memory.status]: { args: []; returns: MemoryStatus };
  [channels.memory.onProgress]: { args: [(payload: MemoryProgress) => void]; returns: () => void };

  [channels.plugins.listVerified]: { args: []; returns: import('./plugin-types').VerifiedPluginInfo[] };
  [channels.plugins.invoke]: { args: [string, string, unknown[]]; returns: unknown };
  [channels.plugins.status]: { args: []; returns: import('./plugin-types').PluginStatus[] };

  [channels.offensive.loadScope]: { args: [unknown, unknown?]; returns: void };
  [channels.offensive.confirm]: { args: []; returns: void };
  [channels.offensive.startScan]: { args: []; returns: { proxyPort: number } };
  [channels.offensive.stopScan]: { args: []; returns: void };
  [channels.offensive.status]: { args: []; returns: { proxyPort: number | null; hasScope: boolean; canScan: boolean } };

  [channels.bgconn.list]: { args: []; returns: Array<{ connId: string; routing: 'tor' | 'direct'; startedAt: number }> };
  [channels.bgconn.status]: { args: []; returns: Array<{ connId: string; routing: 'tor' | 'direct'; startedAt: number }> };
  [channels.bgconn.start]: { args: [string, { phone: string; routing: 'tor' | 'direct'; channelSetHash: string }, boolean]; returns: void };
  [channels.bgconn.stop]: { args: [string]; returns: void };
  [channels.bgconn.configure]: { args: [{ idleTeardownAfterMinutes: number | null; defaultRouting: 'tor' | 'direct'; maxReconnects: number; maxSessionAgeMinutes: number }]; returns: void };
  [channels.bgconn.clearCredentials]: { args: [string, string]; returns: void };
}

export const BGCONN_LOCK_EXEMPT_CHANNELS = ['bgconn:status', 'bgconn:stop'] as const;
