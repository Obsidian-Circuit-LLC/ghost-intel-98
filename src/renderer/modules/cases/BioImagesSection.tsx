/**
 * Bio / profile images for a case. Drag-drop (or browse) images; the renderer decodes them and
 * generates an aspect-preserving thumbnail via <canvas> (no native image lib — required by the
 * npmRebuild:false build), then ships original + thumbnail bytes to the main process. A primary
 * image surfaces in the case list. Clicking opens a full-size lightbox.
 */
import { useRef, useState, type DragEvent } from 'react';
import type { BioImage, ImageMime } from '@shared/types';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

const ALLOWED: readonly ImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const THUMB_MAX = 96;

function normalizeMime(t: string): ImageMime | null {
  const m = t.toLowerCase();
  if (m === 'image/jpg') return 'image/jpeg';
  return (ALLOWED as readonly string[]).includes(m) ? (m as ImageMime) : null;
}

async function fileToBioInput(file: File): Promise<{ originalName: string; mime: ImageMime; width: number; height: number; originalBase64: string; thumbBase64: string }> {
  const mime = normalizeMime(file.type);
  if (!mime) throw new Error(`Unsupported image type: ${file.type || 'unknown'}`);
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
  const originalBase64 = dataUrl.split(',')[1] ?? '';
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not decode image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, THUMB_MAX / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const tw = Math.max(1, Math.round(img.naturalWidth * scale));
  const th = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, tw, th);
  const thumbBase64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
  return { originalName: file.name, mime, width: img.naturalWidth, height: img.naturalHeight, originalBase64, thumbBase64 };
}

export function BioImagesSection({ caseId, images, onRefresh }: {
  caseId: string;
  images: BioImage[];
  onRefresh(): void | Promise<void>;
}): JSX.Element {
  const [hot, setHot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function ingest(files: File[]): Promise<void> {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) { toast.warn('Drop image files (JPG, PNG, WEBP, GIF).'); return; }
    setBusy(true);
    let ok = 0;
    for (const f of imgs) {
      try { await window.api.bioImages.add(caseId, await fileToBioInput(f)); ok++; }
      catch (err) { toast.error(`${f.name}: ${(err as Error).message}`); }
    }
    setBusy(false);
    if (ok > 0) { await onRefresh(); toast.success(`Added ${ok} image${ok === 1 ? '' : 's'}.`); }
  }

  async function openFull(id: string): Promise<void> {
    try {
      const uri = await window.api.bioImages.readOriginal(caseId, id);
      if (uri) setLightbox(uri);
    } catch (err) { toast.error(`Could not open image: ${(err as Error).message}`); }
  }

  return (
    <fieldset>
      <legend>Bio images</legend>
      <div
        className="ga98-dropzone"
        data-hot={hot}
        onDragOver={(e) => { e.preventDefault(); setHot(true); }}
        onDragLeave={() => setHot(false)}
        onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setHot(false); void ingest(Array.from(e.dataTransfer.files)); }}
        onClick={() => fileInput.current?.click()}
        style={{ cursor: 'pointer' }}
      >
        {busy ? 'Processing…' : 'Drag images here, or click to browse (JPG / PNG / WEBP / GIF).'}
      </div>
      <input ref={fileInput} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={(e) => { void ingest(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {images.map((img) => (
            <div key={img.id} style={{ width: 104, fontSize: 10, textAlign: 'center' }}>
              <div style={{ position: 'relative', border: img.isPrimary ? '2px solid #000080' : '1px solid #808080', background: '#fff', height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {img.thumbDataUri
                  ? <img src={img.thumbDataUri} alt={img.originalName} title="Click to view full size" style={{ maxWidth: '100%', maxHeight: '100%', cursor: 'zoom-in' }} onClick={() => void openFull(img.id)} />
                  : <span style={{ color: '#999' }}>no preview</span>}
                {img.isPrimary && <span style={{ position: 'absolute', top: 0, left: 2, color: '#000080' }} title="Primary">★</span>}
              </div>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={img.originalName}>{img.caption || img.originalName}</div>
              <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2 }}>
                {!img.isPrimary && <button style={{ fontSize: 9, padding: '0 2px' }} title="Set as primary"
                  onClick={async () => { await window.api.bioImages.setPrimary(caseId, img.id); await onRefresh(); }}>★</button>}
                <button style={{ fontSize: 9, padding: '0 2px' }} title="Caption" onClick={async () => {
                  const c = await promptDialog('Caption:', img.caption ?? '', 'Image caption');
                  if (c === null) return;
                  await window.api.bioImages.updateCaption(caseId, img.id, c); await onRefresh();
                }}>✎</button>
                <button style={{ fontSize: 9, padding: '0 2px' }} title="Reveal in folder"
                  onClick={() => void window.api.bioImages.reveal(caseId, img.fileName)}>⌖</button>
                <button style={{ fontSize: 9, padding: '0 2px' }} title="Delete" onClick={async () => {
                  const ok = await confirmDialog(`Delete "${img.originalName}"?`, 'Delete image');
                  if (!ok) return;
                  await window.api.bioImages.delete(caseId, img.id); await onRefresh();
                }}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'zoom-out' }}>
          <img src={lightbox} alt="" style={{ maxWidth: '92%', maxHeight: '92%', boxShadow: '0 0 20px #000' }} />
        </div>
      )}
    </fieldset>
  );
}
