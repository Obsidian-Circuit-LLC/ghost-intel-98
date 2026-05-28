/**
 * Storage abstraction. JSON-on-disk today; SQLite-swap tomorrow.
 * Every module above this layer talks only to these interfaces.
 */

import type {
  AppSettings,
  AttachmentMeta,
  AttachmentTextResult,
  CaseId,
  CaseRecord,
  CaseSummary,
  CreateCaseInput,
  Reminder,
  TimelineEvent,
  TaskItem,
  WebLink
} from '@shared/types';

export interface CaseStore {
  list(): Promise<CaseSummary[]>;
  create(input: CreateCaseInput): Promise<CaseSummary>;
  read(id: CaseId): Promise<CaseRecord>;
  update(id: CaseId, patch: Partial<CaseRecord>): Promise<CaseRecord>;
  rename(id: CaseId, title: string): Promise<void>;
  archive(id: CaseId, archived: boolean): Promise<void>;
  softDelete(id: CaseId): Promise<void>;
  addTimeline(id: CaseId, ev: Omit<TimelineEvent, 'id' | 'at'>): Promise<TimelineEvent>;
  addTask(id: CaseId, text: string, dueAt?: string): Promise<TaskItem>;
  toggleTask(id: CaseId, taskId: string): Promise<TaskItem>;
  deleteTask(id: CaseId, taskId: string): Promise<void>;
  addLink(id: CaseId, url: string, title: string): Promise<WebLink>;
  deleteLink(id: CaseId, linkId: string): Promise<void>;
  addReminder(id: CaseId, r: Omit<Reminder, 'id' | 'fired' | 'caseId'>): Promise<Reminder>;
  deleteReminder(id: CaseId, reminderId: string): Promise<void>;
}

export interface FileStore {
  importDropped(id: CaseId, files: { sourcePath: string; originalName: string }[]): Promise<AttachmentMeta[]>;
  listAttachments(id: CaseId): Promise<AttachmentMeta[]>;
  deleteAttachment(id: CaseId, fileName: string): Promise<void>;
  attachmentAbsolutePath(id: CaseId, fileName: string): string;
  /** Read up to a per-file byte cap of an attachment as UTF-8 text, for AI context.
   *  Returns text:null for binary / empty / unreadable files (never ships binary). */
  readAttachmentText(id: CaseId, fileName: string): Promise<AttachmentTextResult>;
}

export interface NoteStore {
  list(id: CaseId): Promise<{ name: string; updatedAt: string }[]>;
  read(id: CaseId, name: string): Promise<string>;
  write(id: CaseId, name: string, body: string): Promise<void>;
  delete(id: CaseId, name: string): Promise<void>;
}

export interface SettingsStore {
  read(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export interface ReminderStore {
  listGlobal(): Promise<Reminder[]>;
  upsertGlobal(r: Reminder): Promise<Reminder>;
  deleteGlobal(id: string): Promise<void>;
  /** Returns all due reminders (case + global) whose fireAt has passed and that haven't fired. */
  drainDue(now: Date): Promise<Reminder[]>;
}

export interface ShredStore {
  list(): Promise<{ id: string; kind: 'case' | 'attachment'; label: string; deletedAt: string }[]>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  purgeAll(): Promise<void>;
}

export interface SecretStore {
  /** Returns null if no value exists. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
