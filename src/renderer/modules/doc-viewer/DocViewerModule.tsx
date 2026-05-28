/**
 * Internal read-only document viewer. Opened from a case attachment's "View" button.
 * Streams bytes via the path-confined files.readAttachmentBytes IPC (never a file:// URL)
 * and renders per type entirely offline. HTML/DOCX/EML bodies go through the centralized
 * DOMPurify sanitizer (sanitizeHtml) which also neutralizes remote-resource refs, so a
 * malicious document cannot beacon out.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import Papa from 'papaparse';
import type { EmlPreview } from '@shared/types';
import { loadAttachmentBytes, bytesToText, looksBinary } from '../../lib/attachmentBytes';
import { sanitizeHtml, wireExternalLinks } from '../../lib/sanitizeHtml';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props { caseId: string; fileName: string; originalName: string }

type Kind = 'pdf' | 'image' | 'csv' | 'json' | 'html' | 'docx' | 'eml' | 'text';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'];

function kindFor(name: string): Kind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'docx') return 'docx';
  if (ext === 'eml') return 'eml';
  return 'text';
}

function useBytes(caseId: string, fileName: string): { bytes: Uint8Array<ArrayBuffer> | null; error: string | null } {
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

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ padding: 16, color: '#666' }}>{children}</div>;
}

export function DocViewerModule({ caseId, fileName, originalName }: Props): JSX.Element {
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
        <Body kind={kind} caseId={caseId} fileName={fileName} />
      </div>
    </div>
  );
}

function Body({ kind, caseId, fileName }: { kind: Kind; caseId: string; fileName: string }): JSX.Element {
  switch (kind) {
    case 'pdf': return <PdfBody caseId={caseId} fileName={fileName} />;
    case 'image': return <ImageBody caseId={caseId} fileName={fileName} />;
    case 'csv': return <CsvBody caseId={caseId} fileName={fileName} />;
    case 'json': return <JsonBody caseId={caseId} fileName={fileName} />;
    case 'html': return <HtmlBody caseId={caseId} fileName={fileName} />;
    case 'docx': return <DocxBody caseId={caseId} fileName={fileName} />;
    case 'eml': return <EmlBody caseId={caseId} fileName={fileName} />;
    default: return <TextBody caseId={caseId} fileName={fileName} />;
  }
}

function PdfBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
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
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';
          canvas.style.margin = '8px auto';
          canvas.style.boxShadow = '0 0 4px rgba(0,0,0,0.4)';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
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

function ImageBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
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

function CsvBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
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
      <div style={{ overflow: 'auto' }}>
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

function JsonBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
  const pretty = useMemo(() => {
    if (!bytes) return '';
    const text = bytesToText(bytes);
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }, [bytes]);
  if (error) return <Centered>Could not load: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  return <pre style={{ padding: 12, margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty}</pre>;
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
  return <div ref={ref} style={{ padding: 12, fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: safe }} />;
}

function HtmlBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
  if (error) return <Centered>Could not load: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  return <SanitizedHtml html={bytesToText(bytes)} />;
}

function DocxBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
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

function TextBody({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const { bytes, error } = useBytes(caseId, fileName);
  if (error) return <Centered>Could not load: {error}</Centered>;
  if (!bytes) return <Centered>Loading…</Centered>;
  if (looksBinary(bytes)) return <Centered>This file is not a previewable text/document type. Use Reveal to open it externally.</Centered>;
  return <pre style={{ padding: 12, margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{bytesToText(bytes)}</pre>;
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
      {eml.html ? <SanitizedHtml html={eml.html} /> : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>{eml.text}</pre>}
    </div>
  );
}
