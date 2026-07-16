/** Chain-of-Custody Report generator shared types. A Report is a fixed header (banner, From
 *  contact, To recipient) plus an ordered list of blocks (rich text or a captioned, resizable
 *  image). Contacts and Descriptors are separate reusable libraries. Text-block `html` is always
 *  the OUTPUT of `sanitizeReportHtml` (renderer, font-size-only style allowlist) — the main
 *  process treats it as already-safe and never re-parses it as untrusted markup beyond the
 *  bounded docx tokenizer / verbatim PDF embed. */
export interface Contact {
  id: string;
  name: string;
  title?: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  logoRef?: string;
}

export interface Descriptor { id: string; name: string; body: string }

export type ReportBlock =
  | { id: string; kind: 'text'; html: string }
  | { id: string; kind: 'image'; assetRef: string; widthPct: number; caption: string; align?: 'left' | 'center' | 'right' }
  | { id: string; kind: 'table'; cells: string[][] };

export interface Report {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bannerRef?: string;
  fromContactId?: string;
  to: string;
  reportDate?: string;
  caseNumber?: string;
  referenceNumber?: string;
  classification?: string;
  signature?: string;
  status: 'draft' | 'completed' | 'archived';
  author: string;
  blocks: ReportBlock[];
}

/** A saved report you clone. Carries the same body a report does, minus report identity/status;
 *  its assets are deep-copied on save/create so it is independent of any source report. */
export interface ReportTemplate {
  id: string;
  name: string;
  category?: string;          // free text, optional (e.g. "Chain of Custody")
  createdAt: string;
  updatedAt: string;
  // A template carries the same body a report does, minus report identity/status:
  bannerRef?: string;
  fromContactId?: string;
  to: string;
  reportDate?: string;
  caseNumber?: string;        // (from sub-project C's metadata; present on both)
  referenceNumber?: string;
  classification?: string;
  signature?: string;
  blocks: ReportBlock[];
}

/** On-disk shape (one encrypted JSON file) — libraries side by side. */
export interface ReportStoreData { reports: Report[]; contacts: Contact[]; descriptors: Descriptor[]; introductions: Descriptor[]; templates: ReportTemplate[] }

/** getAsset result — raw bytes + mime; callers (report-html/docx/IPC) build the data URI. */
export interface ReportAsset { bytes: Buffer; mime: string }
