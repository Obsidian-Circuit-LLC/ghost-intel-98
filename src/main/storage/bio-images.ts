/**
 * Per-case bio / profile images. Originals live under caseDir/bio-images/, generated thumbnails
 * (PNG, produced in the renderer via <canvas> — no native image lib, per npmRebuild:false) under
 * caseDir/bio-thumbs/, indexed in caseDir/bio-images.json ({ primaryId, images: BioImage[] }).
 * Thumbnails are tiny, so the case read inlines their data-URIs (thumbDataUri) for direct <img>
 * rendering; the full original is fetched on demand for the viewer. No hashing.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BioImage, ImageMime } from '@shared/types';
import { caseDir } from './paths';
import { withLock } from '../util/mutex';
import { secureReadFile, secureReadText, secureWriteFile } from './secure-fs';

interface BioIndex { primaryId: string | null; images: BioImage[] }

const EXT: Record<ImageMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_ORIGINAL_B64 = 44 * 1024 * 1024; // ~32 MiB raw
const MAX_THUMB_B64 = 1024 * 1024;         // ~768 KiB raw

function bioImagesDir(caseId: string): string { return join(caseDir(caseId), 'bio-images'); }
function bioThumbsDir(caseId: string): string { return join(caseDir(caseId), 'bio-thumbs'); }
function indexFile(caseId: string): string { return join(caseDir(caseId), 'bio-images.json'); }
function nowIso(): string { return new Date().toISOString(); }

export function originalAbsolutePath(caseId: string, fileName: string): string { return join(bioImagesDir(caseId), fileName); }

async function readIndex(caseId: string): Promise<BioIndex> {
  try {
    return JSON.parse(await secureReadText(indexFile(caseId))) as BioIndex;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { primaryId: null, images: [] };
    throw err;
  }
}

async function writeIndex(caseId: string, idx: BioIndex): Promise<void> {
  // Persist BioImage metadata only — omit the transient thumbDataUri / isPrimary fields.
  const clean: BioIndex = {
    primaryId: idx.primaryId,
    images: idx.images.map((img) => ({
      id: img.id, fileName: img.fileName, thumbName: img.thumbName, originalName: img.originalName,
      mime: img.mime, width: img.width, height: img.height, size: img.size, importedAt: img.importedAt,
      ...(img.caption !== undefined ? { caption: img.caption } : {})
    }))
  };
  await secureWriteFile(indexFile(caseId), JSON.stringify(clean, null, 2));
}

async function thumbDataUri(caseId: string, thumbName: string): Promise<string | undefined> {
  try {
    const buf = await secureReadFile(join(bioThumbsDir(caseId), thumbName));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return undefined; }
}

/** BioImage list with thumbnail data-URIs inlined — used on the case read path. */
export async function listResolved(caseId: string): Promise<BioImage[]> {
  const idx = await readIndex(caseId);
  return Promise.all(idx.images.map(async (img) => ({
    ...img,
    isPrimary: img.id === idx.primaryId,
    thumbDataUri: await thumbDataUri(caseId, img.thumbName)
  })));
}

/** Small data-URI of the case's primary thumbnail (for the case list). Best-effort. */
export async function primaryThumb(caseId: string): Promise<string | undefined> {
  const idx = await readIndex(caseId);
  const primary = idx.images.find((i) => i.id === idx.primaryId) ?? idx.images[0];
  if (!primary) return undefined;
  return thumbDataUri(caseId, primary.thumbName);
}

export async function add(caseId: string, input: {
  originalName: string; mime: ImageMime; width: number; height: number; originalBase64: string; thumbBase64: string;
}): Promise<BioImage> {
  if (input.originalBase64.length > MAX_ORIGINAL_B64) throw new Error('Image too large (over ~32 MB).');
  if (input.thumbBase64.length > MAX_THUMB_B64) throw new Error('Thumbnail too large.');
  return withLock(`bio:${caseId}`, async () => {
    await mkdir(bioImagesDir(caseId), { recursive: true });
    await mkdir(bioThumbsDir(caseId), { recursive: true });
    const id = `bio-${randomUUID()}`;
    const ext = EXT[input.mime];
    const fileName = `${id}.${ext}`;
    const thumbName = `${id}.png`;
    await secureWriteFile(join(bioImagesDir(caseId), fileName), Buffer.from(input.originalBase64, 'base64'));
    await secureWriteFile(join(bioThumbsDir(caseId), thumbName), Buffer.from(input.thumbBase64, 'base64'));
    const rec: BioImage = {
      id, fileName, thumbName, originalName: input.originalName, mime: input.mime,
      width: input.width, height: input.height,
      size: Buffer.byteLength(input.originalBase64, 'base64'), importedAt: nowIso()
    };
    const idx = await readIndex(caseId);
    idx.images.push(rec);
    if (!idx.primaryId) idx.primaryId = id;
    await writeIndex(caseId, idx);
    return rec;
  });
}

export async function remove(caseId: string, id: string): Promise<void> {
  return withLock(`bio:${caseId}`, async () => {
    const idx = await readIndex(caseId);
    const img = idx.images.find((i) => i.id === id);
    if (!img) return;
    await rm(join(bioImagesDir(caseId), img.fileName), { force: true });
    await rm(join(bioThumbsDir(caseId), img.thumbName), { force: true });
    idx.images = idx.images.filter((i) => i.id !== id);
    if (idx.primaryId === id) idx.primaryId = idx.images[0]?.id ?? null;
    await writeIndex(caseId, idx);
  });
}

export async function setPrimary(caseId: string, id: string): Promise<void> {
  return withLock(`bio:${caseId}`, async () => {
    const idx = await readIndex(caseId);
    if (!idx.images.some((i) => i.id === id)) throw new Error('Bio image not found');
    idx.primaryId = id;
    await writeIndex(caseId, idx);
  });
}

export async function updateCaption(caseId: string, id: string, caption: string): Promise<void> {
  return withLock(`bio:${caseId}`, async () => {
    const idx = await readIndex(caseId);
    const img = idx.images.find((i) => i.id === id);
    if (!img) throw new Error('Bio image not found');
    img.caption = caption.slice(0, 2000);
    await writeIndex(caseId, idx);
  });
}

/** Full original image as a data-URI for the full-size viewer. */
export async function readOriginalDataUri(caseId: string, id: string): Promise<string | null> {
  const idx = await readIndex(caseId);
  const img = idx.images.find((i) => i.id === id);
  if (!img) return null;
  try {
    const buf = await secureReadFile(join(bioImagesDir(caseId), img.fileName));
    return `data:${img.mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}
