/**
 * Renderer helper: assemble an attachment's full bytes by paging the range-clamped
 * files.readAttachmentBytes IPC. Main caps each page (validateByteRange); we cap the total
 * so a huge file can't OOM the renderer either.
 */

const PAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export async function loadAttachmentBytes(caseId: string, fileName: string): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const res = await window.api.files.readAttachmentBytes(caseId, fileName, offset, PAGE_BYTES);
    if (res.base64 == null) {
      if (res.reason === 'out-of-range') break;
      throw new Error(`Could not read "${fileName}": ${res.reason ?? 'read error'}`);
    }
    const bytes = base64ToBytes(res.base64);
    chunks.push(bytes);
    total += bytes.length;
    offset += res.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`File is too large to preview in-app (over ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB). Use Reveal to open it externally.`);
    }
    if (!res.hasMore || res.length === 0) break;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Cheap binary sniff for the viewer's text fallback (NUL byte in the first 8 KiB). */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}
