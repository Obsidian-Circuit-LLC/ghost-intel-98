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
  JournalEntry,
  JournalEntrySummary,
  JournalEntryInput,
  MediaUrlResult,
  ScrapingCase,
  SearchResult,
  Reminder,
  TaskItem,
  TimelineEvent,
  WebLink
} from './types';
import type { MediaLibrarySnapshot, MediaStation, MediaTrack, GeoSnapshot, GeoSource, GeoItem, SavedGeoEvent, MarketSnapshot, EventSummaryResult } from './post-mvp-types';
import type { SiteCatalogEntry, SweepResult, SearchlightCase, SearchlightCaseSummary } from './searchlight/types';
import type { InvestigationScene, SceneDelta } from './investigation-graph';
import type { RunEvent } from './investigation-agent';
import type { RunBudget } from './investigation-types';
import type { IntelReport } from './investigation-report';
import type { Invoice, Profile, InvoiceAsset } from './invoice-types';

/**
 * Metadata written after each retrain cycle.
 * Mirrors LearningModelMeta in src/main/searchlight/learning/trainer.ts.
 * Defined here so the IPC contract is self-contained in the shared package.
 */
export interface LearningModelMeta {
  trainedAt: number;
  labelCount: number;
  verdict: { pass: boolean; reason: string };
}
import type { HarvestedItem, MonitoredChannel } from './socmint/types';

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
    pickWallpaper: 'settings:pickWallpaper',
    pickBootSplash: 'settings:pickBootSplash',
    changed: 'settings:changed'
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
    cancel: 'tts:cancel',
    listVoices: 'tts:listVoices',
    revealVoicesFolder: 'tts:revealVoicesFolder'
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
    saveAttachment: 'mail:saveAttachment',
    deleteMessage: 'mail:deleteMessage',
    setFlag: 'mail:setFlag',
    printMessage: 'mail:printMessage',
    onNewMail: 'mail:onNewMail'
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
  journal: {
    list: 'journal:list',
    read: 'journal:read',
    save: 'journal:save',
    delete: 'journal:delete',
    hasPin: 'journal:hasPin',
    setPin: 'journal:setPin',
    verifyPin: 'journal:verifyPin',
    changePin: 'journal:changePin',
    putAsset: 'journal:putAsset',
    getAsset: 'journal:getAsset'
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
  documents: {
    list: 'documents:list',
    mkdir: 'documents:mkdir',
    rename: 'documents:rename',
    remove: 'documents:remove',
    copy: 'documents:copy',
    move: 'documents:move',
    importDropped: 'documents:importDropped',
    reveal: 'documents:reveal',
    export: 'documents:export',
    writeText: 'documents:writeText',
    readText: 'documents:readText',
    // Decrypted bytes of a My-Documents file, read in-process for the internal viewer
    // (never an OS handoff / shell.openPath). Returns a Uint8Array over the IPC wire.
    readBytes: 'documents:readBytes'
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
  shell: {
    requestEnable: 'shell:requestEnable',
    disable: 'shell:disable',
    connect: 'shell:connect',
    write: 'shell:write',
    resize: 'shell:resize',
    disconnect: 'shell:disconnect',
    onData: 'shell:onData',
    onClose: 'shell:onClose'
  },
  streams: {
    list: 'streams:list',
    upsert: 'streams:upsert',
    delete: 'streams:delete',
    clear: 'streams:clear',
    import: 'streams:import',
    detect: 'streams:detect',
    exportCctv: 'streams:exportCctv'
  },
  satellites: {
    list: 'satellites:list',
    upsert: 'satellites:upsert',
    remove: 'satellites:remove',
    fetchGroup: 'satellites:fetchGroup',
    snapshot: 'satellites:snapshot'
  },
  walls: {
    list: 'walls:list',
    get: 'walls:get',
    save: 'walls:save',
    delete: 'walls:delete'
  },
  sounds: {
    mailChime: 'sounds:mailChime',
    openFolder: 'sounds:openFolder'
  },
  media: {
    getSnapshot: 'media:getSnapshot',
    addRoot: 'media:addRoot',
    removeRoot: 'media:removeRoot',
    refresh: 'media:refresh',
    openFiles: 'media:openFiles',
    loadPlaylist: 'media:loadPlaylist',
    savePlaylist: 'media:savePlaylist',
    clearLibrary: 'media:clearLibrary',
    upsertStation: 'media:upsertStation',
    deleteStation: 'media:deleteStation',
    reorderStations: 'media:reorderStations',
    exportStations: 'media:exportStations'
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
    removeCaseEvent: 'geoint:removeCaseEvent',
    purgeCache: 'geoint:purgeCache',
    fetchThreatLayer: 'geoint:fetchThreatLayer',
    setLayerKey: 'geoint:setLayerKey',
    hasLayerKey: 'geoint:hasLayerKey',
    fetchKev: 'geoint:fetchKev',
    getMonitors: 'geoint:getMonitors',
    setMonitors: 'geoint:setMonitors',
    addMonitor: 'geoint:addMonitor',
    removeMonitor: 'geoint:removeMonitor',
    cctvTorReady: 'geoint:cctvTorReady',
    summarizeEvent: 'geoint:summarizeEvent'
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
    write: 'whiteboard:write',
    // Export the board as a PDF / DOCX (visual snapshot PNG + a structured node/edge appendix), or
    // as a portable, self-contained `.gboard` file; and import a `.gboard` back into a case. Every
    // export writes ONLY via the OS save dialog (never inside the encrypted store); import re-writes
    // embedded assets THROUGH the vault so encrypt-at-rest is preserved.
    exportPdf: 'whiteboard:exportPdf',
    exportDocx: 'whiteboard:exportDocx',
    exportFile: 'whiteboard:exportFile',
    importFile: 'whiteboard:importFile'
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
    onProgress: 'memory:onProgress',
    embedHealth: 'memory:embedHealth',
    // Adaptive-memory profile governance (Task 8) — list/edit/pin/delete/wipe the durable,
    // inspectable `MemoryItem` profile. `memory:onRecall` is deliberately NOT a channel here:
    // recall provenance rides the existing `ai:onChatChunk` stream (see ai.ts's `recall` field
    // on the done event) and preload filters/republishes it as `window.api.memory.onRecall`.
    profileList: 'memory:profileList',
    profileSummaries: 'memory:profileSummaries',
    profileUpsert: 'memory:profileUpsert',
    profileDelete: 'memory:profileDelete',
    profileWipe: 'memory:profileWipe',
    // Global document library (uploads + briefcase + journal) CRUD — extraction happens
    // renderer-side; the handler only stores already-extracted text and reindexes the library.
    libraryList: 'memory:libraryList',
    libraryAdd: 'memory:libraryAdd',
    libraryRemove: 'memory:libraryRemove',
    // Mind's Eye curation: forgetting a `doc`-kind node removes it from the global library AND
    // reindexes the library shard so recall stops surfacing it immediately (unlike libraryRemove
    // above, which only fires a debounced live-reindex — forgetDoc reindexes synchronously so the
    // "forgotten" node/evidence is gone from the graph and recall on the very next call).
    forgetDoc: 'memory:forgetDoc',
    // Mind's Eye curation: forget/remember a *conversation's* memory. A reversible tombstone —
    // forgetConversation sets `memoryExcluded` on the chat record (the chat itself SURVIVES in the
    // AI Assistant), reindexes conversations synchronously so its node/chunks vanish, and prunes any
    // dangling user bond to that node; rememberConversation clears the flag and reindexes so the
    // node/chunks return. Both await the reindex, so an embed-engine failure rejects (no silent success).
    forgetConversation: 'memory:forgetConversation',
    rememberConversation: 'memory:rememberConversation',
    // Mind's Eye curation: merge a duplicate fact (`dropId`) into another (`keepId`) — unions
    // provenance, keeps the higher confidence, drops the other. Also how the "one thing to fix"
    // tray resolves a detected conflict pair (see graph/merge.ts's detectConflicts/mergeItems).
    mergeItems: 'memory:mergeItems',
    // Mind's Eye: the assembled node/edge graph (shards + profile → nodes → auto-edges →
    // deterministic layout). Read-only — curation writes go through the profile/library/bond
    // channels above and this is simply re-fetched afterward.
    graph: 'memory:graph',
    // Mind's Eye: user-drawn retrieval bonds (undirected, one-hop, boost co-recall — see
    // `bonds.ts`/`retriever.ts`'s `applyBondBoost`). Drawn by dragging node-to-node in the graph;
    // cut by clicking the bond edge. `bondAdd`/`bondRemove` take the two node ids as separate args
    // (order-independent — `createBonds` normalizes/dedupes internally).
    bondList: 'memory:bondList',
    bondAdd: 'memory:bondAdd',
    bondRemove: 'memory:bondRemove'
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
  },
  hostinfo: { resolve: 'hostinfo:resolve' },
  livefeeds: {
    fetchAdsb: 'livefeeds:fetchAdsb',
    aisStart: 'livefeeds:aisStart',
    aisStop: 'livefeeds:aisStop',
    aisSetBbox: 'livefeeds:aisSetBbox',
    onAisPositions: 'livefeeds:onAisPositions'
  },
  searchlight: {
    catalog: 'searchlight:catalog',
    startSweep: 'searchlight:startSweep',
    cancelSweep: 'searchlight:cancelSweep',
    importSites: 'searchlight:importSites',
    listCases: 'searchlight:listCases',
    saveCase: 'searchlight:saveCase',
    loadCase: 'searchlight:loadCase',
    deleteCase: 'searchlight:deleteCase',
    exportCase: 'searchlight:exportCase',
    importCase: 'searchlight:importCase',
    onSweepResult: 'searchlight:onSweepResult',
    onSweepDone: 'searchlight:onSweepDone',
    favicon: 'searchlight:favicon',
    addCustomSite: 'searchlight:addCustomSite',
    exportSites: 'searchlight:exportSites',
    exportPdf: 'searchlight:exportPdf',
    saveReport: 'searchlight:saveReport',
    torStatus: 'searchlight:torStatus',
    connectTor: 'searchlight:connectTor',
    revealSiteDbDir: 'searchlight:revealSiteDbDir',
    // Adaptive-learning channels (Task 10)
    labelResult: 'searchlight:labelResult',
    learningStatus: 'searchlight:learningStatus',
    trainModel: 'searchlight:trainModel',
    setMlEnabled: 'searchlight:setMlEnabled'
  },
  socmint: {
    addChannel: 'socmint:addChannel',
    removeChannel: 'socmint:removeChannel',
    listChannels: 'socmint:listChannels',
    listItems: 'socmint:listItems',
    rankItems: 'socmint:rankItems',
    recordLabel: 'socmint:recordLabel',
    setBurner: 'socmint:setBurner',
    hasBurner: 'socmint:hasBurner',
    startMonitor: 'socmint:startMonitor',
    stopMonitor: 'socmint:stopMonitor',
    /** Main→renderer push: a harvested item arrived from a live monitor session. */
    monitorItem: 'socmint:monitorItem',
    // WhatsApp linking ceremony (WA-T5 — stubs; WA-T6/T7 implement bodies)
    setWhatsappBurnerPairingCode: 'socmint:setWhatsappBurnerPairingCode',
    hasWhatsappBurner: 'socmint:hasWhatsappBurner',
    unlinkWhatsappBurner: 'socmint:unlinkWhatsappBurner',
    // Telegram Hunter capture-window engine (TG5 — replaces the retired mtcute streaming
    // engine). Pull-based visible-DOM capture inside a Tor-fail-closed hardened window;
    // every handler is safeHandleWithEvent + assertTrustedSender.
    telegram: {
      /** Open (or resurface) the Tor-proxied Telegram capture window; blocked when Tor is down. */
      connect: 'socmint:telegram:connect',
      /** Capture the visible messages in the open chat → encrypted case store. */
      capture: 'socmint:telegram:capture',
      /** Capture the visible group/channel members → encrypted members store (no fabricated total). */
      captureMembers: 'socmint:telegram:captureMembers',
      /** Capture the visible user-profile panel → encrypted profiles store (no fabricated creation date). */
      captureProfile: 'socmint:telegram:captureProfile',
      /** Export a captured Telegram collection (messages/members/profiles) as JSON, formula-guarded CSV, or an HTML-escaped report. */
      exportItems: 'socmint:telegram:exportItems',
      /** Import a Telegram Desktop JSON export (operator-picked file); LFI-guarded parse → encrypted imports store. */
      importExport: 'socmint:telegram:importExport',
      /** Persist literal keyword-watch terms + scan the case's captured messages for matches (no RegExp on input). */
      keywordScan: 'socmint:telegram:keywordScan'
    }
  },
  // X Listening Station — Tor-default (by default), campaign-scoped visible-DOM capture,
  // wired to session.ts/capture.ts/campaigns.ts/analysis.ts/evidence.ts (Enterprise-port
  // Tasks 1-5). The prior clearnet-only X1-X8 surface (`connect`/`status`/`capture`/
  // `captureThreadComments`/`captureFollowers`/`captureFollowing`/`exportNetwork`/
  // `runArchiveCycle(s)`/`exportItems`) was retired wholesale at Task 16 — every surviving
  // capture channel below is Tor-safe. Every handler is safeHandle + assertTrustedSender.
  xListening: {
    /** Upsert one analyst note (keyed by findingId) into the encrypted `notes` store. */
    saveNote: 'xListening:saveNote',
    /** Read a case's analyst notes from the encrypted `notes` store. */
    readNotes: 'xListening:readNotes',
    /** Delete the note attached to one finding, if any (Task 10). A no-op when the finding
     *  has no note. */
    removeNote: 'xListening:removeNote',

    // ---- Phase-1 Enterprise-port surface (plan Task 6) ---------------------------------
    /** Open (or reuse) the Tor-default capture window for one campaign (session.ts). Fails
     *  closed (`blocked:true`) when background Tor isn't bootstrapped and
     *  `AppSettings.xListening.clearnet` isn't opted in — never a silent clearnet fallback. */
    openSession: 'xListening:openSession',
    /** Derived `{connected, windowOpen}` for one campaign (session.ts) — `connected` is the
     *  auth-cookie presence on the shared partition; `windowOpen` is per-campaign. */
    sessionStatus: 'xListening:sessionStatus',
    /** Close (not log out of) one campaign's live capture window (session.ts). */
    closeSession: 'xListening:closeSession',
    /** Capture the ALREADY-VISIBLE X profile timeline in a campaign's open capture window
     *  (capture.ts) — the analyst navigates the visible window to the target manually; this
     *  channel captures whatever page is currently loaded, folds metrics/metricsRaw into an
     *  evidence-hashed `XPostArtifact`, and persists to both the plain-item and richer sidecars. */
    captureTimeline: 'xListening:captureTimeline',
    /** List every captured post artifact for a campaign (store.ts `posts.read`) — the
     *  PERSISTED source of truth for the Dashboard/Live/Sources tabs (Task 14). `captureTimeline`
     *  above returns only the freshly captured batch from ONE call; a tab that must show
     *  everything already stored for the campaign (including posts captured in a prior session)
     *  reads this channel instead — a renderer-only cache of one call's results would silently
     *  go stale and under-represent what secure-fs actually holds. Derived passthrough, nothing
     *  computed; synthetic/demo posts are returned AS-IS (the DEMO DATA LOADED marker's predicate
     *  needs to see them) — exclusion from real intel happens downstream at `analysis`/`entities`/
     *  exports/hashing, not here. */
    postsList: 'xListening:posts:list',
    /** List every self-managed X campaign (x-namespace scraping case; campaigns.ts) — no core
     *  investigation case need be bound. */
    campaignsList: 'xListening:campaigns:list',
    /** Create a new campaign. */
    campaignsCreate: 'xListening:campaigns:create',
    /** Look up (and thereby validate) an existing campaign by id. */
    campaignsSwitch: 'xListening:campaigns:switch',
    /** Rename a campaign. */
    campaignsUpdate: 'xListening:campaigns:update',
    /** Delete a campaign — removes its entire on-disk directory recursively. */
    campaignsDelete: 'xListening:campaigns:delete',
    /** Duplicate a campaign's SETUP (presets/settings/image-policy/editor-meta) into a fresh
     *  investigation with zero collected counts (Task J1). */
    campaignsDuplicate: 'xListening:campaigns:duplicate',
    /** Read every campaign's editor meta (purpose/description) as a `{ [id]: meta }` map (Task J1). */
    campaignsMeta: 'xListening:campaigns:meta',
    /** Derived, on-read common-connection network analysis over a case's captured `networks`
     *  artifacts (analysis.ts `computeNetworkAnalysis`) — not persisted; synthetic/demo rows
     *  are excluded (honesty). */
    analysis: 'xListening:analysis',
    /** Derived collection-health rollup (analysis.ts `deriveCollectionHealth`). Reads the persisted
     *  run log (`store.listRunLog`) + captured posts/networks and derives a per-target roster:
     *  HEALTHY/PLATEAU/ERROR for a collected target, IDLE for a derived-but-never-collected one,
     *  each with postCount/followerCount/followingCount/oldestPostAt. Synthetic/demo rows excluded
     *  (honesty). Arg: the caseId (campaign) to scope the rollup to. */
    health: 'xListening:health',
    /** Derived entity rollup (analysis.ts `extractEntities`) over a case's captured posts —
     *  recomputed on every call, never persisted; synthetic/demo posts are excluded (honesty). */
    entities: 'xListening:entities',
    /** Campaign-wide avatar lookup — `{ canonicalHandle → LOCAL data: URI }` over the per-campaign
     *  avatar cache (`buildAvatarLookup`, the repair ledger). The hardened analog of Enterprise's
     *  `avatarLookup`/`avatarFor`: the ENTITY INDEX resolves each mention/source handle to a
     *  LOCALIZED avatar through this map (monogram fallback when absent). CACHE-ONLY — no capture
     *  window, no network; only local `data:` URIs are ever returned (never a remote URL). */
    avatars: 'xListening:avatars',
    /** Read a case's saved highlight presets. */
    presetsRead: 'xListening:presets:read',
    /** Upsert one highlight preset (keyed by id); `updatedAt` is stamped MAIN-side. */
    presetsSave: 'xListening:presets:save',
    /** Delete one highlight preset by id (Task 10). A no-op when the id has no preset. */
    presetsRemove: 'xListening:presets:remove',
    /** Run one saved preset over the case's captured posts → the matches, for local
     *  highlight-search / renderer highlighting (Task 10). Derived-on-read, never persisted;
     *  synthetic/demo posts are excluded (honesty). */
    presetsRun: 'xListening:presets:run',

    // ---- Task 15: remaining tab wiring + Phase-2 gap closure ---------------------------
    /** List every captured follower/following artifact for a campaign (store.ts `networks.read`)
     *  — the raw per-account rows (including `firstObservedAt`/`lastObservedAt`) the Changes tab
     *  needs to show newly-observed vs long-standing accounts. `analysis` derives aggregate stats
     *  from the same data but does not surface individual observation timestamps. Synthetic/demo
     *  accounts are returned AS-IS (same "exclusion happens downstream" posture as `postsList`). */
    networksList: 'xListening:networks:list',
    /** Read a campaign's resumable archive cursor/cycle-count (store.ts `archiveState.read`) —
     *  null before the first step ever ran. */
    archiveStatus: 'xListening:archive:status',
    /** Run a bounded, low-rate sequence of archive steps (archive.ts `runArchiveSteps`, Task 8) in
     *  a campaign's Tor-default capture window. Gated MAIN-side on
     *  `AppSettings.xListening.archiveCycles` (fail-closed OFF); `maxCycles` clamped to [0,1000]. */
    archiveRun: 'xListening:archive:run',
    /** Load the deterministic seeded demo data set (demo.ts, Task 12) into a campaign — every
     *  record carries `synthetic:true`, enforced-excluded from analysis/entities/exports/hashing. */
    loadDemoData: 'xListening:demo:load',
    /** Export a campaign's REAL (synthetic-excluded) captured posts to an operator-chosen path via
     *  a native save dialog (exports.ts `exportXPostsToFile`, Task 11) — the renderer NEVER
     *  supplies a filesystem path itself (closes the arbitrary-write finding). Writes a SHA-256
     *  checksum sidecar alongside the export. */
    exportPostsToFile: 'xListening:export:postsToFile',
    /** Export a campaign's REAL (synthetic-excluded) captured networks as CSV to an
     *  operator-chosen path via a native save dialog (`exportNetworkCsv`, Task 7) — same
     *  save-dialog-only discipline as `exportPostsToFile`, plus a SHA-256 checksum sidecar. */
    exportNetworkToFile: 'xListening:export:networkToFile',
    /** Read back one previously-cached local media ref (media.ts `cacheRemoteMedia`, Task 9) as a
     *  `data:` URI for renderer display. `ref` is validated against the exact
     *  `x-media/<64-hex sha256>` shape `cacheRemoteMedia` produces BEFORE any path is built —
     *  closes path traversal from a crafted ref. Returns null (never throws) on a malformed ref
     *  or a read failure — a display miss, not a fault. */
    mediaRead: 'xListening:media:read',
    /** List a campaign's historical change events (store.ts `listChangeEvents`, Task A2) —
     *  newest-first, capped ~500. The Change Intel tab's HISTORICAL CHANGE EVENTS stream
     *  (post_changed / profile_change / post_unavailable). Derived read; no capture window,
     *  no network. */
    changeEvents: 'xListening:changeEvents',
    /** Re-verify ONE captured post against its live X URL (capture.ts `verifyPost`, Task A1 —
     *  VERIFY LIVE). Opens the post's real URL in a Tor-gated capture window (FAIL CLOSED — no
     *  clearnet fallback unless the acked clearnet toggle is on), detects an unavailable/deleted/
     *  removed post (→ `post_unavailable` + availability update) or a live text edit (→ prior
     *  version archived + `post_changed`, via A2). Reuses the openPostThread scheme/host/path
     *  guards + the `^[A-Za-z0-9_]{1,15}$` username validator. */
    verifyPost: 'xListening:verifyPost',
    /** List a campaign's collection-run log (store.ts `listRunLog`, Task A3) — newest-first,
     *  capped ~100. The Change Intel tab's COLLECTION RUN LOG: one per-operation record
     *  (`{ profileId, username, operation, observed, added, duplicates, requestedPasses,
     *  completedPasses, reachedEnd, stopReason, status, startedAt, endedAt }`) emitted by the
     *  capture/archive paths. Derived read; no capture window, no network. */
    runLog: 'xListening:runLog',
    /** Extract one target's followers or following into the campaign's `networks` accumulator
     *  (capture.ts `captureNetwork`, Task C1 — EXTRACT FOLLOWERS/FOLLOWING/BOTH). Opens a Tor-gated
     *  hidden capture window on the shared authenticated X partition, navigated to
     *  `https://x.com/<user>/{followers|following}` (URL validated + built with `^[A-Za-z0-9_]{1,15}$`
     *  BEFORE any window opens), gates the page (signed-in), scroll-scrapes the visible `UserCell`
     *  rows with the STATIC `USER_CELL_SCRIPT`, normalizes (`normalizeNetwork` — evidence-hashed,
     *  remote avatars dropped) + persists via the same accumulator a re-scan uses, and emits a
     *  collection-run record. Tor-gated (FAIL CLOSED — no clearnet fallback unless the acked clearnet
     *  toggle is on); the window is always destroyed in a `finally`. The renderer's EXTRACT BOTH
     *  drives this twice (followers then following). */
    captureNetwork: 'xListening:captureNetwork',
    /** Open one in-app X window (capture.ts `openInX`, Task E1) for a `{ kind, ref }` affordance —
     *  `kind:'thread'` (ref = a `/<user>/status/<id>` URL), `kind:'profile'`/`'identity'` (ref = a
     *  `@username` handle). The URL is validated + constructed with strict guards (reuse the
     *  openPostThread scheme/host/path guards + `^[A-Za-z0-9_]{1,15}$`) BEFORE any window opens —
     *  a malformed ref throws, opening nothing. Tor-gated (FAIL CLOSED — no clearnet fallback
     *  unless the acked clearnet toggle is on). Consumed by the Network graph inspector (C2b) and
     *  the per-source "View X" action (D1). Opens IN-APP only, never via an OS shell hand-off. */
    openInX: 'xListening:openInX',
    /** Cascade-remove a DERIVED source from a campaign (ipc.ts `removeSource`, Task D1 — Target
     *  Sources REMOVE). A source is not a persisted record — it is derived from the captured posts —
     *  so removal is a read-filter-write over the `posts` + `networks` sidecars: every post whose
     *  `channelId`/`authorHandle` matches `sourceKey` and every network artifact whose `target`
     *  matches are dropped (case-insensitive, `@`-insensitive). Local secure-fs only — no window,
     *  no network egress. Returns the counts removed. Consumed by the per-source REMOVE action. */
    removeSource: 'xListening:removeSource',
    /** Read a campaign's per-campaign COLLECTION SETTINGS (collection-settings.ts `getCollectionSettings`,
     *  F2 — the System-tab form). Derived read of the encrypted `x-collection-settings.json` sidecar,
     *  healed to a full clamped record; no capture window, no network. G1 (scheduling) + F1 (image
     *  policy) read the same record. */
    getCollectionSettings: 'xListening:collectionSettings:get',
    /** Clamp (MAIN-side, never trusting the renderer) + persist a campaign's COLLECTION SETTINGS
     *  (collection-settings.ts `saveCollectionSettings`, F2). Every numeric field is bounded to its
     *  Enterprise band before it is stored or consulted; returns the exact clamped record. Local
     *  secure-fs only — no capture window, no network egress. Consulted by the capture path
     *  (`captureTimeline` collect gate + `captureNetwork` base passes). */
    saveCollectionSettings: 'xListening:collectionSettings:save',
    /** Read a campaign's per-profile IMAGE-COLLECTION policy (image-policy.ts `getImagePolicy`, F1):
     *  the `{ canonicalSourceKey → 'on'|'off'|'inherit' }` override map + F2's campaign `retrieveImages`
     *  toggle, so the renderer can render each source's Images control AND its EFFECTIVE state. Local
     *  secure-fs only — no capture window, no network egress. */
    getImagePolicy: 'xListening:imagePolicy:get',
    /** Set one source's per-profile image mode (image-policy.ts `setProfileImageMode`, F1). The mode
     *  is validated MAIN-side (must be 'on'|'off'|'inherit' — the renderer is never trusted) and the
     *  source key canonicalized before the encrypted per-campaign map is updated; returns the stored
     *  record + the EFFECTIVE decision (resolved against `retrieveImages`). The capture path consults
     *  the same policy: an 'off' source has NO post media fetched/cached. Local secure-fs only. */
    setProfileImageMode: 'xListening:imagePolicy:set',
    /** Read a campaign's automatic-sweep/archive SCHEDULE status (scheduler.ts `scheduleStatus`, G1):
     *  whether the free-running sweep/archive timers are armed, their interval, and the next-fire
     *  times — drives the renderer's next-sweep indicator + one-click Pause. Pure in-memory read of
     *  the scheduler registry; no capture window, no network egress. The timers themselves are armed
     *  MAIN-side on session connect / settings save; each scheduled sweep's capture routes the SAME
     *  Tor gate as a manual capture (fail-closed, no clearnet unless clearnet+clearnetAck). */
    scheduleStatus: 'xListening:schedule:status'
  },
  // Scraping cases — the isolated per-namespace case stores for SOCMINT + X collection runs
  // (kept apart from the core investigation `cases` namespace). Every handler takes a
  // `store: 'socmint' | 'x'` discriminator that main validates against an allowlist and routes
  // to the matching namespace store; an unknown value throws (W4 Task 3).
  scrapingCases: {
    list: 'scrapingCases:list',
    create: 'scrapingCases:create',
    rename: 'scrapingCases:rename',
    remove: 'scrapingCases:remove',
    importToCase: 'scrapingCases:importToCase',
    saveArtifact: 'scrapingCases:saveArtifact'
  },
  // SP-4 investigation graph: the per-case scene fetch (nodes/edges assembled from the SP-2
  // entity store + provenance ledger) + a main→renderer push of live diffs as evidence is
  // appended. `addNode`/`addEdge` (Task 7) are the manual write path — a `manual` evidence
  // record referencing/relating existing or newly-created entities, streamed like any other
  // ledger append.
  investigation: {
    graph: 'investigation:graph',
    onGraphDelta: 'investigation:onGraphDelta',
    addNode: 'investigation:addNode',
    addEdge: 'investigation:addEdge',
    // SP-6 free-form orchestrator: the run harness's start/control surface + its event stream.
    // `start` returns the new runId; every other control channel is fire-and-forget (`void`) and
    // a silent no-op if the run has already finished — see run-controller's `rsOf`.
    run: {
      /** Capability probe: resolves `getBrain() != null` — true once the subsystem-2 reasoning
       *  pack is installed. The Run panel probes this on mount to show a calm "needs the reasoning
       *  pack" card instead of a dead Start button. */
      available: 'investigation:run:available',
      start: 'investigation:run:start',
      pause: 'investigation:run:pause',
      resume: 'investigation:run:resume',
      stop: 'investigation:run:stop',
      addScope: 'investigation:run:addScope',
      removeScope: 'investigation:run:removeScope',
      focus: 'investigation:run:focus',
      ignore: 'investigation:run:ignore',
      answer: 'investigation:run:answer',
      /** Main→renderer push: every `RunEvent` emitted by any live run, tagged with its runId. */
      onEvent: 'investigation:run:onEvent'
    },
    // SP-7 INTELREPORT: assemble a deterministic, ledger-sourced report (key-actors table +
    // findings + methodology appendix) with an optional boxed narrator, for on-screen preview.
    // `caseId` is UUID-gated at the boundary; the optional `runId` narrows every ledger read to a
    // single run (scope → 'run'). Facts are machine-derived; only the narrative prose is model-authored.
    report: {
      generate: 'investigation:report:generate',
      // Export the assembled report as a PDF via the shared offscreen render + OS save dialog.
      // Same UUID gate / bounded-runId filter as `generate`; no LLM, no egress.
      save: 'investigation:report:save'
    }
  },
  invoices: {
    list: 'invoices:list', save: 'invoices:save', remove: 'invoices:remove', duplicate: 'invoices:duplicate',
    nextNumber: 'invoices:nextNumber',
    listProfiles: 'invoices:listProfiles', saveProfile: 'invoices:saveProfile', removeProfile: 'invoices:removeProfile',
    putAsset: 'invoices:putAsset', getAsset: 'invoices:getAsset', exportPdf: 'invoices:exportPdf',
    exportDocx: 'invoices:exportDocx'
  },
  // Chain-of-Custody report generator. CRUD + contacts/descriptors libraries + asset blobs +
  // main-side id→buffer PDF/DOCX export (renderer never builds the export buffer).
  reports: {
    list: 'reports:list', save: 'reports:save', remove: 'reports:remove',
    putAsset: 'reports:putAsset', getAsset: 'reports:getAsset', copyAsset: 'reports:copyAsset',
    contactsList: 'reports:contacts:list', contactsSave: 'reports:contacts:save', contactsRemove: 'reports:contacts:remove',
    descriptorsList: 'reports:descriptors:list', descriptorsSave: 'reports:descriptors:save', descriptorsRemove: 'reports:descriptors:remove',
    introductionsList: 'reports:introductions:list', introductionsSave: 'reports:introductions:save', introductionsRemove: 'reports:introductions:remove',
    templatesList: 'reports:templates:list', templatesSave: 'reports:templates:save', templatesRemove: 'reports:templates:remove',
    previewTemplate: 'reports:previewTemplate',
    exportPdf: 'reports:exportPdf',
    exportDocx: 'reports:exportDocx'
  },
  // PDF Signer (core module) — capped transient read of a picked PDF + pdf-lib overlay sign + save
  // dialog. The source PDF is never written to the vault; only the signed copy hits disk (via the
  // OS save dialog, at a user-chosen path).
  pdfsign: {
    read: 'pdfsign:read',
    sign: 'pdfsign:sign'
  }
} as const;

/** Renderer-facing scraping-case store discriminator. Validated main-side against the same
 *  allowlist (see assertScrapingStore in src/main/scraping-cases/ipc.ts). Declared here so the
 *  shared contract + preload stay self-contained without importing a main-process type. */
export type ScrapingCaseStoreId = 'socmint' | 'x';

/** Result of importing a scraping case's items into a main investigation case. */
export interface ScrapingImportResult { imported: number }

export interface MemoryStatus { model: string; cases: number; chunks: number }
export interface MemoryProgress { done: number; total: number; label: string }

/** Mirrors LibraryDoc in src/main/services/memory/library/store.ts — one entry in the global
 *  document library manifest. Defined here so preload/renderer stay self-contained, matching
 *  the existing MemoryStatus/MemoryItem mirror pattern. */
export interface LibraryDoc {
  docId: string;
  title: string;
  mime: string;
  addedAt: number;
  charCount: number;
  bytesHash: string;
}

/**
 * Mirrors MemoryItem in src/main/services/memory/profile/types.ts — the adaptive-memory profile
 * item shape. Defined here (rather than imported from main) so preload/renderer stay self-
 * contained in the shared package, matching the existing MemoryStatus/LearningModelMeta pattern.
 */
export interface MemoryItem {
  id: string;
  scope: string;
  text: string;
  normalized: string;
  provenance: string[];
  confidence: number;
  createdAt: number;
  lastSeenAt: number;
  pinned: boolean;
  source: 'extractor' | 'user';
}

/** Mirrors RecallHit in src/main/services/memory/retriever.ts. */
export interface RecallHitShape {
  caseId: string;
  caseTitle: string;
  kind: 'desc' | 'note' | 'file' | 'entity' | 'chat';
  ref: string;
  text: string;
  snippet: string;
  score: number;
  /** True when this hit's score was boosted by a user-drawn bond (see `retriever.ts`'s
   *  `applyBondBoost`) — lets the renderer's provenance display say "recalled via your link". */
  viaBond?: boolean;
}

/** Mirrors Bond in src/main/services/memory/bonds.ts — an undirected retrieval bond between two
 *  Mind's Eye graph node ids, always stored with `a < b`. */
export interface BondShape {
  a: string;
  b: string;
}

/** Recall-preview payload emitted per generation (see ai.ts's `recall` field on the done event of
 *  `ai:onChatChunk`) — what was actually recalled/injected (vector-RAG hits + adaptive-profile
 *  items + the rolling-summary prose) for that answer. Governance transparency: never silent about
 *  what memory contributed — `profileSummary` is the distilled prior-conversation prose folded into
 *  the injected profile block, `''` when none was injected. */
export interface RecallPreview { rag: RecallHitShape[]; profile: MemoryItem[]; profileSummary: string }

/**
 * Mirrors src/main/services/memory/graph/model.ts — the Mind's Eye graph shape. Defined here
 * (rather than imported from main) so preload/renderer stay self-contained in the shared package,
 * matching the LibraryDoc / MemoryItem mirror pattern above.
 */
export type GraphNodeKind = 'fact' | 'doc' | 'conversation' | 'entity';

export interface GraphNodeShape {
  id: string;
  kind: GraphNodeKind;
  label: string;
  strength: number;
  pinned: boolean;
  conflict: boolean;
  vector: number[];
  x: number;
  y: number;
  cluster: number;
}

export type GraphEdgeKind = 'auto' | 'bond';

export interface GraphEdgeShape { source: string; target: string; kind: GraphEdgeKind; weight: number }

export interface MemoryGraphShape {
  nodes: GraphNodeShape[];
  edges: GraphEdgeShape[];
  /** Actual conflicting-fact-id pairs (mirrors `MemoryGraph.conflictPairs`) — the "one thing to
   *  fix" tray uses this to show a real detected pair instead of guessing from `conflict`-flagged
   *  node iteration order. */
  conflictPairs: [string, string][];
}

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

/** Signature placement: top-left-anchored fractions of the target page (0..1), clamped main-side
 *  by ensurePlacement. Structurally identical to the `Placement` interface `signPdf` consumes. */
export interface PdfSignPlacement { page: number; xFrac: number; yFrac: number; wFrac: number }

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

  // Decrypted bytes of a My-Documents file for the internal viewer (Uint8Array over IPC — the store
  // caps the size before reading; structured clone transfers it natively, no number[] inflation).
  [channels.documents.readBytes]: { args: [string]; returns: Uint8Array };

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
  [channels.media.clearLibrary]: { args: []; returns: MediaLibrarySnapshot };
  [channels.media.upsertStation]: { args: [{ id?: string; label: string; url: string }]; returns: MediaStation };
  [channels.media.deleteStation]: { args: [string]; returns: void };
  [channels.media.reorderStations]: { args: [string[]]; returns: MediaLibrarySnapshot };
  [channels.media.exportStations]: { args: []; returns: string | null };

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
  [channels.geoint.purgeCache]: { args: []; returns: void };
  [channels.geoint.fetchThreatLayer]: { args: [string, { feed?: string }]; returns: GeoItem[] };
  [channels.geoint.setLayerKey]: { args: [string, string]; returns: void };
  [channels.geoint.hasLayerKey]: { args: [string]; returns: boolean };
  [channels.geoint.getMonitors]: { args: []; returns: string[] };
  [channels.geoint.setMonitors]: { args: [string[]]; returns: void };
  [channels.geoint.addMonitor]: { args: [string]; returns: string[] };
  [channels.geoint.removeMonitor]: { args: [string]; returns: string[] };
  [channels.geoint.cctvTorReady]: { args: []; returns: boolean };
  [channels.geoint.summarizeEvent]: { args: [string]; returns: EventSummaryResult };

  [channels.markets.fetch]: { args: []; returns: MarketSnapshot };

  [channels.journal.list]: { args: []; returns: JournalEntrySummary[] };
  [channels.journal.read]: { args: [string]; returns: JournalEntry | null };
  [channels.journal.save]: { args: [JournalEntryInput]; returns: JournalEntry };
  [channels.journal.delete]: { args: [string]; returns: void };
  [channels.journal.hasPin]: { args: []; returns: boolean };
  [channels.journal.setPin]: { args: [string]; returns: void };
  [channels.journal.verifyPin]: { args: [string]; returns: boolean };
  [channels.journal.changePin]: { args: [string, string]; returns: boolean };
  [channels.journal.putAsset]: { args: [{ bytes: number[]; mime: string }]; returns: string };
  [channels.journal.getAsset]: { args: [string]; returns: { mime: string; dataUrl: string } | null };

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

  [channels.memory.reindexAll]: { args: []; returns: { cases: number; chunks: number; failures: { label: string; error: string }[] } };
  [channels.memory.status]: { args: []; returns: MemoryStatus };
  [channels.memory.onProgress]: { args: [(payload: MemoryProgress) => void]; returns: () => void };
  [channels.memory.embedHealth]: { args: []; returns: 'ready' | 'starting' | 'unavailable' | 'model-missing' };
  [channels.memory.profileList]: { args: [string | undefined]; returns: MemoryItem[] };
  [channels.memory.profileSummaries]: { args: []; returns: Record<string, string> };
  [channels.memory.profileUpsert]: { args: [Pick<MemoryItem, 'id' | 'scope' | 'text' | 'pinned'>]; returns: MemoryItem[] };
  [channels.memory.profileDelete]: { args: [string[]]; returns: void };
  [channels.memory.profileWipe]: { args: [string | undefined]; returns: void };
  [channels.memory.libraryList]: { args: []; returns: LibraryDoc[] };
  [channels.memory.libraryAdd]: { args: [{ title: string; mime: string; text: string }]; returns: LibraryDoc };
  [channels.memory.libraryRemove]: { args: [string]; returns: void };
  [channels.memory.forgetDoc]: { args: [string]; returns: void };
  [channels.memory.forgetConversation]: { args: [string]; returns: void };
  [channels.memory.rememberConversation]: { args: [string]; returns: void };
  [channels.memory.mergeItems]: { args: [{ keepId: string; dropId: string }]; returns: MemoryItem[] };
  [channels.memory.graph]: { args: []; returns: MemoryGraphShape };
  [channels.memory.bondList]: { args: []; returns: BondShape[] };
  [channels.memory.bondAdd]: { args: [string, string]; returns: void };
  [channels.memory.bondRemove]: { args: [string, string]; returns: void };

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

  [channels.searchlight.catalog]: { args: []; returns: SiteCatalogEntry[] };
  [channels.searchlight.startSweep]: { args: [{ username: string; siteIds: string[]; useTor: boolean }]; returns: { jobId: string; total: number } };
  [channels.searchlight.cancelSweep]: { args: [string]; returns: void };
  [channels.searchlight.importSites]: { args: [string]; returns: { added: number; rejected: number } };
  [channels.searchlight.listCases]: { args: []; returns: SearchlightCaseSummary[] };
  [channels.searchlight.saveCase]: { args: [SearchlightCase]; returns: void };
  [channels.searchlight.loadCase]: { args: [string]; returns: SearchlightCase | null };
  [channels.searchlight.deleteCase]: { args: [string]; returns: void };
  [channels.searchlight.exportCase]: { args: [string]; returns: string | null };
  [channels.searchlight.importCase]: { args: [string]; returns: SearchlightCase | null };
  [channels.searchlight.onSweepResult]: { args: [(r: SweepResult) => void]; returns: () => void };
  [channels.searchlight.onSweepDone]: { args: [(f: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void]; returns: () => void };
  [channels.searchlight.favicon]: { args: [name: string]; returns: string | null };
  [channels.searchlight.addCustomSite]: { args: [{ name: string; url: string; category?: string }]; returns: { ok: boolean; reason?: string } };
  [channels.searchlight.exportSites]: { args: []; returns: string };
  [channels.searchlight.exportPdf]: { args: [{ html: string; filename: string }]; returns: { ok: boolean } };
  [channels.searchlight.saveReport]: { args: [{ content: string; defaultName: string }]; returns: { ok: boolean } };
  [channels.searchlight.torStatus]: { args: []; returns: { state: 'off' | 'connecting' | 'ready' } };
  [channels.searchlight.connectTor]: { args: []; returns: { state: 'off' | 'connecting' | 'ready'; error?: string } };
  [channels.searchlight.revealSiteDbDir]: { args: []; returns: void };
  // Adaptive-learning channels (Task 10 / Task 11)
  // labelResult: renderer supplies resultId + label + caseId + siteName only;
  //   features and soft come from main-process-captured CapturedVector.
  [channels.searchlight.labelResult]: { args: [{ resultId: string; label: 0 | 1; siteName: string; caseId: string }]; returns: { ok: boolean } };
  [channels.searchlight.learningStatus]: { args: []; returns: { labelCount: number; meta: LearningModelMeta | null; mlEnabled: boolean } | null };
  [channels.searchlight.trainModel]: { args: []; returns: { verdict: { pass: boolean; reason: string }; labelCount: number } };
  [channels.searchlight.setMlEnabled]: { args: [boolean]; returns: { ok: boolean } };

  [channels.socmint.addChannel]: { args: [string, unknown]; returns: MonitoredChannel[] };
  [channels.socmint.removeChannel]: { args: [string, string]; returns: MonitoredChannel[] };
  [channels.socmint.listChannels]: { args: [string]; returns: MonitoredChannel[] };
  [channels.socmint.listItems]: { args: [string]; returns: HarvestedItem[] };
  [channels.socmint.rankItems]: { args: [string, string]; returns: HarvestedItem[] };
  [channels.socmint.recordLabel]: { args: [string, unknown]; returns: void };
  [channels.socmint.setBurner]: { args: [string, unknown]; returns: void };
  [channels.socmint.hasBurner]: { args: [string]; returns: boolean };
  [channels.socmint.startMonitor]: { args: [unknown]; returns: { disabled: true } | { started: true; jobId: string } | { noChannels: true } };
  [channels.socmint.stopMonitor]: { args: [string]; returns: void };
  // WhatsApp linking ceremony — WA-T5 contracts; bodies implemented in WA-T6/T7.
  // gate-closed → { disabled: true }; gate-open + sealed lib → sealed error (not crash).
  [channels.socmint.setWhatsappBurnerPairingCode]: { args: [string, string]; returns: { disabled: true } | { pairingCode: string } };
  // boolean only — never echoes the stored secret value.
  [channels.socmint.hasWhatsappBurner]: { args: [string]; returns: boolean };
  // Deletes secretStore entries for the given burnerId; does NOT server-side-unlink (user must).
  [channels.socmint.unlinkWhatsappBurner]: { args: [string]; returns: void };

  // Scraping cases (W4 Task 3) — `store` is validated main-side against ['socmint','x'].
  [channels.scrapingCases.list]: { args: [ScrapingCaseStoreId]; returns: ScrapingCase[] };
  [channels.scrapingCases.create]: { args: [ScrapingCaseStoreId, string]; returns: ScrapingCase };
  [channels.scrapingCases.rename]: { args: [ScrapingCaseStoreId, string, string]; returns: ScrapingCase };
  [channels.scrapingCases.remove]: { args: [ScrapingCaseStoreId, string]; returns: void };
  [channels.scrapingCases.importToCase]: { args: [ScrapingCaseStoreId, string, string]; returns: ScrapingImportResult };
  [channels.scrapingCases.saveArtifact]: { args: [ScrapingCaseStoreId, string, string, string]; returns: string };

  [channels.investigation.graph]: { args: [string]; returns: InvestigationScene };
  [channels.investigation.onGraphDelta]: { args: [(payload: { caseId: string; delta: SceneDelta }) => void]; returns: () => void };
  [channels.investigation.addNode]: { args: [string, EntityType, string]; returns: void };
  [channels.investigation.addEdge]: { args: [string, string, string, string]; returns: void };

  // SP-6 run harness IPC — see channels.investigation.run above.
  [channels.investigation.run.available]: { args: []; returns: boolean };
  [channels.investigation.run.start]: { args: [string, string[], string, RunBudget]; returns: string };
  [channels.investigation.run.pause]: { args: [string]; returns: void };
  [channels.investigation.run.resume]: { args: [string]; returns: void };
  [channels.investigation.run.stop]: { args: [string, string]; returns: void };
  [channels.investigation.run.addScope]: { args: [string, string]; returns: void };
  [channels.investigation.run.removeScope]: { args: [string, string]; returns: void };
  [channels.investigation.run.focus]: { args: [string, string]; returns: void };
  [channels.investigation.run.ignore]: { args: [string, string]; returns: void };
  [channels.investigation.run.answer]: { args: [string, string]; returns: void };
  [channels.investigation.run.onEvent]: { args: [(payload: { runId: string; event: RunEvent }) => void]; returns: () => void };

  // SP-7 INTELREPORT — generate the report model for on-screen preview. Optional `runId` narrows to
  // a single run (scope → 'run'); omit for the case aggregate.
  [channels.investigation.report.generate]: { args: [string, { runId?: string }?]; returns: IntelReport };
  // SP-7 INTELREPORT — render the report as a PDF and save it via the OS dialog; returns the saved
  // path, or null if the user cancels. Same caseId/runId gating as `generate`.
  [channels.investigation.report.save]: { args: [string, { runId?: string }?]; returns: string | null };

  // Invoice generator (core module) — see src/shared/invoice-types.ts.
  [channels.invoices.list]: { args: []; returns: Invoice[] };
  [channels.invoices.save]: { args: [Invoice]; returns: Invoice };
  [channels.invoices.remove]: { args: [string]; returns: void };
  [channels.invoices.duplicate]: { args: [string]; returns: Invoice };
  [channels.invoices.nextNumber]: { args: []; returns: string };
  [channels.invoices.listProfiles]: { args: []; returns: Profile[] };
  [channels.invoices.saveProfile]: { args: [Profile]; returns: Profile };
  [channels.invoices.removeProfile]: { args: [string]; returns: void };
  [channels.invoices.putAsset]: { args: [{ bytes: number[]; mime: string }]; returns: string };
  [channels.invoices.getAsset]: { args: [string]; returns: InvoiceAsset | null };
  [channels.invoices.exportPdf]: { args: [{ html: string }]; returns: string | null };
  // ^ takes prebuilt HTML (the renderer already has renderInvoiceHtml for the preview) so main never
  //   imports a renderer module. The renderer resolves asset refs → data URLs before building the HTML.
  [channels.invoices.exportDocx]: { args: [{ invoice: Invoice; assets: Record<string, string> }]; returns: string | null };
  // ^ builds an editable OOXML .docx via renderInvoiceDocx (adm-zip) — numbers foot with the PDF
  //   via calc.ts; the renderer resolves asset refs → data URLs (same map exportPdf uses).

  // Chain-of-Custody report generator — export the saved report identified by id as a PDF.
  // Unlike invoices, main resolves the report/contact/assets itself from the encrypted store (the
  // renderer never re-sends the whole document) and writes only via the OS save dialog; returns
  // the saved filename, or null if the user cancels.
  [channels.reports.exportPdf]: { args: [string]; returns: string | null };
  // Same id-in / saved-filename-out contract as exportPdf, but renders an editable OOXML .docx.
  [channels.reports.exportDocx]: { args: [string]; returns: string | null };
  // Template preview — main resolves the template + its assets from the id and returns the exact
  // buildReportHtml document the exporters use (keeps buildReportHtml main-only). The renderer drops
  // it into a sandbox="" srcdoc iframe. Empty string if the id is unknown.
  [channels.reports.previewTemplate]: { args: [string]; returns: string };

  // PDF Signer — read is a capped transient file read (path picked via files.pickOpen); sign
  // composites the signature onto one page (pdf-lib, main-side signPdf) and saves via the OS
  // dialog. `sourceName` is optional and only shapes the save dialog's default filename stem.
  [channels.pdfsign.read]: { args: [string]; returns: Uint8Array };
  [channels.pdfsign.sign]: {
    args: [{ pdfBytes: Uint8Array; signatureDataUrl: string; placement: PdfSignPlacement; sourceName?: string }];
    returns: { saved: boolean };
  };
}

export const BGCONN_LOCK_EXEMPT_CHANNELS = ['bgconn:status', 'bgconn:stop'] as const;
