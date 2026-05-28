/**
 * Shared types crossing the IPC boundary.
 * Imported by both main and renderer processes.
 */

export type CaseId = string;
export type ISODate = string;

export type CaseStatus = 'new' | 'open' | 'pending' | 'closed' | 'archived';
export type CasePriority = 'low' | 'medium' | 'high' | 'critical';

export interface CaseSummary {
  id: CaseId;
  title: string;
  reference: string;
  status: CaseStatus;
  priority: CasePriority;
  tags: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
  archived: boolean;
}

export interface TimelineEvent {
  id: string;
  at: ISODate;
  kind: 'created' | 'note' | 'file' | 'link' | 'reminder' | 'task' | 'status' | 'custom';
  message: string;
}

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: ISODate;
  dueAt?: ISODate;
}

export interface Reminder {
  id: string;
  caseId?: CaseId;
  title: string;
  body?: string;
  fireAt: ISODate;
  repeat?: 'none' | 'daily' | 'weekly';
  fired?: boolean;
}

export interface Alarm {
  id: string;
  label: string;
  fireAt: ISODate;
  enabled: boolean;
  repeat?: 'none' | 'daily' | 'weekly';
}

export interface WebLink {
  id: string;
  url: string;
  title: string;
  addedAt: ISODate;
}

export interface AttachmentMeta {
  fileName: string;
  originalName: string;
  importedAt: ISODate;
  size: number;
  sourcePath: string | null;
  sha256?: string;
}

/** Result of reading an attachment's text for AI context. `text` is null when the
 *  file is binary, empty, or unreadable — the reason says which. Size caps + binary
 *  detection happen in the main process; the renderer never receives binary blobs. */
export interface AttachmentTextResult {
  fileName: string;
  text: string | null;
  /** Total size on disk, bytes. */
  size: number;
  /** Bytes actually read (<= per-file cap). */
  bytesRead: number;
  /** True when the file is larger than the per-file read cap. */
  truncated: boolean;
  reason?: 'binary' | 'empty' | 'read-error';
}

/** A page of raw attachment bytes (base64) for the in-app document viewer.
 *  Path-confined + range-clamped in the main process; never persisted. */
export interface AttachmentBytesResult {
  fileName: string;
  /** base64 of the requested slice, or null on error / out-of-range. */
  base64: string | null;
  /** Total file size on disk, bytes. */
  size: number;
  /** Offset this slice started at. */
  offset: number;
  /** Bytes in this slice (decoded length). */
  length: number;
  /** True when there are more bytes past this slice. */
  hasMore: boolean;
  reason?: 'read-error' | 'out-of-range';
}

/** Inner attachment of a parsed .eml — metadata ONLY (never the bytes). */
export interface EmlAttachmentInfo {
  filename: string;
  contentType: string;
  size: number;
}

/** Parsed preview of an .eml file for the viewer. Body html is RAW — the renderer
 *  must run it through sanitizeHtml before display. Never persisted. */
export interface EmlPreview {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  headers: { key: string; value: string }[];
  text: string;
  html: string | null;
  attachments: EmlAttachmentInfo[];
}

/** Extracted, displayable metadata for an attachment (no hashing). Cached on disk
 *  next to the file as `<fileName>.extracted.json`; that cache file is skipped by
 *  listAttachmentsImpl so it never appears as a phantom attachment. */
export interface ExtractedAttachmentMeta {
  fileName: string;
  fileType: string;
  size: number;
  importedAt?: ISODate;
  modifiedAt?: ISODate;
  createdAt?: ISODate;
  originalPath?: string | null;
  /** Selected EXIF tags (images only), stringified for transport. */
  exif?: Record<string, string>;
  /** GPS coordinates if the image carried them. Stored, but the UI hides it behind
   *  an explicit "Show location" toggle (operator decision). */
  gps?: { lat: number; lon: number };
  /** Email headers (EML only). */
  emlHeaders?: { key: string; value: string }[];
}

export interface CaseRecord extends CaseSummary {
  description: string;
  notes: { name: string; updatedAt: ISODate }[];
  attachments: AttachmentMeta[];
  links: WebLink[];
  timeline: TimelineEvent[];
  tasks: TaskItem[];
  reminders: Reminder[];
}

export interface CreateCaseInput {
  title: string;
  reference?: string;
  description?: string;
  status?: CaseStatus;
  priority?: CasePriority;
  tags?: string[];
}

export interface AccessShortcut {
  id: string;
  label: string;
  /** Either a built-in module key or 'url' for a web link. */
  kind: 'module' | 'url';
  /** Module name (e.g. 'cases') for kind=module; URL string for kind=url. */
  target: string;
  icon?: string;
}

export interface AppSettings {
  soundEnabled: boolean;
  themeIntensity: 'lite' | 'classic' | 'maximum';
  /** Desktop background colour (CSS hex). Defaults to the classic Win98 teal. */
  wallpaperColor: string;
  startupSoundEnabled: boolean;
  caseFolderOverride: string | null;
  hasSeenWelcome: boolean;
  caseSortBy: 'updatedAt' | 'createdAt' | 'priority' | 'status' | 'title';
  caseSortDir: 'asc' | 'desc';
  shortcuts: AccessShortcut[];
  ai: {
    provider: 'ollama' | 'openai-compatible' | 'none';
    endpoint: string;
    model: string;
    defaultSystemPrompt: string;
    /** Reference into secrets.enc; the API key itself is never stored here. */
    apiKeyRef: string | null;
  };
  mail: {
    accounts: { id: string; label: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; user: string; secureRef: string | null }[];
  };
  browser: {
    homepage: string;
  };
}

export const defaultShortcuts: AccessShortcut[] = [
  { id: 'cases', label: 'Case Files', kind: 'module', target: 'cases', icon: 'folder' },
  { id: 'notepad', label: 'Notepad 98', kind: 'module', target: 'notepad', icon: 'note' },
  { id: 'browser', label: 'Net Explorer', kind: 'module', target: 'net-explorer', icon: 'globe' },
  { id: 'mail', label: 'Mail', kind: 'module', target: 'mail', icon: 'mail' },
  { id: 'dialterm', label: 'DialTerm', kind: 'module', target: 'dialterm', icon: 'modem' },
  { id: 'eyespy', label: 'EyeSpy', kind: 'module', target: 'eyespy', icon: 'cam' },
  { id: 'calendar', label: 'Calendar', kind: 'module', target: 'calendar', icon: 'calendar' },
  { id: 'reminders', label: 'Reminders', kind: 'module', target: 'reminders', icon: 'bell' },
  { id: 'alarm', label: 'Alarm', kind: 'module', target: 'alarm', icon: 'alarm' },
  { id: 'ai', label: 'AI Assistant', kind: 'module', target: 'ai-assistant', icon: 'sparkle' },
  { id: 'help', label: 'Help', kind: 'module', target: 'help', icon: 'help' }
  // Settings is always available via the Access menu footer ("Settings…"), so it is
  // intentionally NOT a duplicate editable shortcut here.
];

export const defaultSettings: AppSettings = {
  soundEnabled: true,
  themeIntensity: 'classic',
  wallpaperColor: '#008080',
  startupSoundEnabled: true,
  caseFolderOverride: null,
  hasSeenWelcome: false,
  caseSortBy: 'updatedAt',
  caseSortDir: 'desc',
  shortcuts: defaultShortcuts,
  ai: {
    provider: 'none',
    endpoint: 'http://localhost:11434',
    model: '',
    defaultSystemPrompt: 'You are an investigative case-management assistant. Use only the case data the user has explicitly shared. Be concise.',
    apiKeyRef: null
  },
  mail: { accounts: [] },
  browser: { homepage: 'about:blank' }
};
