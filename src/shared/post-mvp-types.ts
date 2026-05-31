/**
 * Types added for the v1.0.0 modules (Mail / DialTerm / EyeSpy / AI Assistant).
 * Kept in a separate file so the v0.1.0 surface stays grokable.
 */

import type { CaseId } from './types';

// ---------- Mail ----------

export interface MailAccount {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  /** Reference into secrets.enc for the IMAP/SMTP password. Never the password itself. */
  passwordRef: string;
}

export interface MailMessageSummary {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  preview: string;
  unseen: boolean;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** Base64-encoded content. Only populated on demand for inbound mail. */
  contentBase64?: string;
}

export interface MailMessage extends MailMessageSummary {
  body: string;
  html?: string;
  attachments: MailAttachment[];
}

export interface MailSendAttachment {
  /** Absolute path on disk to attach. */
  path: string;
  /** Optional override filename — defaults to basename(path). */
  filename?: string;
}

export interface MailSendInput {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  attachments?: MailSendAttachment[];
}

// ---------- DialTerm (SSH) ----------

export type SshAuthKind = 'password' | 'key';

/** DialTerm transport. 'ssh' + 'telnet' are terminal sessions; 'ftp' opens a file browser. */
export type DialTermProtocol = 'ssh' | 'telnet' | 'ftp';

export interface SshHostProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authKind: SshAuthKind;
  /** Absolute path to a private key file on disk. Empty for password auth. */
  keyPath: string;
  /** Reference into secrets.enc for password OR key passphrase. Never the secret itself. */
  secretRef: string;
  /** Transport. Optional for backward-compat — legacy profiles without it are treated as 'ssh'. */
  protocol?: DialTermProtocol;
}

export interface SshConnectResult {
  sessionId: string;
}

export interface FtpEntry {
  name: string;
  type: 'file' | 'dir' | 'link' | 'other';
  size: number;
  modifiedAt?: string;
}

export interface FtpListing {
  cwd: string;
  entries: FtpEntry[];
}

export interface FtpConnectResult extends FtpListing {
  sessionId: string;
}

// ---------- EyeSpy ----------

export type StreamKind = 'hls' | 'mjpeg' | 'rtsp' | 'http' | 'mp4';

export interface CameraStream {
  id: string;
  label: string;
  url: string;
  kind: StreamKind;
  caseId: CaseId | null;
  addedAt: string;
  notes: string;
}

// ---------- Jukebox (media player) ----------

export interface MediaTrack {
  /** Absolute path on disk. Served only via ga98media:// after authorization. */
  path: string;
  /** fs mtimeMs at index time (used to skip re-parsing unchanged files). */
  mtime: number;
  size: number;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  /** Filename of cached cover art under media-art/, if the file had embedded art. */
  artRef?: string;
}

export interface MediaStation {
  id: string;
  label: string;
  url: string;
}

export interface MediaLibrarySnapshot {
  roots: string[];
  tracks: MediaTrack[];
  stations: MediaStation[];
}

// ---------- GeoINT ----------

export type GeoSourceType = 'rss' | 'atom' | 'geojson';

export interface GeoSource {
  id: string;
  label: string;
  url: string;
  type: GeoSourceType;
  enabled: boolean;
  lastFetched?: string;
  lastError?: string;
}

export interface GeoItem {
  id: string;
  sourceId: string;
  title: string;
  link?: string;
  summary?: string;
  published?: string;
  lat?: number;
  lon?: number;
  /** Matched gazetteer place name when located:'gazetteer' (drives the auto location-entity). */
  place?: string;
  /** How this item got its coordinates (if any). */
  located: 'geo' | 'gazetteer' | 'manual' | 'none';
}

export interface GeoSnapshot {
  sources: GeoSource[];
  items: GeoItem[];
}

export interface SavedGeoEvent extends GeoItem {
  /** When this event was saved into a case (ISO). */
  savedAt: string;
}

// ---------- AI Assistant ----------

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  /** Concatenated context to prepend (typically: selected case bundle). */
  context?: string;
  messages: AiChatMessage[];
}
