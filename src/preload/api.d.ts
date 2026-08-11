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
  EntityType,
  ExtractedAttachmentMeta,
  JournalEntry,
  JournalEntrySummary,
  JournalEntryInput,
  Reminder,
  ScrapingCase,
  SearchResult,
  TaskItem,
  TimelineEvent,
  WebLink,
  Whiteboard,
  WhiteboardNode,
  WhiteboardEdge
} from '../shared/types';
import type { EntityCreateInput, EntityLinkOpts, BioAddInput, AuthStatus, LocalAiStatus, LocalAiProgress, MemoryStatus, MemoryProgress, MemoryItem, RecallPreview, LibraryDoc, MemoryGraphShape, BondShape, LearningModelMeta, ScrapingCaseStoreId, ScrapingImportResult, PdfSignPlacement } from '../shared/ipc-contracts';
import type { InvestigationScene, SceneDelta } from '../shared/investigation-graph';
import type { RunEvent } from '../shared/investigation-agent';
import type { RunBudget } from '../shared/investigation-types';
import type { IntelReport } from '../shared/investigation-report';
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
  HostInfo,
  EventSummaryResult
} from '../shared/post-mvp-types';
import type {
  SiteCatalogEntry,
  SweepResult,
  SearchlightCase,
  SearchlightCaseSummary,
} from '../shared/searchlight/types';
import type { HarvestedItem, MonitoredChannel } from '../shared/socmint/types';
import type { DocEntry, DocImportResult } from '../shared/documents-types';
import type { Invoice, Profile, InvoiceAsset } from '../shared/invoice-types';
import type { Report, Contact, Descriptor, ReportTemplate } from '../shared/reports-types';

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
  documents: {
    list(relDir: string): Promise<DocEntry[]>;
    mkdir(relDir: string, name: string): Promise<void>;
    rename(relPath: string, newName: string): Promise<void>;
    remove(relPath: string): Promise<void>;
    copy(srcRel: string, destDir: string): Promise<string>;
    move(srcRel: string, destDir: string): Promise<string>;
    importDropped(destDir: string, list: { sourcePath: string; originalName: string }[]): Promise<DocImportResult>;
    reveal(relPath: string): Promise<void>;
    export(relPath: string): Promise<void>;
    writeText(relDir: string, name: string, body: string, overwrite?: boolean): Promise<DocEntry>;
    readText(relPath: string): Promise<string>;
    readBytes(relPath: string): Promise<Uint8Array>;
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
    onChanged(cb: (s: AppSettings) => void): () => void;
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
    onDiagnostic(cb: (payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[]; scope?: string }) => void): () => void;
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
    putAsset(bytes: number[], mime: string): Promise<string>;
    getAsset(ref: string): Promise<{ mime: string; dataUrl: string } | null>;
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
    reorderStations(ids: string[]): Promise<MediaLibrarySnapshot>;
    exportStations(): Promise<string | null>;
  };
  invoices: {
    list(): Promise<Invoice[]>;
    save(invoice: Invoice): Promise<Invoice>;
    remove(id: string): Promise<void>;
    duplicate(id: string): Promise<Invoice>;
    nextNumber(): Promise<string>;
    listProfiles(): Promise<Profile[]>;
    saveProfile(profile: Profile): Promise<Profile>;
    removeProfile(id: string): Promise<void>;
    putAsset(bytes: number[], mime: string): Promise<string>;
    getAsset(ref: string): Promise<InvoiceAsset | null>;
    exportPdf(html: string): Promise<string | null>;
    exportDocx(args: { invoice: Invoice; assets: Record<string, string> }): Promise<string | null>;
  };
  reports: {
    list(): Promise<Report[]>;
    save(report: Report): Promise<Report>;
    remove(id: string): Promise<void>;
    putAsset(bytes: number[], mime: string): Promise<string>;
    /** Resolve an asset ref to a preview data URL (main converts the stored bytes). */
    getAsset(ref: string): Promise<{ mime: string; dataUrl: string } | null>;
    /** Deep-copy an asset (fresh uuid ref owning its own bytes); null if the source ref doesn't resolve. */
    copyAsset(ref: string): Promise<string | null>;
    contacts: {
      list(): Promise<Contact[]>;
      save(contact: Contact): Promise<Contact>;
      remove(id: string): Promise<void>;
    };
    descriptors: {
      list(): Promise<Descriptor[]>;
      save(descriptor: Descriptor): Promise<Descriptor>;
      remove(id: string): Promise<void>;
    };
    introductions: {
      list(): Promise<Descriptor[]>;
      save(introduction: Descriptor): Promise<Descriptor>;
      remove(id: string): Promise<void>;
    };
    templates: {
      list(): Promise<ReportTemplate[]>;
      save(template: ReportTemplate): Promise<ReportTemplate>;
      remove(id: string): Promise<void>;
    };
    /** Build a template's buildReportHtml (main-side) for the sandboxed preview iframe; '' if unknown. */
    previewTemplate(id: string): Promise<string>;
    // Main resolves the report/contact/assets itself from the id for both exporters.
    exportPdf(id: string): Promise<string | null>;
    exportDocx(id: string): Promise<string | null>;
  };
  pdfsign: {
    /** Capped transient read of a host path (picked via files.pickOpen); never written to the vault. */
    read(path: string): Promise<Uint8Array>;
    /** Overlays the signature onto the chosen page (main-side signPdf) and saves via the OS dialog;
     *  `sourceName` only shapes the save dialog's default filename stem. */
    sign(args: { pdfBytes: Uint8Array; signatureDataUrl: string; placement: PdfSignPlacement; sourceName?: string }): Promise<{ saved: boolean }>;
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
    /** Returns true when the background Tor circuit is bootstrapped and the ga98cctv:// proxy is usable. */
    cctvTorReady(): Promise<boolean>;
    /** Isolated local-Ollama summary of a single incident description (Phase 3 Intel tab). Ollama-only,
     *  no RAG/web/memory; returns {available:false, reason} when no local model / bad endpoint / call
     *  failed so the UI can degrade gracefully. */
    summarizeEvent(description: string): Promise<EventSummaryResult>;
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
    /** Export the board as a PDF (snapshot + appendix). Returns the saved file name, or null on cancel. */
    exportPdf(caseId: string, payload: { png: string; nodes: WhiteboardNode[]; edges: WhiteboardEdge[] }): Promise<string | null>;
    /** Export the board as an editable DOCX (snapshot figure + appendix). Null on cancel. */
    exportDocx(caseId: string, payload: { png: string; nodes: WhiteboardNode[]; edges: WhiteboardEdge[] }): Promise<string | null>;
    /** Export the whole board (graph + embedded assets) as a portable .gboard file. Null on cancel. */
    exportFile(caseId: string): Promise<string | null>;
    /** Import a .gboard into this case (assets re-written through the vault). Returns the new board, or null on cancel. */
    importFile(caseId: string): Promise<Whiteboard | null>;
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
    reindexAll(): Promise<{ cases: number; chunks: number; failures: { label: string; error: string }[] }>;
    onProgress(cb: (p: MemoryProgress) => void): () => void;
    /** Health of the dedicated bundled embedding runtime (loopback-only, own port). */
    embedHealth(): Promise<'ready' | 'starting' | 'unavailable' | 'model-missing'>;
    /** List every learned item, or just those in `scope` when given. */
    profileList(scope?: string): Promise<MemoryItem[]>;
    /** Read the durable per-scope rolling summaries (scope → distilled prose) so the injected
     *  summary is inspectable and erasable, not a silent invisible profile. */
    profileSummaries(): Promise<Record<string, string>>;
    /** User edit/pin (source:'user', confidence:1); returns the full post-upsert item set. */
    profileUpsert(item: Pick<MemoryItem, 'id' | 'scope' | 'text' | 'pinned'>): Promise<MemoryItem[]>;
    /** Erase specific learned items by id. */
    profileDelete(ids: string[]): Promise<void>;
    /** Erase every item in `scope`, or the entire profile when `scope` is omitted. */
    profileWipe(scope?: string): Promise<void>;
    /** Fired once per chat generation with exactly what was recalled/injected (RAG + profile). */
    onRecall(cb: (r: RecallPreview) => void): () => void;
    /** Global document library (uploads + briefcase + journal) — case-independent corpus that
     *  the memory retriever recalls from regardless of which case/conversation is active. */
    library: {
      list(): Promise<LibraryDoc[]>;
      /** Extraction (pdf/txt/md/docx → text) happens renderer-side; this persists the result. */
      add(input: { title: string; mime: string; text: string }): Promise<LibraryDoc>;
      remove(docId: string): Promise<void>;
    };
    /** Mind's Eye curation: forget a `doc`-kind node — removes it from the library AND reindexes
     *  the library shard synchronously so recall stops surfacing it right away. */
    forgetDoc(docId: string): Promise<void>;
    /** Mind's Eye curation: forget a conversation's memory — a reversible tombstone. The chat stays
     *  in the AI Assistant; it stops being indexed/recalled and its graph node disappears. */
    forgetConversation(id: string): Promise<void>;
    /** Undo forgetConversation — clears the tombstone and reindexes so the node/chunks return. */
    rememberConversation(id: string): Promise<void>;
    /** Merge a duplicate fact (`dropId`) into another (`keepId`) — unions provenance, keeps the
     *  higher confidence, drops the other. Returns the full post-merge item set. */
    mergeItems(keepId: string, dropId: string): Promise<MemoryItem[]>;
    /** The assembled Mind's Eye graph: shards + adaptive-memory profile → nodes → similarity
     *  auto-edges → deterministic clustered layout. */
    graph(): Promise<MemoryGraphShape>;
    /** Mind's Eye: user-drawn retrieval bonds — drag node-to-node to draw, click a bond edge to
     *  cut. Undirected; `add`/`remove` take the two node ids in either order. */
    bonds: {
      list(): Promise<BondShape[]>;
      add(a: string, b: string): Promise<void>;
      remove(a: string, b: string): Promise<void>;
    };
  };
  /** SP-4 investigation graph: per-case scene fetch + live delta push as evidence is appended
   *  to the SP-2 provenance ledger, plus the manual add-node/draw-edge write path (Task 7) — both
   *  append a `manual` evidence record and stream through the same delta channel. */
  investigation: {
    graph(caseId: string): Promise<InvestigationScene>;
    onGraphDelta(caseId: string, cb: (delta: SceneDelta) => void): () => void;
    addNode(caseId: string, type: EntityType, value: string): Promise<void>;
    addEdge(caseId: string, fromId: string, toId: string, relation: string): Promise<void>;
    /** SP-6 free-form orchestrator: run harness start/control + event stream. */
    run: {
      /** Capability probe: `getBrain() != null` — true once the reasoning pack is installed. */
      available(): Promise<boolean>;
      start(caseId: string, seedIds: string[], objective: string, budget: RunBudget): Promise<string>;
      pause(runId: string): Promise<void>;
      resume(runId: string): Promise<void>;
      stop(runId: string, reason: string): Promise<void>;
      addScope(runId: string, target: string): Promise<void>;
      removeScope(runId: string, target: string): Promise<void>;
      focus(runId: string, entityId: string): Promise<void>;
      ignore(runId: string, entityId: string): Promise<void>;
      answer(runId: string, text: string): Promise<void>;
      onEvent(cb: (p: { runId: string; event: RunEvent }) => void): () => void;
    };
    /** SP-7 INTELREPORT: assemble the deterministic report model for on-screen preview. */
    report: {
      generate(caseId: string, opts?: { runId?: string }): Promise<IntelReport>;
      /** Render the report as a PDF and save via the OS dialog; resolves the path or null on cancel. */
      save(caseId: string, opts?: { runId?: string }): Promise<string | null>;
    };
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
    /** Save text content (HTML/CSV/JSON/TXT report or .gic case export) via the native
     *  platform save-file dialog. Returns `{ ok: false }` if the user cancels. */
    saveReport(args: { content: string; defaultName: string }): Promise<{ ok: boolean }>;
    torStatus(): Promise<{ state: 'off' | 'connecting' | 'ready' }>;
    connectTor(): Promise<{ state: 'off' | 'connecting' | 'ready'; error?: string }>;
    /** Open the writable site-database folder in the OS file manager.
     *  Drop a corrected maigret_sites.json there to override the bundled database on next launch. */
    revealSiteDbDir(): Promise<void>;
    /** Adaptive learning: record a real(1)/not-real(0) label for a captured sweep result. */
    labelResult(payload: { resultId: string; label: 0 | 1; siteName: string; caseId: string }): Promise<{ ok: boolean }>;
    /** Current local-learning status: label count, last-train meta, and whether ML is enabled. */
    learningStatus(): Promise<{ labelCount: number; meta: LearningModelMeta | null; mlEnabled: boolean } | null>;
    /** Train the local model on the personal corpus + seed, evaluate against the heuristic, return the gate verdict. */
    trainModel(): Promise<{ verdict: { pass: boolean; reason: string }; labelCount: number }>;
    /** Enable/disable ML scoring (the operator's explicit confirm after a passing verdict). */
    setMlEnabled(enabled: boolean): Promise<{ ok: boolean }>;
  };
  socmint: {
    addChannel(caseId: string, channel: MonitoredChannel): Promise<MonitoredChannel[]>;
    removeChannel(caseId: string, channelId: string): Promise<MonitoredChannel[]>;
    listChannels(caseId: string): Promise<MonitoredChannel[]>;
    listItems(caseId: string): Promise<HarvestedItem[]>;
    rankItems(caseId: string, keyword: string): Promise<HarvestedItem[]>;
    recordLabel(caseId: string, label: { itemId: string; decision: 'accept' | 'reject'; entityCorrections?: { kind: string; value: string }[]; labeledAt: string }): Promise<void>;
    setBurner(burnerId: string, credentials: unknown): Promise<void>;
    hasBurner(burnerId: string): Promise<boolean>;
    startMonitor(req: unknown): Promise<{ disabled: true } | { started: true; jobId: string } | { noChannels: true }>;
    stopMonitor(jobId: string): Promise<void>;
    // WhatsApp linking ceremony (WA-T5 contracts; bodies implemented in WA-T6/T7;
    // register.ts wiring in WA-T10 after operator smoke-test).
    /** Egress-gated. Returns { disabled:true } when gate closed; { pairingCode } when gate
     *  open + library installed; throws sealed message before WA-T9/WA-T10. */
    setWhatsappBurnerPairingCode(burnerId: string, phone: string): Promise<{ disabled: true } | { pairingCode: string }>;
    /** Boolean only — never echoes the stored secret value. */
    hasWhatsappBurner(burnerId: string): Promise<boolean>;
    /** Deletes secretStore entries for burnerId. User must separately unlink in WhatsApp. */
    unlinkWhatsappBurner(burnerId: string): Promise<void>;
    /**
     * Telegram Hunter capture-window engine (TG5) — replaces the retired mtcute streaming
     * collector. Pull-based visible-DOM capture inside a Tor-fail-closed hardened window.
     */
    telegram: {
      /** Open (or resurface) the Tor-proxied capture window; blocked when Tor is not ready. */
      connect(): Promise<{ opened: true } | { blocked: true; reason: string }>;
      /** Capture the visible messages in the open chat → encrypted case store. */
      capture(req: { caseId: string; channelId: string; channelLabel?: string; jobId?: string }): Promise<{
        blocked: boolean; reason?: string; added: number; skipped: number; items: HarvestedItem[];
      }>;
      /** Capture the visible group/channel members (no fabricated total). */
      captureMembers(req: { caseId: string }): Promise<{
        blocked: boolean; reason?: string; added: number; captured: number; members: unknown[];
      }>;
      /** Capture the visible user-profile panel (no fabricated account-creation date). */
      captureProfile(req: { caseId: string }): Promise<{
        blocked: boolean; reason?: string; added: number; captured: number; profiles: unknown[];
      }>;
      /** Export a captured Telegram collection (messages/members/profiles) as JSON,
       *  formula-guarded CSV, or an HTML-escaped report. `collection` defaults to messages. */
      exportItems(req: {
        caseId: string;
        format: 'json' | 'csv' | 'html';
        collection?: 'messages' | 'members' | 'profiles';
      }): Promise<{
        format: 'json' | 'csv' | 'html';
        collection: 'messages' | 'members' | 'profiles';
        count: number;
        encoding: 'utf8';
        data: string;
        mime: string;
      }>;
      /** Import an operator-picked Telegram Desktop JSON export (LFI-guarded parse) into the
       *  encrypted per-case imports store. `canceled` when the file picker was dismissed. */
      importExport(req: { caseId: string }): Promise<{
        canceled: boolean;
        name?: string;
        itemCount?: number;
        setCount?: number;
      }>;
      /** Persist literal keyword-watch terms (no RegExp on input) and scan the case's captured
       *  Telegram messages for matches. Returns the full term set + scanned/matched counts + a
       *  bounded, visible-fields-only preview. */
      keywordScan(req: { caseId: string; terms?: string[] }): Promise<{
        rules: Array<{ term: string; addedAt: string; caseSensitive?: boolean; exactPhrase?: boolean }>;
        scanned: number;
        matched: number;
        matches: Array<{ text: string; authorHandle: string; channelLabel: string; terms: string[] }>;
      }>;
    };
  };
  /**
   * X Listening Station (Plan A) — visible-DOM capture of an authenticated X session, run
   * main-side in a hardened BrowserWindow on the clearnet-quarantined `persist:x-listening`
   * partition (no Tor/socks — clearnet). Retires the `x` + `ghostscrape` namespaces (Task R1).
   *
   * X1 exposes the connect/status shell only; capture/notes/network/archive/export methods are
   * added by Tasks X2–X8. No credential ever crosses this surface — status() derives a boolean
   * from the auth-cookie presence and never returns, echoes, or logs the token.
   */
  xListening: {
    /** Open (or reopen) the hardened X login window on the clearnet partition. */
    connect(): Promise<{ opened: boolean }>;
    /** Session connectivity as a derived boolean — never the auth token itself. */
    status(): Promise<{ connected: boolean }>;
    /**
     * Capture the visible X timeline in the connect window → normalized, honesty-stamped
     * HarvestedItems in the encrypted case store. Refuses on a verification/rate-limit page
     * (`blocked:true`, nothing captured); `harvestedAt`/collector version are stamped main-side.
     */
    capture(req: {
      caseId: string;
      jobId?: string;
      channelId: string;
      channelLabel?: string;
    }): Promise<{
      blocked: boolean;
      reason?: string;
      added: number;
      skipped: number;
      items: HarvestedItem[];
    }>;
    /**
     * Capture the THIRD-PARTY comments under one of the target's root posts → normalized,
     * honesty-stamped HarvestedItems (`kind:'comment'`) in the encrypted case store. Gated
     * MAIN-side on `AppSettings.xListening.collect.comments` (off ⇒ nothing captured, the
     * window is never navigated). The root URL is scheme/host guarded before any navigation;
     * refuses on a verification/rate-limit page (`blocked:true`).
     */
    captureThreadComments(req: {
      caseId: string;
      jobId?: string;
      channelId: string;
      channelLabel?: string;
      rootPostId: string;
      rootPostUrl: string;
    }): Promise<{
      blocked: boolean;
      reason?: string;
      added: number;
      skipped: number;
      items: HarvestedItem[];
    }>;
    /**
     * Capture the target's visible FOLLOWERS from the followers surface → the ACTUAL
     * visible accounts (never a scraped count-number) in the encrypted `networks`
     * artifact store. Refuses on a verification/rate-limit page (`blocked:true`).
     */
    captureFollowers(req: { caseId: string; jobId?: string; target: string }): Promise<{
      blocked: boolean;
      reason?: string;
      target: string;
      kind: 'followers' | 'following';
      accounts: Array<{ handle: string; displayName: string; avatar?: string; bio?: string }>;
    }>;
    /** Capture the accounts the target is FOLLOWING. Same honesty guarantees as `captureFollowers`. */
    captureFollowing(req: { caseId: string; jobId?: string; target: string }): Promise<{
      blocked: boolean;
      reason?: string;
      target: string;
      kind: 'followers' | 'following';
      accounts: Array<{ handle: string; displayName: string; avatar?: string; bio?: string }>;
    }>;
    /** Serialize the case's captured networks to a formula-guarded CSV string. */
    exportNetwork(caseId: string): Promise<{ csv: string; count: number }>;
    /**
     * Upsert one analyst note against a finding (one note per finding — a re-save
     * REPLACES it). Text is trimmed + validated (non-empty, ≤ 20 000 chars) and
     * `savedAt` is stamped MAIN-side. Returns the fresh note list.
     */
    saveNote(req: { caseId: string; findingId: string; text: string }): Promise<{
      notes: Array<{ findingId: string; text: string; savedAt: string }>;
    }>;
    /** Read the case's analyst notes from the encrypted `notes` store. */
    readNotes(caseId: string): Promise<{
      notes: Array<{ findingId: string; text: string; savedAt: string }>;
    }>;
    /**
     * Serialize the case's captured items to `json`/`csv`/`pdf`/`docx` via the app's
     * EXISTING exporters (no new docx/pdfkit). Every scraped field is escaped /
     * formula-guarded; rounded metrics are exported verbatim (never a false-precision
     * integer); remote media URLs are never emitted. `data` is utf8 for json/csv and
     * base64 for pdf/docx; the caller decodes + saves via the app's file-save flow.
     */
    exportItems(req: { caseId: string; format: 'json' | 'csv' | 'pdf' | 'docx' }): Promise<{
      format: 'json' | 'csv' | 'pdf' | 'docx';
      count: number;
      encoding: 'utf8' | 'base64';
      data: string;
      mime: string;
      suggestedName: string;
    }>;
    /**
     * Run ONE bounded, low-rate archive cycle over the target's timeline. Gated MAIN-side on
     * `AppSettings.xListening.archiveCycles` (fail-closed OFF ⇒ `ran:false`, no capture, state
     * untouched). On a completed run the resumable state advances (cycle count + cursor +
     * main-side clock); a challenge-blocked cycle does NOT advance state.
     */
    runArchiveCycle(req: {
      caseId: string;
      jobId?: string;
      channelId: string;
      channelLabel?: string;
    }): Promise<{
      ran: boolean;
      blocked: boolean;
      reason?: string;
      added: number;
      skipped: number;
      items: HarvestedItem[];
      state: { cursor: string | null; cycles: number; lastRunAt: string | null };
    }>;
    /**
     * Run a BOUNDED, cancellable sequence of low-rate archive cycles. Stops the instant a cycle
     * does not complete (toggle turned off / challenge-blocked). `maxCycles` is clamped to
     * [0, 1000] main-side; a low-rate delay sits between cycles.
     */
    runArchiveCycles(req: {
      caseId: string;
      jobId?: string;
      channelId: string;
      channelLabel?: string;
      maxCycles?: number;
      delayMs?: number;
    }): Promise<{
      cyclesRun: number;
      totalAdded: number;
      blocked: boolean;
      reason?: string;
      cancelled: boolean;
      /** Every completed cycle's captured records, in run order — surfaced in the LIVE FEED
       *  just like a single RUN ONE CYCLE. */
      items: HarvestedItem[];
      state: { cursor: string | null; cycles: number; lastRunAt: string | null };
    }>;

    // ---- Phase-1 Enterprise-port surface (plan Task 6) --------------------------------
    // A DIFFERENT trust/network model than `connect`/`status`/`capture` above (caseId-scoped
    // sessions, Tor by default, self-managed x-namespace campaigns) — see ipc-contracts.ts.
    /** Open (or reuse) the Tor-default capture window for one campaign. Fails closed
     *  (`blocked:true`) when Tor isn't bootstrapped and clearnet isn't opted in. */
    openSession(caseId: string): Promise<{ blocked: boolean; reason?: string }>;
    /** Derived session/window state for one campaign — `connected` is the shared partition's
     *  auth-cookie presence; `windowOpen` is whether THIS campaign has a live capture window. */
    sessionStatus(caseId: string): Promise<{ connected: boolean; windowOpen: boolean }>;
    /** Close (not log out of) one campaign's live capture window. */
    closeSession(caseId: string): Promise<{ cleared: boolean }>;
    /**
     * Capture the ALREADY-VISIBLE X profile timeline in a campaign's open capture window — the
     * analyst navigates the visible window to the target manually; this captures whatever page
     * is currently loaded. `metrics` AND the verbatim `metricsRaw` are both kept and folded into
     * each post's `evidenceHash` (the honesty fix over Enterprise, which omits metrics).
     */
    captureTimeline(req: {
      caseId: string;
      jobId?: string;
      channelId: string;
      channelLabel?: string;
      targetUsername: string;
    }): Promise<{
      blocked: boolean;
      reason?: string;
      added: number;
      skipped: number;
      posts: Array<Record<string, unknown>>;
    }>;
    /** List every self-managed X campaign (x-namespace scraping case) — no core investigation
     *  case need be bound. */
    campaignsList(): Promise<ScrapingCase[]>;
    /** Create a new campaign. */
    campaignsCreate(name: string): Promise<ScrapingCase>;
    /** Look up (and thereby validate) an existing campaign by id. */
    campaignsSwitch(id: string): Promise<ScrapingCase>;
    /** Rename a campaign. */
    campaignsUpdate(req: { id: string; name: string }): Promise<ScrapingCase>;
    /** Delete a campaign — removes its entire on-disk directory recursively. */
    campaignsDelete(id: string): Promise<void>;
    /** Derived, on-read common-connection network analysis over a case's captured `networks`
     *  artifacts — not persisted; synthetic/demo rows excluded. */
    analysis(caseId: string): Promise<Record<string, unknown>>;
    /** Derived collection-health rollup — currently always empty (no run-log persisted yet). */
    health(caseId: string): Promise<Array<Record<string, unknown>>>;
    /** Derived entity rollup (mention/hashtag/email/url/domain/crypto/phone/org) over a case's
     *  captured posts — recomputed on every call; synthetic/demo posts excluded. */
    entities(caseId: string): Promise<Array<Record<string, unknown>>>;
    /** Read a case's saved highlight presets. */
    presetsRead(caseId: string): Promise<{
      presets: Array<{
        id: string;
        name: string;
        keywords: string[];
        mode: 'any' | 'all';
        caseSensitive: boolean;
        profileIds: string[];
        enabled: boolean;
        updatedAt: string;
      }>;
    }>;
    /** Upsert one highlight preset (keyed by id); `updatedAt` is stamped MAIN-side. */
    presetsSave(req: {
      caseId: string;
      id: string;
      name: string;
      keywords: string[];
      mode?: 'any' | 'all';
      caseSensitive?: boolean;
      profileIds?: string[];
      enabled?: boolean;
    }): Promise<{
      presets: Array<{
        id: string;
        name: string;
        keywords: string[];
        mode: 'any' | 'all';
        caseSensitive: boolean;
        profileIds: string[];
        enabled: boolean;
        updatedAt: string;
      }>;
    }>;
  };
  /**
   * Scraping cases (W4) — the isolated per-namespace SOCMINT/X collection-run stores, kept
   * apart from `cases` (investigation cases). Every call passes a `store: 'socmint' | 'x'`
   * discriminator validated main-side against an allowlist. `saveArtifact` writes a saved
   * export (e.g. an X Listening JSON export) into the scraping case, encrypted at rest.
   */
  scrapingCases: {
    list(store: ScrapingCaseStoreId): Promise<ScrapingCase[]>;
    create(store: ScrapingCaseStoreId, name: string): Promise<ScrapingCase>;
    rename(store: ScrapingCaseStoreId, id: string, name: string): Promise<ScrapingCase>;
    remove(store: ScrapingCaseStoreId, id: string): Promise<void>;
    importToCase(store: ScrapingCaseStoreId, scrapingCaseId: string, mainCaseId: string): Promise<ScrapingImportResult>;
    saveArtifact(store: ScrapingCaseStoreId, scrapingCaseId: string, name: string, content: string): Promise<string>;
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
