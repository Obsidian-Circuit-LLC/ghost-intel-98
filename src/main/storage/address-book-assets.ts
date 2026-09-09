/** Address-Book-scoped encrypted asset store (mirrors journal-assets.ts). Bio pictures and album
 *  photos, individually encrypted blobs under address-book-assets/, filename `<uuid>.<ext>` (ext
 *  carries the mime). Kept separate from address-book.json (the contact records) and from every
 *  other module's asset store — a contact's photoRef must never resolve into another module's
 *  store. */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { secureReadFile, secureWriteFile } from './secure-fs';
import { dataRoot } from './paths';
import { ensureFileName } from '../security/validate';

const assetsDir = (): string => join(dataRoot(), 'address-book-assets');

function extFor(mime: string): string { return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'bin'; }
function mimeFor(ref: string): string { return ref.endsWith('.png') ? 'image/png' : ref.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'; }

export async function putAsset(bytes: Buffer, mime: string): Promise<string> {
  await mkdir(assetsDir(), { recursive: true });
  const ref = `${randomUUID()}.${extFor(mime)}`;
  await secureWriteFile(join(assetsDir(), ref), bytes);
  return ref;
}

export async function getAsset(ref: string): Promise<{ bytes: Buffer; mime: string } | null> {
  // Defense-in-depth: the IPC boundary already gates `ref` with ensureFileName, but this is a
  // renderer-reachable read primitive — re-validate here so a traversal ref ('../address-book.json',
  // '../../../../etc/passwd', NUL) can never reach secureReadFile and exfiltrate a decrypted vault
  // file or any host file the main process can read. A bad ref resolves to null rather than
  // throwing — the renderer treats "no such asset" uniformly.
  try {
    ensureFileName(ref, 'assetRef');
    const bytes = await secureReadFile(join(assetsDir(), ref));
    return { bytes, mime: mimeFor(ref) };
  } catch { return null; }
}
