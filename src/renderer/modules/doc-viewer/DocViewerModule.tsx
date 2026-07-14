/**
 * Internal read-only document viewer. Opened from a case attachment's "View" button.
 * Streams bytes via the path-confined files.readAttachmentBytes IPC (never a file:// URL)
 * and renders per type entirely offline. HTML/DOCX/EML bodies go through the centralized
 * DOMPurify sanitizer (sanitizeHtml) which also neutralizes remote-resource refs, so a
 * malicious document cannot beacon out.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from '../../lib/pdf-worker?worker';
import mammoth from 'mammoth';
import Papa from 'papaparse';
import type { EmlPreview } from '@shared/types';
import { loadAttachmentBytes, bytesToText, looksBinary } from '../../lib/attachmentBytes';
import { sanitizeHtml, wireExternalLinks } from '../../lib/sanitizeHtml';

// Use a worker built from our own entry (pdf-worker.ts) rather than the raw pdfjs worker
// URL, so the Uint8Array hex/base64 polyfill is present in the worker realm. workerPort
// takes a live Worker instance; pdf.js drives all getDocument() calls through it.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

/**
 * The viewer serves two byte sources:
 *  - `case`: a case attachment (path-confined files.* IPC + files.mediaUrl streaming).
 *  - `documents`: a My-Documents file, decrypted in-process via documents:readBytes (never an
 *    OS handoff). Types the byte pipeline can't render (eml/video/audio/unknown) show an
 *    "Export…" fallback rather than a broken preview.
 */
type Props =
  | { source: 'case'; caseId: string; fileName: string; originalName?: string }
  | { source: 'documents'; relPath: string; name: string };

type Kind = 'pdf' | 'image' | 'csv' | 'json' | 'html' | 'docx' | 'eml' | 'video' | 'audio' | 'text';

/** The kinds whose bodies render from raw decrypted bytes (source-agnostic). eml/video/audio use
 *  case-only streaming IPC, so they are NOT byte kinds and are unsupported on the documents path. */
type ByteKind = 'pdf' | 'image' | 'csv' | 'json' | 'html' | 'docx' | 'text';

interface BytesProps { bytes: Uint8Array<ArrayBuffer> | null; error: string | null }

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'];
// Container types Chromium can play. These stream via ga98media:// (range requests) rather
// than base64-loading into the renderer, so a 350 MB video no longer trips the 64 MB cap.
const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'ogv', 'mov'];
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus'];

function kindFor(name: string): Kind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'docx') return 'docx';
  if (ext === 'eml') return 'eml';
  return 'text';
}

function useBytes(caseId: string, fileName: string): BytesProps {
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBytes(null); setError(null);
    loadAttachmentBytes(caseId, fileName)
      .then((b) => { if (live) setBytes(b); })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [caseId, fileName]);
  return { bytes, error };
}

/** Documents source: decrypted bytes read in-process via documents:readBytes (a Uint8Array
 *  structured-cloned over IPC; copied into a fresh Uint8Array here — the plaintext lives only in
 *  renderer memory, never a temp file). The main store caps the size before reading. */
function useDocBytes(relPath: string): BytesProps {
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBytes(null); setError(null);
    window.api.documents.readBytes(relPath)
      .then((arr) => { if (live) setBytes(new Uint8Array(arr) as Uint8Array<ArrayBuffer>); })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [relPath]);
  return { bytes, error };
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ padding: 16, color: '#666' }}>{children}</div>;
}

export function DocViewerModule(props: Props): JSX.Element {
  if (props.source === 'documents') {
    return <DocumentsViewer relPath={props.relPath} name={props.name} />;
  }
  return <CaseViewer caseId={props.caseId} fileName={props.fileName} originalName={props.originalName ?? props.fileName} />;
}

// ---- case source (unchanged behavior) ----

function CaseViewer({ caseId, fileName, originalName }: { caseId: string; fileName: string; originalName: string }): JSX.Element {
  const kind = kindFor(originalName || fileName);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div className="ga98-toolbar">
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{originalName}</b>
        <span style={{ flex: 1 }} />
        <button onClick={() => void window.api.files.revealAttachment(caseId, fileName)}>Reveal</button>
        <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 8 }}>{kind.toUpperCase()}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <CaseBody kind={kind} caseId={caseId} fileName={fileName} />
      </div>
    </div>
  );
}

function CaseBody({ kind, caseId, fileName }: { kind: Kind; caseId: string; fileName: string }): JSX.Element {
  switch (kind) {
    case 'eml': return <EmlBody caseId={caseId} fileName={fileName} />;
    case 'video': return <MediaBody kind="video" caseId={caseId} fileName={fileName} />;
    case 'audio': return <MediaBody kind="audio" caseId={caseId} fileName={fileName} />;
    default: return <CaseByteBody kind={kind} caseId={caseId} fileName={fileName} />;
  }
}

/** Loads case-attachment bytes and hands them to the source-agnostic byte body. */
function CaseByteBody({ kind, caseId, fileName }: { kind: ByteKind; caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
  return <ByteBody kind={kind} bytes={bytes} error={error} />;
}

// ---- documents source (My Documents internal viewer) ----

// Extensions the byte pipeline previews as text/code. Anything else that resolves to the `text`
// catch-all (archives, binaries, …) is treated as unsupported → Export fallback.
const DOC_TEXT_EXT = [
  'txt', 'text', 'md', 'markdown', 'log', 'rtf', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'css', 'scss', 'less', 'sh', 'bash', 'rs', 'c', 'h',
  'cpp', 'hpp', 'cc', 'java', 'go', 'rb', 'php', 'sql', 'csv', 'tsv'
];

/** True iff the documents byte pipeline can render this file. eml/video/audio need case-only
 *  streaming IPC; an unknown extension (falls into the `text` catch-all) is unsupported. */
function docSupported(name: string): boolean {
  const kind = kindFor(name);
  if (kind === 'eml' || kind === 'video' || kind === 'audio') return false;
  if (kind === 'text') return DOC_TEXT_EXT.includes(name.toLowerCase().split('.').pop() ?? '');
  return true;
}

function DocumentsViewer({ relPath, name }: { relPath: string; name: string }): JSX.Element {
  const kind = kindFor(name);
  const supported = docSupported(name);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div className="ga98-toolbar">
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</b>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 8 }}>{kind.toUpperCase()}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {supported
          ? <DocByteBody kind={kind as ByteKind} relPath={relPath} />
          : <UnsupportedPanel relPath={relPath} name={name} />}
      </div>
    </div>
  );
}

/** Loads decrypted My-Documents bytes and hands them to the source-agnostic byte body. */
function DocByteBody({ kind, relPath }: { kind: ByteKind; relPath: string }): JSX.Element {
  const { bytes, error } = useDocBytes(relPath);
  return <ByteBody kind={kind} bytes={bytes} error={error} />;
}

/** Fallback for a type the in-app pipeline can't render: offer a decrypt-to-disk Export instead of
 *  a broken preview. Export goes through the existing documents:export (OS save dialog, confined). */
function UnsupportedPanel({ relPath, name }: { relPath: string; name: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div style={{ padding: 24, color: '#555' }}>
      <p style={{ marginTop: 0 }}>Can&apos;t preview this file type in-app.</p>
      <p style={{ fontSize: 12, opacity: 0.8, wordBreak: 'break-word' }}>{name}</p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true); setErr(null);
          void window.api.documents.export(relPath)
            .catch((e) => setErr((e as Error).message))
            .finally(() => setBusy(false));
        }}
      >Export…</button>
      {err && <div style={{ color: '#a00', marginTop: 8, fontSize: 12 }}>{err}</div>}
    </div>
  );
}

/** Source-agnostic renderer: dispatches to the byte-driven leaf for a resolved {bytes,error}. */
function ByteBody({ kind, bytes, error }: BytesProps & { kind: ByteKind }): JSX.Element {
  switch (kind) {
    case 'pdf': return <PdfBody bytes={bytes} error={error} />;
    case 'image': return <ImageBody bytes={bytes} error={error} />;
    case 'csv': return <CsvBody bytes={bytes} error={error} />;
    case 'json': return <JsonBody bytes={bytes} error={error} />;
    case 'html': return <HtmlBody bytes={bytes} error={error} />;
    case 'docx': return <DocxBody bytes={bytes} error={error} />;
    default: return <TextBody bytes={bytes} error={error} />;
  }
}

/** Unencrypted video/audio stream through the path-confined ga98media:// protocol via
 *  files.mediaUrl — no base64, no cap. Encrypted-at-rest files can't be range-streamed
 *  (whole-file GCM ⇒ one auth tag over the whole file, no seekable plaintext), so the IPC
 *  returns reason:'encrypted' and we fall back to IN-APP DECRYPT-AND-PLAY: the vault streams
 *  the decrypted bytes back and we play them from an in-memory Blob URL — the plaintext stays
 *  in renderer memory, never touches disk, and the object URL is revoked on unmount. */
const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg'
};
function mediaMime(name: string, kind: 'video' | 'audio'): string {
  return MEDIA_MIME[name.toLowerCase().split('.').pop() ?? ''] ?? (kind === 'video' ? 'video/mp4' : 'audio/mpeg');
}

function MediaBody({ kind, caseId, fileName }: { kind: 'video' | 'audio'; caseId: string; fileName: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setUrl(null); setErr(null);
    window.api.files.mediaUrl(caseId, fileName)
      .then(async (r) => {
        if (!live) return;
        if (r.url) { setUrl(r.url); return; }
        if (r.reason === 'encrypted') {
          // In-app decrypt & play (login enabled): pull the decrypted bytes through the vault
          // and play from a Blob URL so the plaintext never lands on disk.
          try {
            const bytes = await loadAttachmentBytes(caseId, fileName);
            if (!live) return;
            objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaMime(fileName, kind) }));
            setUrl(objectUrl);
          } catch (e) { if (live) setErr((e as Error).message); }
          return;
        }
        setErr(r.reason === 'missing' ? 'File not found on disk.' : 'This media cannot be played in-app. Use Reveal to open it externally.');
      })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [caseId, fileName, kind]);

  if (err) return <Centered>{err}</Centered>;
  if (!url) return <Centered>Preparing stream…</Centered>;
  if (kind === 'audio') {
    return <div style={{ padding: 24 }}><audio controls src={url} style={{ width: '100%' }} /></div>;
  }
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video controls src={url} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  );
}

function PdfBody({ bytes, error }: BytesProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.2);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    // Copy into a fresh buffer — pdf.js may detach the one it's handed.
    const data = bytes.slice();
    void (async () => {
      try {
        // CSP forbids eval, so pdf.js auto-detects and avoids it — no isEvalSupported flag needed.
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          // Positioned wrapper so the transparent text layer can overlay the canvas exactly.
          const pageWrap = document.createElement('div');
          pageWrap.style.position = 'relative';
          pageWrap.style.margin = '8px auto';
          pageWrap.style.width = `${viewport.width}px`;
          pageWrap.style.height = `${viewport.height}px`;
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';
          canvas.style.boxShadow = '0 0 4px rgba(0,0,0,0.4)';
          pageWrap.appendChild(canvas);
          container.appendChild(pageWrap);
          // pdf.js 5.x: hand it the canvas element and let it derive the 2D context.
          // Passing BOTH `canvas` and `canvasContext` is rejected in v5 (the context path
          // requires canvas to be null), which made every page render throw → blank viewer.
          await page.render({ canvas, viewport }).promise;
          // Overlay a selectable text layer (transparent spans) so PDF text can be copied.
          // pdf.js 5.x TextLayer sizes its own container (setLayerDimensions); CSS just
          // absolutely positions it over the canvas. Guarded so a text-layer failure never
          // blanks the already-rendered page canvas.
          try {
            const textDiv = document.createElement('div');
            textDiv.className = 'ga98-selectable ga98-pdf-textlayer';
            // pdf.js writes per-span --font-height/--scale-x/--rotate but leaves the CSS zoom,
            // --total-scale-factor, to the host (we don't use the full PDFViewer that sets it).
            // Without it the stylesheet's font-size/transform calc()s are invalid and spans
            // fall back to the app default size, mis-tracking the canvas glyphs. It equals the
            // viewport scale we rendered the canvas at.
            textDiv.style.setProperty('--total-scale-factor', String(scale));
            pageWrap.appendChild(textDiv);
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: page.streamTextContent(),
              container: textDiv,
              viewport
            });
            await textLayer.render();
          } catch {
            // Non-fatal: the page canvas stands on its own without a selectable overlay.
          }
        }
      } catch (e) {
        if (!cancelled) setRenderError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [bytes, scale]);

  if (error) return <Centered>Could not load PDF: {error}</Centered>;
  if (renderError) return <Centered>Could not render PDF: {renderError}. Use Reveal to open it externally.</Centered>;
  if (!bytes) return <Centered>Loading PDF…</Centered>;
  return (
    <div>
      <div className="ga98-toolbar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
        <button onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}>−</button>
        <span style={{ fontSize: 11, padding: '0 6px' }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(4, s + 0.2))}>+</button>
      </div>
      <div ref={containerRef} style={{ background: '#888' }} />
    </div>
  );
}

function ImageBody({ bytes, error }: BytesProps): JSX.Element {
  const [scale, setScale] = useState(1);
  const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([bytes])) : null), [bytes]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (error) return <Centered>Could not load image: {error}</Centered>;
  if (!url) return <Centered>Loading image…</Centered>;
  return (
    <div>
      <div className="ga98-toolbar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
        <button onClick={() => setScale((s) => Math.max(0.1, s - 0.25))}>−</button>
        <span style={{ fontSize: 11, padding: '0 6px' }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(8, s + 0.25))}>+</button>
        <button onClick={() => setScale(1)}>Fit</button>
      </div>
      <div style={{ overflow: 'auto', textAlign: 'center', background: '#333', minHeight: '100%' }}>
        <img src={url} alt="" style={{ transform: `scale(${scale})`, transformOrigin: 'top center', imageRendering: 'auto' }} />
      </div>
    </div>
  );
}

function CsvBody({ bytes, error }: BytesProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const rows = useMemo<string[][]>(() => {
    if (!bytes) return [];
    const text = bytesToText(bytes);
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    return (parsed.data as string[][]).slice(0, 2000);
  }, [bytes]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(q)));
  }, [rows, filter]);

  if (error) return <Centered>Could not load CSV: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  return (
    <div style={{ padding: 8 }}>
      <input className="ga98-text" placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="ga98-selectable" style={{ overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} style={{ border: '1px solid #c0c0c0', padding: '2px 6px', whiteSpace: 'nowrap', fontWeight: i === 0 ? 'bold' : 'normal' }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length >= 2000 && <p style={{ fontSize: 11, color: '#900' }}>Showing first 2000 rows.</p>}
      </div>
    </div>
  );
}

function JsonBody({ bytes, error }: BytesProps): JSX.Element {
  const pretty = useMemo(() => {
    if (!bytes) return '';
    const text = bytesToText(bytes);
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }, [bytes]);
  if (error) return <Centered>Could not load: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  return <pre className="ga98-selectable" style={{ padding: 12, margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty}</pre>;
}

function SanitizedHtml({ html }: { html: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = wireExternalLinks(el);
    return () => el.removeEventListener('click', handler);
  }, [safe]);
  return <div ref={ref} className="ga98-selectable" style={{ padding: 12, fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: safe }} />;
}

function HtmlBody({ bytes, error }: BytesProps): JSX.Element {
  if (error) return <Centered>Could not load: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  return <SanitizedHtml html={bytesToText(bytes)} />;
}

function DocxBody({ bytes, error }: BytesProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [convErr, setConvErr] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) return;
    let live = true;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    mammoth.convertToHtml({ arrayBuffer: ab })
      .then((r) => { if (live) setHtml(r.value); })
      .catch((e) => { if (live) setConvErr((e as Error).message); });
    return () => { live = false; };
  }, [bytes]);
  if (error) return <Centered>Could not load DOCX: {error}</Centered>;
  if (convErr) return <Centered>Could not convert DOCX: {convErr}. Use Reveal to open it externally.</Centered>;
  if (html == null) return <Centered>Converting DOCX…</Centered>;
  return <SanitizedHtml html={html} />;
}

function TextBody({ bytes, error }: BytesProps): JSX.Element {
  if (error) return <Centered>Could not load: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  if (looksBinary(bytes)) return <Centered>This file is not a previewable text/document type. Use Reveal to open it externally.</Centered>;
  return <pre className="ga98-selectable" style={{ padding: 12, margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{bytesToText(bytes)}</pre>;
}

function EmlBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const [eml, setEml] = useState<EmlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setEml(null); setError(null);
    window.api.files.readEml(caseId, fileName)
      .then((p) => { if (live) setEml(p); })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [caseId, fileName]);
  if (error) return <Centered>Could not parse email: {error}</Centered>;
  if (!eml) return <Centered>Loading email…</Centered>;
  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ borderBottom: '1px solid #c0c0c0', paddingBottom: 8, marginBottom: 8 }}>
        <div><b>From:</b> {eml.from || '—'}</div>
        <div><b>To:</b> {eml.to || '—'}</div>
        {eml.cc && <div><b>Cc:</b> {eml.cc}</div>}
        <div><b>Subject:</b> {eml.subject}</div>
        {eml.date && <div><b>Date:</b> {new Date(eml.date).toLocaleString()}</div>}
        {eml.attachments.length > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, opacity: 0.8 }}>
            Attachments: {eml.attachments.map((a) => `${a.filename} (${Math.ceil(a.size / 1024)} KB)`).join(', ')}
          </div>
        )}
      </div>
      {eml.html ? <SanitizedHtml html={eml.html} /> : <pre className="ga98-selectable" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>{eml.text}</pre>}
    </div>
  );
}
