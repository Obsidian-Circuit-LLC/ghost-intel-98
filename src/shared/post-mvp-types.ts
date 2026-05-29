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
