/**
 * Ambient typings for window.api. The renderer imports this so every call is typed.
 */

import type {
  AppSettings,
  AttachmentBytesResult,
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
  Reminder,
  SearchResult,
  TaskItem,
  TimelineEvent,
  WebLink
} from '../shared/types';
import type { EntityCreateInput, EntityLinkOpts, BioAddInput } from '../shared/ipc-contracts';
import type {
  AiChatRequest,
  CameraStream,
  FtpConnectResult,
  FtpListing,
  MailAccount,
  MailMessage,
  MailMessageSummary,
  MailSendInput,
  SshHostProfile
} from '../shared/post-mvp-types';

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
    extractAttachmentMeta(id: string, name: string): Promise<ExtractedAttachmentMeta>;
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
    onReminderFired(cb: (payload: { reminder: Reminder }) => void): () => void;
    onDiagnostic(cb: (payload: { kind: string; message?: string; cases?: { caseId: string; reason: string }[] }) => void): () => void;
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
  };
  browser: {
    listBookmarks(): Promise<Bookmark[]>;
    addBookmark(title: string, url: string): Promise<Bookmark>;
    deleteBookmark(id: string): Promise<void>;
    listHistory(limit?: number): Promise<HistoryEntry[]>;
    addHistory(url: string, title: string): Promise<void>;
    clearHistory(): Promise<void>;
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
  streams: {
    list(): Promise<CameraStream[]>;
    upsert(input: Partial<CameraStream> & { url: string; label: string; kind: CameraStream['kind'] }): Promise<CameraStream>;
    delete(id: string): Promise<void>;
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
}

declare global {
  interface Window {
    api: GhostApi;
  }
}

export {};
