/**
 * RFC-4180 CSV emission for case exports: UTF-8 BOM (so Excel reads non-ASCII), CRLF line
 * endings, proper quoting, and a spreadsheet formula-injection guard (a leading =,+,-,@ or
 * tab/CR can execute as a formula in Excel/Sheets, so such cells are prefixed with a quote).
 */
import type { CaseRecord } from '@shared/types';

const NEEDS_QUOTE = /[",\r\n]/;

function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // formula-injection guard
  if (NEEDS_QUOTE.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  const body = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  return '﻿' + body + '\r\n';
}

export function timelineCsv(c: CaseRecord): string {
  return toCsv([['Time', 'Kind', 'Message'], ...c.timeline.map((e) => [e.at, e.kind, e.message])]);
}

export function linksCsv(c: CaseRecord): string {
  return toCsv([['Title', 'URL', 'Added'], ...c.links.map((l) => [l.title, l.url, l.addedAt])]);
}

export function entitiesCsv(c: CaseRecord): string {
  return toCsv([
    ['Type', 'Value', 'Bucket', 'Notes', 'Linked files'],
    ...c.entities.map((e) => [e.entity.type, e.entity.value, e.relationship ?? '', e.entity.notes, e.attachmentFileNames.join('; ')])
  ]);
}

export function attachmentsCsv(c: CaseRecord): string {
  // No sha256 column — honors the operator's "no hashing as a feature" directive.
  return toCsv([
    ['Original name', 'Imported', 'Size (bytes)', 'Source path'],
    ...c.attachments.map((a) => [a.originalName, a.importedAt, a.size, a.sourcePath ?? ''])
  ]);
}
