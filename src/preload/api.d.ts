/**
 * Ambient typings for window.api. The renderer imports this so every call is typed.
 */

import type { VerifiedPluginInfo, PluginStatus, PluginBridgeApi } from '../shared/plugin-types';
import type {
  AppSettings,
  AttachmentBytesResult,
  MediaUrlResult,
  AttachmentMeta,
  AttachmentTextResult,
  BioImage,
  CaseRecord,
  CaseSummary,
  CreateCaseInput,
  EmlPreview,
  EntityRecord,
  EntityRelationship,
  ExtractedAttachmentMeta,
  JournalEntry,
  JournalEntrySummary,
  JournalEntryInput,
  Reminder,
  SearchResult,
  TaskItem,
  TimelineEvent,
  WebLink,
  Whiteboard
} from '../shared/types';
import type { EntityCreateInput, EntityLinkOpts, BioAddInput, AuthStatus, LocalAiStatus, LocalAiProgress, MemoryStatus, MemoryProgress } from '../shared/ipc-contracts';
import type {
  AiChatRequest,
  CameraStream,
  FtpConnectResult,
  FtpListing,
  MailAccount,
  MailMessage,
  MailMessageSummary,
  MailSendInput,
  MediaLibrarySnapshot,
  MediaStation,
  MediaTrack,
  Wall,
  GeoSnapshot,
  GeoSource,
  GeoSourceType,
  GeoXmlMap,
  GeoItem,
  SavedGeoEvent,
  KevEntry,
  SshHostProfile,
  BookmarkBoard,
  MarketSnapshot,
  StickyNotesState,
  AiConversation,
  AiConversationSummary,
  AiConversationInput,
  BriefcaseNote,
  BriefcaseNoteSummary,
  BriefcaseNoteInput,
  HostInfo
} from '../shared/post-mvp-types';
import type {
  SiteCatalogEntry,
  SweepResult,
  SearchlightCase,
  SearchlightCaseSummary,
} from '../shared/searchlight/types';

export interface MailDraft {
  id: string;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  attachments: { name: string; path: string; size: number }[];
  savedAt: string;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  addedAt: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
}

export interface ChatContactDTO {
  contactId: string;
  displayName: string;
  onion: string | null;
  verified: boolean;
  lastSeen: number | null;
  safetyNumber: string;
}
export interface ChatFileDTO {
  transferId: string;
  name: string;
  size: number;
  mime: string;
  status: 'transferring' | 'complete' | 'failed';
  quarantinePath?: string | null;
}
export interface ChatMessageDTO {
  id: string;
  direction: 'in' | 'out';
  seq: number;
  ts: number;
  kind?: 'text' | 'file';
  text: string;
  file?: ChatFileDTO;
  sender?: string;
  state: 'queued' | 'sent' | 'delivered' | 'received';
}
export interface ChatGroupDTO {
  groupId: string;
  name: string;
  memberIds: string[];
  creator: string;
  createdAt: number;
}

export interface GhostApi {
  cases: {
    list(): Promise<CaseSummary[]>;
    create(input: CreateCaseInput): Promise<CaseSummary>;
    read(id: string): Promise<CaseRecord>;
    rename(id: string, title: string): Promise<void>;
    update(id: string, patch: Partial<CaseRecord>): Promise<CaseRecord>;
    archive(id: string, archived: boolean): Promise<void>;
    delete(id: string): Promise<void>;
    addTimeline(id: string, ev: Omit<TimelineEvent, 'id' | 'at'>): Promise<TimelineEvent>;
    addTask(id: string, text: string, dueAt?: string): Promise<TaskItem>;
    toggleTask(id: string, taskId: string): Promise<TaskItem>;
    deleteTask(id: string, taskId: string): Promise<void>;
    addLink(id: string, url: string, title: string): Promise<WebLink>;
    deleteLink(id: string, linkId: string): Promise<void>;
    addReminder(id: string, r: Omit<Reminder, 'id' | 'fired' | 'caseId'>): Promise<Reminder>;
    deleteReminder(id: string, rid: string): Promise<void>;
    exportBundle(id: string): Promise<string | null>;
    importBundle(): Promise<{ caseId: string } | null>;
    stageEvidence(id: string): Promise<number | null>;
    exportToDesktop(id: string): Promise<string | null>;
  };
  files: {
    getPathForFile(file: File): string;
    importDropped(id: string, list: { sourcePath: string; originalName: string }[]): Promise<AttachmentMeta[]>;
    listAttachments(id: string): Promise<AttachmentMeta[]>;
    revealAttachment(id: string, name: string): Promise<void>;
    deleteAttachment(id: string, name: string): Promise<void>;
    readAttachmentText(id: string, name: string): Promise<AttachmentTextResult>;
    readAttachmentBytes(id: string, name: string, offset: number, length: number): Promise<AttachmentBytesResult>;
    readEml(id: string, name: string): Promise<EmlPreview>;
    mediaUrl(id: string, name: string): Promise<MediaUrlResult>;
    extractAttachmentMeta(id: string, name: string): Promise<ExtractedAttachmentMeta>;
    exif(id: string, name: string): Promise<{ available: boolean; tags?: Record<string, unknown> }>;
    renameAttachment(id: string, name: string, newName: string): Promise<string>;
    pickOpen(opts?: { multi?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
    pickSave(opts?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  };
  notes: {
    list(id: string): Promise<{ name: string; updatedAt: string }[]>;
    read(id: string, name: string): Promise<string>;
    write(id: string, name: string, body: string): Promise<void>;
    delete(id: string, name: string): Promise<void>;
  };
  settings: {
    read(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    pickWallpaper(): Promise<string | null>;
  };
  reminders: {
    listGlobal(): Promise<Reminder[]>;
    upsertGlobal(r: Reminder): Promise<Reminder>;
    deleteGlobal(id: string): Promise<void>;
  };
  shred: {
    list(): Promise<{ id: string; kind: 'case' | 'attachment'; label: string; deletedAt: string }[]>;
    restore(id: string): Promise<void>;
    purge(id: string): Promise<void>;
    purgeAll(): Promise<void>;
  };
  system: {
    appInfo(): Promise<{ version: string; userData: string; platform: NodeJS.Platform; secretBackend?: string }>;
    openExternal(url: string): Promise<void>;
    quit(): Promise<void>;
    onReminderFired(cb: (payload: { reminder: Reminder }) => void): () => void;
    onDiagnostic(cb: (payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[] }) => void): () => void;
  };
  chat: {
    status(): Promise<{ enabled: boolean; onion: string | null }>;
    enable(): Promise<{ onion: string | null }>;
    disable(): Promise<void>;
    createInvite(): Promise<string>;
    acceptInvite(link: string): Promise<string>;
    listContacts(): Promise<ChatContactDTO[]>;
    setVerified(contactId: string, verified: boolean): Promise<void>;
    send(contactId: string, text: string): Promise<string>;
    sendFile(contactId: string): Promise<string | null>;
    shareAttachment(contactId: string, caseId: string, fileName: string): Promise<string>;
    saveFile(contactId: string, transferId: string): Promise<string | null>;
    history(contactId: string): Promise<ChatMessageDTO[]>;
    createGroup(name: string, memberIds: string[]): Promise<string>;
    listGroups(): Promise<ChatGroupDTO[]>;
    groupHistory(groupId: string): Promise<ChatMessageDTO[]>;
    sendGroup(groupId: string, text: string): Promise<string>;
    onMessage(cb: (p: { contactId: string; message: ChatMessageDTO }) => void): () => void;
    onContactStatus(cb: (p: { contactId: string; status: 'online' | 'connecting' | 'offline' | 'needs-reinvite' }) => void): () => void;
    onDelivery(cb: (p: { contactId: string; messageId: string; state: 'sent' | 'delivered' }) => void): () => void;
    onFileStatus(cb: (p: { contactId: string; transferId: string; status: 'transferring' | 'complete' | 'failed'; progress?: { received: number; total: number } }) => void): () => void;
    onGroupMessage(cb: (p: { groupId: string; message: ChatMessageDTO }) => void): () => void;
    onGroupInvite(cb: (p: { groupId: string }) => void): () => void;
    onTorStatus(cb: (p: { status: string; onion: string | null }) => void): () => void;
  };
  tts: {
    piperStatus(): Promise<{ available: boolean }>;
    synthesize(text: string, rate?: number, voiceId?: string): Promise<Uint8Array>;
    cancel(): Promise<void>;
    listVoices(): Promise<{ id: string; name: string }[]>;
    revealVoicesFolder(): Promise<void>;
  };
  mail: {
    listAccounts(): Promise<MailAccount[]>;
    upsertAccount(input: MailAccount & { password?: string }): Promise<MailAccount>;
    deleteAccount(id: string): Promise<void>;
    testAccount(input: MailAccount & { password: string }): Promise<{ ok: true } | { ok: false; error: string }>;
    fetchInbox(id: string, limit?: number): Promise<MailMessageSummary[]>;
    fetchMessage(id: string, uid: number): Promise<MailMessage>;
    send(input: MailSendInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
    listDrafts(accountId?: string): Promise<MailDraft[]>;
    upsertDraft(input: Omit<MailDraft, 'id' | 'savedAt'> & { id?: string }): Promise<MailDraft>;
    deleteDraft(id: string): Promise<void>;
    saveAttachment(input: { filename: string; contentBase64: string }): Promise<string | null>;
    deleteMessage(id: string, uid: number): Promise<void>;
    setFlag(id: string, uid: number, flag: string, value: boolean): Promise<void>;
    printMessage(id: string, uid: number): Promise<void>;
    onNewMail(cb: (payload: { accountId: string; unseenCount: number }) => void): () => void;
  };
  browser: {
    listBookmarks(): Promise<Bookmark[]>;
    addBookmark(title: string, url: string): Promise<Bookmark>;
    deleteBookmark(id: string): Promise<void>;
    listHistory(limit?: number): Promise<HistoryEntry[]>;
    addHistory(url: string, title: string): Promise<void>;
    clearHistory(): Promise<void>;
    firefoxStatus(): Promise<{ installed: boolean; path: string | null; dir: string }>;
    launchFirefox(url: string, title?: string): Promise<void>;
    revealFirefoxDir(): Promise<string>;
  };
  voice: {
    modelStatus(): Promise<{ installed: boolean; path: string | null }>;
  };
  bookmarks: {
    get(): Promise<BookmarkBoard>;
    save(board: BookmarkBoard): Promise<void>;
    exportBoard(): Promise<string | null>;
    importBoard(): Promise<BookmarkBoard | null>;
    fetchFavicon(url: string): Promise<string | null>;
  };
  stickyNotes: {
    get(): Promise<StickyNotesState>;
    save(state: StickyNotesState): Promise<void>;
  };
  aiConvos: {
    list(): Promise<AiConversationSummary[]>;
    get(id: string): Promise<AiConversation | null>;
    save(convo: AiConversationInput): Promise<AiConversation>;
    delete(id: string): Promise<void>;
  };
  briefcase: {
    list(): Promise<BriefcaseNoteSummary[]>;
    read(id: string): Promise<BriefcaseNote | null>;
    save(note: BriefcaseNoteInput): Promise<BriefcaseNote>;
    delete(id: string): Promise<void>;
  };
  journal: {
    list(): Promise<JournalEntrySummary[]>;
    read(id: string): Promise<JournalEntry | null>;
    save(entry: JournalEntryInput): Promise<JournalEntry>;
    delete(id: string): Promise<void>;
    hasPin(): Promise<boolean>;
    setPin(pin: string): Promise<void>;
    verifyPin(pin: string): Promise<boolean>;
    changePin(oldPin: string, newPin: string): Promise<boolean>;
  };
  ssh: {
    listHosts(): Promise<SshHostProfile[]>;
    upsertHost(input: SshHostProfile & { secret?: string }): Promise<SshHostProfile>;
    deleteHost(id: string): Promise<void>;
    connect(hostId: string): Promise<{ sessionId: string }>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    disconnect(sessionId: string): Promise<void>;
    onData(cb: (payload: { sessionId: string; data: string }) => void): () => void;
    onClose(cb: (payload: { sessionId: string; reason: string }) => void): () => void;
  };
  shell: {
    /** Show a NATIVE confirmation dialog and, only on explicit user approval, enable the local
     *  shell (and optionally set the program). Returns true iff the shell is now enabled. This is
     *  the ONLY way to turn the shell on — settings.update strips the enable keys. */
    requestEnable(program?: 'cmd' | 'powershell'): Promise<boolean>;
    /** Disable the local shell (safe; no confirmation). Returns false. */
    disable(): Promise<boolean>;
    connect(program?: 'cmd' | 'powershell'): Promise<{ sessionId: string }>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    disconnect(sessionId: string): Promise<void>;
    onData(cb: (payload: { sessionId: string; data: string }) => void): () => void;
    onClose(cb: (payload: { sessionId: string; reason: string }) => void): () => void;
  };
  streams: {
    list(): Promise<CameraStream[]>;
    upsert(input: Partial<CameraStream> & { url: string; label: string; kind: CameraStream['kind'] }): Promise<CameraStream>;
    delete(id: string): Promise<void>;
    clear(): Promise<number>;
    import(stamp?: { country?: string; region?: string; city?: string }): Promise<{ added: number; skipped: number; total: number }>;
    /** Probe a user-entered camera URL to detect its StreamKind + the real media endpoint when the
     *  entered URL is an HTML viewer page. Returns null if nothing playable was found. */
    detect(url: string): Promise<{ kind: CameraStream['kind']; url: string } | null>;
    /** Export the camera library to a master CCTV JSON file (Country→Region→City→[{stream_url,
     *  coordinates?}]) via a save dialog. Returns the saved filename, or null if cancelled. */
    exportCctv(): Promise<string | null>;
  };
  satellites: {
    list(): Promise<{ id: string; name: string; noradId: number | null; line1: string; line2: string; type: string; tag?: string; notes?: string; active: boolean; addedAt: string }[]>;
    upsert(input: { id?: string; name: string; noradId: number | null; line1: string; line2: string; type: string; tag?: string; notes?: string; active: boolean }): Promise<{ id: string; name: string; noradId: number | null; line1: string; line2: string; type: string; tag?: string; notes?: string; active: boolean; addedAt: string }>;
    remove(id: string): Promise<void>;
    fetchGroup(group: string): Promise<string>;
    snapshot(): Promise<string>;
  };
  walls: {
    list(): Promise<Wall[]>;
    get(id: string): Promise<Wall | null>;
    save(wall: Partial<Wall> & { name: string; slots: (string | null)[] }): Promise<Wall>;
    delete(id: string): Promise<void>;
  };
  sounds: {
    /** The user-replaceable "You've got mail" chime as base64 (+ mime), or null to fall back to the
     *  bundled asset. */
    mailChime(): Promise<{ base64: string; mime: string } | null>;
    /** Open the user-writable sounds folder so the chime can be replaced. */
    openFolder(): Promise<void>;
  };
  media: {
    getSnapshot(): Promise<MediaLibrarySnapshot>;
    addRoot(): Promise<MediaLibrarySnapshot>;
    removeRoot(root: string): Promise<MediaLibrarySnapshot>;
    refresh(): Promise<MediaLibrarySnapshot>;
    openFiles(): Promise<MediaTrack[]>;
    loadPlaylist(): Promise<{ title: string; path?: string; url?: string }[]>;
    savePlaylist(queue: { title: string; path?: string; url?: string }[]): Promise<string | null>;
    upsertStation(input: { id?: string; label: string; url: string }): Promise<MediaStation>;
    deleteStation(id: string): Promise<void>;
  };
  geoint: {
    snapshot(): Promise<GeoSnapshot>;
    addSource(input: { label: string; url: string; type: GeoSourceType; xmlMap?: GeoXmlMap }): Promise<GeoSource>;
    updateSource(id: string, patch: Partial<GeoSource>): Promise<void>;
    removeSource(id: string): Promise<void>;
    importOpml(): Promise<number>;
    refresh(id?: string): Promise<{ fetched: number; failed: number }>;
    geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null>;
    setItemLocation(id: string, loc: { lat: number; lon: number } | null): Promise<void>;
    saveToCase(caseId: string, item: GeoItem, opts: { form: 'record' | 'link' | 'note'; entityIds?: string[] }): Promise<{ savedEventId?: string }>;
    listCaseEvents(caseId: string): Promise<SavedGeoEvent[]>;
    removeCaseEvent(caseId: string, eventId: string): Promise<void>;
    purgeCache(): Promise<void>;
    /** Fetch an on-demand, ephemeral threat layer (e.g. USGS earthquakes) as GeoItem[].
     *  Egress-gated by settings.geoint.networkEnabled — returns [] when network is off. Keyed
     *  layers (firms/gdeltcloud/ucdp) additionally return [] when no API key is stored. */
    fetchThreatLayer(
      layerId: 'usgs' | 'gdacs' | 'wartracker' | 'gdelt' | 'firms' | 'gdeltcloud' | 'ucdp' | 'reliefweb',
      opts: { feed?: string; country?: string; query?: string }
    ): Promise<GeoItem[]>;
    /** Store the API key/token for a keyed layer in the OS-encrypted secret store (never in
     *  settings.json). The key is held main-side only; the renderer never reads it back. */
    setLayerKey(layerId: 'firms' | 'gdeltcloud' | 'ucdp' | 'ais', key: string): Promise<void>;
    /** True iff a non-empty key is stored for the keyed layer. Drives the "needs key" disabled
     *  state on the layer toggle. Does NOT return the key itself. */
    hasLayerKey(layerId: 'firms' | 'gdeltcloud' | 'ucdp' | 'ais'): Promise<boolean>;
    /** Fetch the CISA Known Exploited Vulnerabilities catalog as a trimmed advisory list. KEV has
     *  no coordinates — this never touches the map. Egress-gated by settings.geoint.networkEnabled
     *  (returns [] when network is off). */
    fetchKev(): Promise<KevEntry[]>;
    /** Return the vault-persisted list of pinned monitor ids. */
    getMonitors(): Promise<string[]>;
    /** Replace the vault-persisted pinned monitor ids. */
    setMonitors(ids: string[]): Promise<void>;
    /** Add a single id to the pinned set; deduped and persisted. Returns the updated list. */
    addMonitor(id: string): Promise<string[]>;
    /** Remove a single id from the pinned set; persisted. Returns the updated list. */
    removeMonitor(id: string): Promise<string[]>;
    /** Apply (or clear) the Tor SOCKS proxy on the persist:cctv-tor partition before the
     *  renderer mounts a Tor-routed CCTV webview. `{ ok:false, reason }` when the feature is
     *  off (`DISABLED`) or Tor isn't bootstrapped (`TOR_UNAVAILABLE`) — the renderer must then
     *  refuse to load the stream rather than fall back to clearnet. */
    cctvTorStatus(opts: { enabled: boolean }): Promise<{ ok: boolean; reason?: 'DISABLED' | 'TOR_UNAVAILABLE' }>;
  };
  markets: {
    fetch(): Promise<MarketSnapshot>;
  };
  ai: {
    chatStream(streamId: string, req: AiChatRequest): Promise<void>;
    cancel(streamId: string): Promise<void>;
    setApiKey(value: string): Promise<void>;
    onChunk(cb: (payload: { streamId: string; chunk?: string; done?: boolean; error?: string }) => void): () => void;
  };
  entities: {
    listAll(): Promise<EntityRecord[]>;
    create(input: EntityCreateInput): Promise<EntityRecord>;
    update(id: string, patch: Partial<EntityCreateInput>): Promise<EntityRecord>;
    delete(id: string): Promise<void>;
    merge(keepId: string, mergeId: string): Promise<EntityRecord>;
    linkToCase(caseId: string, entityId: string, opts: EntityLinkOpts): Promise<void>;
    unlinkFromCase(caseId: string, entityId: string): Promise<void>;
    setRelationship(caseId: string, entityId: string, rel: EntityRelationship | null): Promise<void>;
    casesForEntity(entityId: string): Promise<{ caseId: string; title: string }[]>;
  };
  bioImages: {
    add(caseId: string, input: BioAddInput): Promise<BioImage>;
    delete(caseId: string, id: string): Promise<void>;
    setPrimary(caseId: string, id: string): Promise<void>;
    updateCaption(caseId: string, id: string, caption: string): Promise<void>;
    readOriginal(caseId: string, id: string): Promise<string | null>;
    reveal(caseId: string, fileName: string): Promise<void>;
  };
  export: {
    summaryHtml(caseId: string): Promise<string | null>;
    summaryPdf(caseId: string): Promise<string | null>;
    timelineCsv(caseId: string): Promise<string | null>;
    linksCsv(caseId: string): Promise<string | null>;
    entitiesCsv(caseId: string): Promise<string | null>;
    attachmentsCsv(caseId: string): Promise<string | null>;
    text(defaultName: string, content: string): Promise<string | null>;
  };
  search: {
    query(q: string): Promise<SearchResult[]>;
  };
  ftp: {
    connect(hostId: string): Promise<FtpConnectResult>;
    list(sessionId: string): Promise<FtpListing>;
    cd(sessionId: string, path: string): Promise<FtpListing>;
    download(sessionId: string, name: string): Promise<string | null>;
    upload(sessionId: string): Promise<FtpListing | null>;
    disconnect(sessionId: string): Promise<void>;
  };
  backup: {
    create(): Promise<string | null>;
    restore(): Promise<{ files: number } | null>;
  };
  whiteboard: {
    read(caseId: string): Promise<Whiteboard>;
    write(caseId: string, board: Whiteboard): Promise<void>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    setup(password: string): Promise<{ recoveryKey: string }>;
    unlock(password: string): Promise<void>;
    unlockRecovery(recoveryKey: string): Promise<void>;
    changePassword(newPassword: string): Promise<void>;
    disable(password: string): Promise<void>;
    lock(): Promise<void>;
  };
  localAi: {
    status(): Promise<LocalAiStatus>;
    setup(opts: { mode: 'online' | 'bundled' }): Promise<LocalAiStatus>;
    start(): Promise<void>;
    stop(): Promise<void>;
    onProgress(cb: (p: LocalAiProgress) => void): () => void;
  };
  memory: {
    status(): Promise<MemoryStatus>;
    reindexAll(): Promise<{ cases: number; chunks: number }>;
    onProgress(cb: (p: MemoryProgress) => void): () => void;
  };
  plugins: {
    listVerified(): Promise<VerifiedPluginInfo[]>;
    invoke(id: string, name: string, args: unknown[]): Promise<unknown>;
    status(): Promise<PluginStatus[]>;
  };
  bgconn: {
    list(): Promise<unknown[]>;
    /** Lock-exempt: live monitor summaries, callable while the vault is locked. */
    status(): Promise<Array<{ connId: string; routing: 'tor' | 'direct'; startedAt: number }>>;
    start(
      connId: string,
      params: { phone: string; routing: 'tor' | 'direct'; channelSetHash: string },
      confirmed: boolean
    ): Promise<unknown>;
    /** Lock-exempt: emergency-stop a live monitor while the vault is locked. */
    stop(connId: string): Promise<void>;
    configure(cfg: {
      idleTeardownAfterMinutes: number | null;
      defaultRouting: 'tor' | 'direct';
      maxReconnects: number;
      maxSessionAgeMinutes: number;
    }): Promise<void>;
    clearCredentials(pluginId: string, connId: string): Promise<void>;
  };
  hostinfo: {
    resolve(url: string, opts?: { force?: boolean }): Promise<HostInfo>;
  };
  livefeeds: {
    fetchAdsb(bounds: { west: number; south: number; east: number; north: number }): Promise<Array<{ id: string; callsign: string | null; lat: number; lon: number; altFt: number | null; gsKt: number | null; trackDeg: number | null; band: 'ground'|'low'|'mid'|'high' }>>;
    aisStart(bounds: { west: number; south: number; east: number; north: number }): Promise<'started' | 'no-key' | 'gate-off'>;
    aisStop(): Promise<void>;
    aisSetBbox(bounds: { west: number; south: number; east: number; north: number }): Promise<void>;
    onAisPositions(cb: (p: { positions: Array<{ id: string; name: string | null; lat: number; lon: number; sogKt: number | null; cogDeg: number | null; type: string; lastSeen: number }> }) => void): () => void;
  };
  searchlight: {
    catalog(): Promise<SiteCatalogEntry[]>;
    startSweep(req: { username: string; siteIds: string[]; useTor: boolean }): Promise<{ jobId: string; total: number }>;
    cancelSweep(jobId: string): Promise<void>;
    importSites(jsonText: string): Promise<{ added: number; rejected: number }>;
    listCases(): Promise<SearchlightCaseSummary[]>;
    saveCase(c: SearchlightCase): Promise<void>;
    loadCase(id: string): Promise<SearchlightCase | null>;
    deleteCase(id: string): Promise<void>;
    exportCase(id: string): Promise<string | null>;
    importCase(jsonText: string): Promise<SearchlightCase>;
    onSweepResult(cb: (r: SweepResult) => void): () => void;
    onSweepDone(cb: (f: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void): () => void;
    favicon(name: string): Promise<string | null>;
    addCustomSite(input: { name: string; url: string; category?: string }): Promise<{ ok: boolean; reason?: string }>;
    exportSites(): Promise<string>;
    /** Export the current sweep results as a PDF using Electron's printToPDF (dep-free).
     *  Shows a native save dialog. Returns `{ ok: false }` if the user cancels. */
    exportPdf(args: { html: string; filename: string }): Promise<{ ok: boolean }>;
  };
}

declare global {
  interface Window {
    api: GhostApi;
    /** Minimal plugin-renderer surface — listVerified + invoke only; no status/diagnostics. */
    apiPlugins: PluginBridgeApi;
  }
}

export {};
