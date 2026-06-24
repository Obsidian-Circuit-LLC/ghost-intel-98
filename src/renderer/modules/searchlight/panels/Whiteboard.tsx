/**
 * Whiteboard — infinite-canvas whiteboard panel for Searchlight (Task 11).
 *
 * Port transforms from .searchlight-source/src/renderer/components/Whiteboard/Whiteboard.tsx:
 * 1. Store: useSearchlightStore instead of useAppStore; all mutations via store actions.
 * 2. uuidv4() → crypto.randomUUID() throughout.
 * 3. framer-motion dropped; no animation imports.
 * 4. sfx dropped (no sound utility in searchlight module).
 * 5. lucide-react dropped; icons are inline SVG / Unicode glyphs.
 * 6. react-rnd (Rnd) used for FileCard and NoteCard drag + resize.
 * 7. File ingestion: renderer-local FileReader.readAsDataURL on dropped File objects
 *    or browser <input type="file"> — NOT window.api.files IPC (wrong model).
 *    Files capped at 10 MB; dataUrl stored in WhiteboardFile, persisted encrypted
 *    via store's debounced saveCase.
 * 8. CSP-safe rendering:
 *    - image/* → <img src={dataUrl}> (data: images are allowed by CSP)
 *    - text/* / application/json / application/csv → decoded text in a scrollable
 *      <pre> card (React text rendering, never dangerouslySetInnerHTML).
 *    - application/pdf → labeled card placeholder (no iframe/embed — embedding
 *      data: PDFs would require broadening frame-src/object-src; v1 scope reduction).
 *    - unknown → generic file card.
 * 9. Win98 toolbar; dark grid canvas with sl-wb-* CSS in searchlight.css.
 * 10. Infinite canvas: scroll to zoom, Alt+drag or middle-click to pan.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { useSearchlightStore } from '../store';
import type { WhiteboardFile, WhiteboardNote } from '@shared/searchlight/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const GRID_SIZE = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const NOTE_COLORS = ['#00b4ff', '#7b2fff', '#00ff88', '#ffcc00', '#ff8800'];

// ─── Transform state ───────────────────────────────────────────────────────────

interface Transform { x: number; y: number; scale: number; }

// ─── Inline SVG icons ──────────────────────────────────────────────────────────

const IconPDF = (): JSX.Element => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="2" width="14" height="18" rx="2" />
    <path d="M7 7h6M7 11h4" />
    <path d="M17 8l4 4-4 4" />
  </svg>
);

const IconFile = (): JSX.Element => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14,2 14,8 20,8" />
  </svg>
);

const IconPlus = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" />
  </svg>
);

const IconAdd = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="2" y="2" width="12" height="12" rx="1" />
    <line x1="8" y1="5" x2="8" y2="11" /><line x1="5" y1="8" x2="11" y2="8" />
  </svg>
);

const IconReset = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="1.5" fill="currentColor" />
  </svg>
);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeDataUrlText(dataUrl: string): string {
  try {
    const b64 = dataUrl.split(',')[1] ?? '';
    if (!b64) return '';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function mimeIsText(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'text/csv' ||
    mimeType === 'application/csv'
  );
}

function estimateDataUrlBytes(dataUrl: string): number {
  // base64 encodes 3 bytes as 4 chars; strip header
  const b64 = dataUrl.split(',')[1] ?? '';
  return Math.floor((b64.length * 3) / 4);
}

// ─── FileCard ─────────────────────────────────────────────────────────────────

interface FileCardProps {
  file: WhiteboardFile;
  onUpdate: (id: string, updates: Partial<WhiteboardFile>) => void;
  onRemove: (id: string) => void;
  transform: Transform;
}

function FileCard({ file, onUpdate, onRemove, transform }: FileCardProps): JSX.Element {
  const [textExpanded, setTextExpanded] = useState(false);

  const renderContent = (): JSX.Element => {
    const mt = file.mimeType;

    if (mt.startsWith('image/')) {
      return (
        <img
          src={file.dataUrl}
          alt={file.name}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      );
    }

    if (mt === 'application/pdf') {
      // CSP-safe: no iframe/embed with data: URLs — v1 card placeholder
      const sizeLabel = formatBytes(estimateDataUrlBytes(file.dataUrl));
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: 8,
          color: 'rgba(180,200,255,0.5)',
        }}>
          <IconPDF />
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '10px', textAlign: 'center', padding: '0 8px' }}>
            {file.name}
          </div>
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '9px', opacity: 0.5 }}>
            PDF · {sizeLabel}
          </div>
          <div style={{
            fontFamily: 'Share Tech Mono', fontSize: '9px', color: '#ffc800',
            opacity: 0.6, textAlign: 'center', padding: '0 8px',
          }}>
            PDF preview not available (CSP)
          </div>
        </div>
      );
    }

    if (mimeIsText(mt)) {
      const text = decodeDataUrlText(file.dataUrl);
      const preview = textExpanded ? text : text.slice(0, 1200) + (text.length > 1200 ? '...' : '');
      return (
        <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <pre style={{
            flex: 1, margin: 0, padding: 6,
            fontFamily: 'Share Tech Mono', fontSize: '10px',
            color: 'rgba(180,220,255,0.75)', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            overflow: 'auto',
          }}>
            {preview || <span style={{ opacity: 0.4 }}>empty file</span>}
          </pre>
          {text.length > 1200 && (
            <button
              onClick={() => setTextExpanded((v) => !v)}
              style={{
                flexShrink: 0, background: 'rgba(26,111,255,0.1)',
                border: 'none', borderTop: '1px solid rgba(26,111,255,0.15)',
                color: 'rgba(100,160,255,0.7)', fontFamily: 'Share Tech Mono',
                fontSize: '9px', padding: '3px 0', cursor: 'pointer',
              }}
            >
              {textExpanded ? 'COLLAPSE' : `SHOW ALL (${text.length.toLocaleString()} chars)`}
            </button>
          )}
        </div>
      );
    }

    // Generic file card
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 8,
        color: 'rgba(180,200,255,0.4)',
      }}>
        <IconFile />
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '10px', textAlign: 'center', padding: '0 8px' }}>
          {file.name}
        </div>
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '9px', opacity: 0.5 }}>
          {file.mimeType || 'unknown type'}
        </div>
      </div>
    );
  };

  return (
    <Rnd
      position={{ x: file.x, y: file.y }}
      size={{ width: file.width, height: file.height }}
      minWidth={150}
      minHeight={100}
      scale={transform.scale}
      onDragStop={(_e, d) => {
        onUpdate(file.id, { x: d.x, y: d.y });
      }}
      onResizeStop={(_e, _dir, _ref, delta, position) => {
        onUpdate(file.id, {
          x: position.x,
          y: position.y,
          width: file.width + delta.width,
          height: file.height + delta.height,
        });
      }}
      style={{
        background: 'rgba(8,8,25,0.95)',
        border: '1px solid rgba(26,111,255,0.4)',
        borderRadius: 4,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 10px rgba(26,111,255,0.1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      // Prevent text inputs from triggering drag
      cancel="pre,textarea,button,input,a"
    >
      {/* Header — drag handle */}
      <div style={{
        padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(26,111,255,0.1)',
        borderBottom: '1px solid rgba(26,111,255,0.2)',
        flexShrink: 0, cursor: 'grab',
      }}>
        <span style={{
          fontFamily: 'Share Tech Mono', fontSize: '9px', color: 'rgba(180,200,255,0.6)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {file.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(file.id); }}
          style={{
            width: 16, height: 16, border: 'none',
            background: 'rgba(255,50,50,0.2)', borderRadius: 2,
            color: '#ff4444', fontSize: '10px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >×</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {renderContent()}
      </div>
    </Rnd>
  );
}

// ─── NoteCard ─────────────────────────────────────────────────────────────────

interface NoteCardProps {
  note: WhiteboardNote;
  onUpdate: (id: string, updates: Partial<WhiteboardNote>) => void;
  onRemove: (id: string) => void;
  transform: Transform;
}

function NoteCard({ note, onUpdate, onRemove, transform }: NoteCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);

  return (
    <Rnd
      position={{ x: note.x, y: note.y }}
      size={{ width: note.width, height: note.height }}
      minWidth={140}
      minHeight={80}
      scale={transform.scale}
      onDragStop={(_e, d) => {
        if (!editing) onUpdate(note.id, { x: d.x, y: d.y });
      }}
      onResizeStop={(_e, _dir, _ref, delta, position) => {
        onUpdate(note.id, {
          x: position.x,
          y: position.y,
          width: note.width + delta.width,
          height: note.height + delta.height,
        });
      }}
      disableDragging={editing}
      style={{
        background: `${note.color}18`,
        border: `1px solid ${note.color}44`,
        borderRadius: 4,
        boxShadow: `0 0 10px ${note.color}22`,
        padding: '10px 12px',
        boxSizing: 'border-box',
        cursor: editing ? 'text' : 'grab',
        userSelect: 'none',
      }}
      cancel="textarea,button"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(note.id); }}
        style={{
          position: 'absolute', top: 4, right: 4,
          width: 16, height: 16, border: 'none',
          background: 'rgba(255,50,50,0.15)', borderRadius: 2,
          color: '#ff4444', fontSize: '10px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >×</button>

      {editing ? (
        <textarea
          autoFocus
          value={note.content}
          onChange={(e) => onUpdate(note.id, { content: e.target.value })}
          onBlur={() => setEditing(false)}
          style={{
            width: '100%', height: 'calc(100% - 4px)',
            background: 'transparent', border: 'none', outline: 'none',
            color: note.color, fontFamily: 'Share Tech Mono', fontSize: '11px',
            resize: 'none', lineHeight: 1.6,
          }}
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          style={{
            fontFamily: 'Share Tech Mono', fontSize: '11px',
            color: note.color, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', minHeight: 40,
            paddingRight: 20, cursor: 'grab',
          }}
        >
          {note.content
            ? note.content
            : <span style={{ opacity: 0.4 }}>Double-click to edit…</span>}
        </div>
      )}
    </Rnd>
  );
}

// ─── Main Whiteboard component ─────────────────────────────────────────────────

export function Whiteboard(): JSX.Element {
  const store = useSearchlightStore();
  const activeCaseId = store.activeCaseId;
  const activeCase = store.cases.find((c) => c.id === activeCaseId) ?? null;

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const panRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Scroll to zoom ───────────────────────────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent): void => {
    e.preventDefault();
    setTransform((t) => {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, t.scale * delta));
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return { ...t, scale: newScale };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        scale: newScale,
        x: mx - (mx - t.x) * (newScale / t.scale),
        y: my - (my - t.y) * (newScale / t.scale),
      };
    });
  }, []);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Pan: Alt+drag or middle-click drag ───────────────────────────────────

  const handleBoardMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 1 && !(e.button === 0 && e.altKey)) return;
    e.preventDefault();
    setIsPanning(true);
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  };

  const handleBoardMouseMove = (e: React.MouseEvent): void => {
    if (!isPanning) return;
    setTransform((t) => ({
      ...t,
      x: panRef.current.origX + (e.clientX - panRef.current.startX),
      y: panRef.current.origY + (e.clientY - panRef.current.startY),
    }));
  };

  const handleBoardMouseUp = (): void => setIsPanning(false);

  // ── File ingestion via FileReader ────────────────────────────────────────

  const ingestFiles = useCallback((files: FileList | File[], dropX?: number, dropY?: number): void => {
    if (!activeCaseId) return;
    setIngestError(null);
    const arr = Array.from(files);

    for (const file of arr) {
      if (file.size > MAX_FILE_BYTES) {
        setIngestError(`"${file.name}" is too large (${formatBytes(file.size)} > 10 MB limit)`);
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const isImage = file.type.startsWith('image/');
        const x = dropX ?? 100 + Math.random() * 200;
        const y = dropY ?? 100 + Math.random() * 200;

        const wbFile: WhiteboardFile = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type.split('/')[0] || 'application',
          mimeType: file.type || 'application/octet-stream',
          dataUrl,
          x, y,
          width: isImage ? 300 : 350,
          height: isImage ? 240 : 280,
        };
        store.addWhiteboardFile(activeCaseId, wbFile);
      };
      reader.onerror = () => {
        setIngestError(`Failed to read "${file.name}"`);
      };
      reader.readAsDataURL(file);
    }
  }, [activeCaseId, store]);

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    if (!activeCaseId || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - transform.x) / transform.scale;
    const worldY = (e.clientY - rect.top - transform.y) / transform.scale;
    ingestFiles(e.dataTransfer.files, worldX, worldY);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files && e.target.files.length > 0) {
      ingestFiles(e.target.files);
    }
    // Reset input so same file can be re-picked
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Add sticky note ──────────────────────────────────────────────────────

  const handleAddNote = (): void => {
    if (!activeCaseId) return;
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    store.addWhiteboardNote(activeCaseId, {
      id: crypto.randomUUID(),
      content: '',
      x: -transform.x / transform.scale + 160 + Math.random() * 120,
      y: -transform.y / transform.scale + 140 + Math.random() * 120,
      width: 220,
      height: 120,
      color,
    });
  };

  const handleResetView = (): void => setTransform({ x: 0, y: 0, scale: 1 });

  // ── No active case guard ─────────────────────────────────────────────────

  if (!activeCaseId || !activeCase) {
    return (
      <div className="sl-wb-empty-root">
        <div className="sl-wb-empty-icon">◻</div>
        <div className="sl-wb-empty-text">NO ACTIVE CASE</div>
      </div>
    );
  }

  const isEmpty = activeCase.whiteboardFiles.length === 0 && activeCase.whiteboardNotes.length === 0;

  return (
    <div className="sl-wb-root">

      {/* ── Toolbar ── */}
      <div className="sl-wb-toolbar">
        <span className="sl-wb-toolbar-title">WHITEBOARD</span>

        <button className="sl-sweep-btn" onClick={handleAddNote}>
          <IconPlus /> NOTE
        </button>

        <button
          className="sl-sweep-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Add file to whiteboard (max 10 MB)"
        >
          <IconAdd /> ADD FILE
        </button>

        {/* Hidden file picker */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.json,.csv,.html,.htm"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />

        <div style={{ flex: 1 }} />

        {ingestError && (
          <span className="sl-wb-ingest-error" title={ingestError}>
            {ingestError.length > 48 ? ingestError.slice(0, 48) + '…' : ingestError}
            <button
              className="sl-wb-ingest-dismiss"
              onClick={() => setIngestError(null)}
              title="Dismiss error"
              aria-label="Dismiss"
            >
              ×
            </button>
          </span>
        )}

        <span className="sl-wb-hint">ALT+DRAG or MIDDLE-CLICK to pan · SCROLL to zoom</span>

        <button className="sl-sweep-btn" onClick={handleResetView} title="Reset view to 100%">
          <IconReset /> RESET
        </button>

        <span className="sl-wb-zoom">{Math.round(transform.scale * 100)}%</span>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={boardRef}
        className="sl-wb-canvas"
        onMouseDown={handleBoardMouseDown}
        onMouseMove={handleBoardMouseMove}
        onMouseUp={handleBoardMouseUp}
        onMouseLeave={handleBoardMouseUp}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          backgroundSize: `${GRID_SIZE * transform.scale}px ${GRID_SIZE * transform.scale}px`,
          backgroundPosition: `${transform.x % (GRID_SIZE * transform.scale)}px ${transform.y % (GRID_SIZE * transform.scale)}px`,
          cursor: isPanning ? 'grabbing' : 'default',
        }}
      >
        {/* World transform container */}
        <div
          style={{
            position: 'absolute',
            left: 0, top: 0,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: 10000, height: 10000,
          }}
        >
          {activeCase.whiteboardFiles.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              transform={transform}
              onUpdate={(id, updates) => store.updateWhiteboardFile(activeCaseId, id, updates)}
              onRemove={(id) => store.removeWhiteboardFile(activeCaseId, id)}
            />
          ))}

          {activeCase.whiteboardNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              transform={transform}
              onUpdate={(id, updates) => store.updateWhiteboardNote(activeCaseId, id, updates)}
              onRemove={(id) => store.removeWhiteboardNote(activeCaseId, id)}
            />
          ))}
        </div>

        {/* Empty-state hint */}
        {isEmpty && (
          <div className="sl-wb-canvas-hint">
            <div className="sl-wb-canvas-hint-icon">◻</div>
            <div className="sl-wb-canvas-hint-text">
              DROP FILES HERE TO ADD TO WHITEBOARD<br />
              <span style={{ fontSize: '10px' }}>IMAGES · PDF (card) · TXT · JSON · CSV · HTML</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
