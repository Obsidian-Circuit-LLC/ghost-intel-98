/** Encrypted invoice store (mirrors media/library.ts). Records in one JSON file; image assets as
 *  individual encrypted blobs under invoice-assets/, filename `<uuid>.<ext>` (ext carries the mime). */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Invoice, Profile, InvoiceStoreData, InvoiceAsset } from '@shared/invoice-types';
import { secureReadText, secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { dataRoot } from '../storage/paths';

const EMPTY: InvoiceStoreData = { invoices: [], profiles: [], seq: 0 };
const file = (): string => join(dataRoot(), 'invoices.json');
const assetsDir = (): string => join(dataRoot(), 'invoice-assets');

async function read(): Promise<InvoiceStoreData> {
  try { return { ...EMPTY, ...(JSON.parse(await secureReadText(file())) as Partial<InvoiceStoreData>) }; }
  catch { return { ...EMPTY, invoices: [], profiles: [] }; }
}
async function write(d: InvoiceStoreData): Promise<void> { await secureWriteFile(file(), JSON.stringify(d, null, 2)); }

export async function _resetForTest(): Promise<void> { await write({ invoices: [], profiles: [], seq: 0 }); }

export async function listInvoices(): Promise<Invoice[]> { return (await read()).invoices; }
export async function saveInvoice(inv: Invoice): Promise<Invoice> {
  const d = await read();
  const i = d.invoices.findIndex((x) => x.id === inv.id);
  if (i >= 0) d.invoices[i] = inv; else d.invoices.push(inv);
  await write(d); return inv;
}
export async function removeInvoice(id: string): Promise<void> {
  const d = await read(); d.invoices = d.invoices.filter((x) => x.id !== id); await write(d);
}

// Numbers are also assignable out-of-band (e.g. an imported/duplicated invoice carries a caller-
// supplied number before ever going through nextInvoiceNumber()). Deriving the next value from
// max(seq, highest existing invoice number) — not seq alone — keeps freshly-issued numbers from
// colliding with numbers already present on disk.
function bumpSeq(d: InvoiceStoreData): number {
  const highest = d.invoices.reduce((m, x) => Math.max(m, Number.parseInt(x.number, 10) || 0), 0);
  d.seq = Math.max(d.seq, highest) + 1;
  return d.seq;
}

export async function nextInvoiceNumber(): Promise<string> {
  const d = await read(); const n = bumpSeq(d); await write(d); return String(n).padStart(4, '0');
}
export async function duplicateInvoice(id: string): Promise<Invoice> {
  const d = await read();
  const src = d.invoices.find((x) => x.id === id);
  if (!src) throw new Error('invoice not found');
  const n = bumpSeq(d);
  const dup: Invoice = { ...structuredClone(src), id: randomUUID(), number: String(n).padStart(4, '0') };
  d.invoices.push(dup); await write(d); return dup;
}
export async function listProfiles(): Promise<Profile[]> { return (await read()).profiles; }
export async function saveProfile(p: Profile): Promise<Profile> {
  const d = await read();
  const i = d.profiles.findIndex((x) => x.id === p.id);
  if (i >= 0) d.profiles[i] = p; else d.profiles.push(p);
  await write(d); return p;
}
export async function removeProfile(id: string): Promise<void> {
  const d = await read(); d.profiles = d.profiles.filter((x) => x.id !== id); await write(d);
}

function extFor(mime: string): string { return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'bin'; }
function mimeFor(ref: string): string { return ref.endsWith('.png') ? 'image/png' : ref.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'; }

export async function putAsset(bytes: Buffer, mime: string): Promise<string> {
  await mkdir(assetsDir(), { recursive: true });
  const ref = `${randomUUID()}.${extFor(mime)}`;
  await secureWriteFile(join(assetsDir(), ref), bytes);
  return ref;
}
export async function getAsset(ref: string): Promise<InvoiceAsset | null> {
  try {
    const buf = await secureReadFile(join(assetsDir(), ref));
    const mime = mimeFor(ref);
    return { mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch { return null; }
}
