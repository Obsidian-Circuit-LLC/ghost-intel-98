/** Encrypted report store (mirrors invoices/store.ts). Three libraries — reports/contacts/
 *  descriptors — in one JSON file; image assets (banners/logos/photos) as individual encrypted
 *  blobs under report-assets/, filename `<uuid>.<ext>` (ext carries the mime). */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Report, Contact, Descriptor, ReportTemplate, ReportStoreData, ReportAsset } from '@shared/reports-types';
import { secureReadText, secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { dataRoot } from '../storage/paths';
import { ensureFileName } from '../security/validate';

const file = (): string => join(dataRoot(), 'reports.json');
const assetsDir = (): string => join(dataRoot(), 'report-assets');

// Per-library cap, mirroring ai-conversations.ts's MAX_CONVOS drop-oldest pattern — a save
// beyond the cap evicts the oldest record rather than growing the vault file unbounded.
const MAX_REPORTS = 500;
const MAX_CONTACTS = 500;
const MAX_DESCRIPTORS = 500;
const MAX_INTRODUCTIONS = 500;
const MAX_TEMPLATES = 500;

async function read(): Promise<ReportStoreData> {
  // Build a fresh object with fresh arrays — never spread a shared EMPTY const, or a JSON blob
  // that lacks a field would alias that const's array and later writes would mutate it.
  try {
    const p = JSON.parse(await secureReadText(file())) as Partial<ReportStoreData>;
    return { reports: p.reports ?? [], contacts: p.contacts ?? [], descriptors: p.descriptors ?? [], introductions: p.introductions ?? [], templates: p.templates ?? [] };
  } catch { return { reports: [], contacts: [], descriptors: [], introductions: [], templates: [] }; }
}
async function write(d: ReportStoreData): Promise<void> { await secureWriteFile(file(), JSON.stringify(d, null, 2)); }

export async function _resetForTest(): Promise<void> { await write({ reports: [], contacts: [], descriptors: [], introductions: [], templates: [] }); }

export async function listReports(): Promise<Report[]> { return (await read()).reports; }
export async function saveReport(r: Report): Promise<Report> {
  const d = await read();
  const i = d.reports.findIndex((x) => x.id === r.id);
  if (i >= 0) d.reports[i] = r; else d.reports.push(r);
  if (d.reports.length > MAX_REPORTS) d.reports = d.reports.slice(d.reports.length - MAX_REPORTS);
  await write(d); return r;
}
export async function removeReport(id: string): Promise<void> {
  const d = await read(); d.reports = d.reports.filter((x) => x.id !== id); await write(d);
}

export async function listContacts(): Promise<Contact[]> { return (await read()).contacts; }
export async function saveContact(c: Contact): Promise<Contact> {
  const d = await read();
  const i = d.contacts.findIndex((x) => x.id === c.id);
  if (i >= 0) d.contacts[i] = c; else d.contacts.push(c);
  if (d.contacts.length > MAX_CONTACTS) d.contacts = d.contacts.slice(d.contacts.length - MAX_CONTACTS);
  await write(d); return c;
}
export async function removeContact(id: string): Promise<void> {
  const d = await read(); d.contacts = d.contacts.filter((x) => x.id !== id); await write(d);
}

export async function listDescriptors(): Promise<Descriptor[]> { return (await read()).descriptors; }
export async function saveDescriptor(desc: Descriptor): Promise<Descriptor> {
  const d = await read();
  const i = d.descriptors.findIndex((x) => x.id === desc.id);
  if (i >= 0) d.descriptors[i] = desc; else d.descriptors.push(desc);
  if (d.descriptors.length > MAX_DESCRIPTORS) d.descriptors = d.descriptors.slice(d.descriptors.length - MAX_DESCRIPTORS);
  await write(d); return desc;
}
export async function removeDescriptor(id: string): Promise<void> {
  const d = await read(); d.descriptors = d.descriptors.filter((x) => x.id !== id); await write(d);
}

export async function listIntroductions(): Promise<Descriptor[]> { return (await read()).introductions; }
export async function saveIntroduction(desc: Descriptor): Promise<Descriptor> {
  const d = await read();
  const i = d.introductions.findIndex((x) => x.id === desc.id);
  if (i >= 0) d.introductions[i] = desc; else d.introductions.push(desc);
  if (d.introductions.length > MAX_INTRODUCTIONS) d.introductions = d.introductions.slice(d.introductions.length - MAX_INTRODUCTIONS);
  await write(d); return desc;
}
export async function removeIntroduction(id: string): Promise<void> {
  const d = await read(); d.introductions = d.introductions.filter((x) => x.id !== id); await write(d);
}

export async function listTemplates(): Promise<ReportTemplate[]> { return (await read()).templates; }
export async function saveTemplate(t: ReportTemplate): Promise<ReportTemplate> {
  const d = await read();
  const i = d.templates.findIndex((x) => x.id === t.id);
  if (i >= 0) d.templates[i] = t; else d.templates.push(t);
  if (d.templates.length > MAX_TEMPLATES) d.templates = d.templates.slice(d.templates.length - MAX_TEMPLATES);
  await write(d); return t;
}
export async function removeTemplate(id: string): Promise<void> {
  const d = await read(); d.templates = d.templates.filter((x) => x.id !== id); await write(d);
}

function extFor(mime: string): string { return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'bin'; }
function mimeFor(ref: string): string { return ref.endsWith('.png') ? 'image/png' : ref.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'; }

export async function putAsset(bytes: Buffer, mime: string): Promise<string> {
  await mkdir(assetsDir(), { recursive: true });
  const ref = `${randomUUID()}.${extFor(mime)}`;
  await secureWriteFile(join(assetsDir(), ref), bytes);
  return ref;
}
export async function getAsset(ref: string): Promise<ReportAsset | null> {
  // Defense-in-depth: the IPC boundary already gates `ref` with ensureFileName, but this is a
  // renderer-reachable read primitive — re-validate here so a traversal ref ('../reports.json',
  // '../../../../etc/passwd', NUL) can never reach secureReadFile and exfiltrate a decrypted vault
  // file or any host file the main process can read. Rejects rather than silently reading.
  ensureFileName(ref, 'assetRef');
  try {
    const bytes = await secureReadFile(join(assetsDir(), ref));
    return { bytes, mime: mimeFor(ref) };
  } catch { return null; }
}

/** Deep-copy an asset so a template owns its own bytes: a template's ref survives deletion of the
 *  source report's asset (and vice-versa). Returns null when the source ref doesn't resolve. */
export async function copyAsset(ref: string): Promise<string | null> {
  const a = await getAsset(ref);          // re-validates ref (ensureFileName) internally
  if (!a) return null;
  return putAsset(a.bytes, a.mime);        // fresh uuid ref owning its own bytes
}
