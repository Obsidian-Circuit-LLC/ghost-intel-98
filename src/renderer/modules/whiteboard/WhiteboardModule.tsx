/**
 * Per-case whiteboard / canvas. Pan (drag background) + zoom (wheel), draggable nodes
 * (text / link / image / file), and connector edges. Dropped files import into the case as
 * attachments (reused importDropped) and become image/file nodes referencing them by fileName.
 * The board (a small graph of coords + refs) auto-saves debounced to caseDir/whiteboard.json.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Whiteboard, WhiteboardNode, WhiteboardEdge } from '@shared/types';
import { useWindows } from '../../state/store';
import { promptDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { loadAttachmentBytes } from '../../lib/attachmentBytes';
import { NODE_COLORS, resolveNodeColor, clampNodeSize, headerLabel } from './node-visual';
import { boardToPng } from './board-raster';

interface Props { caseId: string }

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'];
function id(): string { return crypto.randomUUID(); }
function isImage(name: string): boolean { return IMAGE_EXT.includes((name.split('.').pop() ?? '').toLowerCase()); }
function center(n: WhiteboardNode): { x: number; y: number } { return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }

export function WhiteboardModule({ caseId }: Props): JSX.Element {
  const [nodes, setNodes] = useState<WhiteboardNode[]>([]);
  const [edges, setEdges] = useState<WhiteboardEdge[]>([]);
  const [view, setView] = useState({ tx: 40, ty: 40, scale: 1 });
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [colorMenu, setColorMenu] = useState<string | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'node' | 'resize'; id?: string; startX: number; startY: number; orig: { x: number; y: number }; origSize?: { w: number; h: number } } | null>(null);

  useEffect(() => {
    let live = true;
    void window.api.whiteboard.read(caseId).then((b: Whiteboard) => {
      if (!live) return;
      setNodes(b.nodes); setEdges(b.edges); setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { live = false; };
  }, [caseId]);

  // Debounced autosave (skips the initial load).
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => { void window.api.whiteboard.write(caseId, { nodes, edges }).catch(() => undefined); }, 600);
    return () => clearTimeout(t);
  }, [nodes, edges, loaded, caseId]);

  const boardCoord = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    const mx = clientX - (rect?.left ?? 0);
    const my = clientY - (rect?.top ?? 0);
    return { x: (mx - view.tx) / view.scale, y: (my - view.ty) / view.scale };
  }, [view]);

  const viewportCenter = useCallback((): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    return boardCoord((rect?.left ?? 0) + (rect?.width ?? 600) / 2, (rect?.top ?? 0) + (rect?.height ?? 400) / 2);
  }, [boardCoord]);

  function addNode(partial: Omit<WhiteboardNode, 'id' | 'x' | 'y' | 'w' | 'h'> & Partial<Pick<WhiteboardNode, 'w' | 'h'>>): void {
    const c = viewportCenter();
    const w = partial.w ?? 200, h = partial.h ?? 120;
    setNodes((ns) => [...ns, { id: id(), x: c.x - w / 2, y: c.y - h / 2, w, h, ...partial }]);
  }

  // ----- pointer interactions -----
  function onBgMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return;
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, orig: { x: view.tx, y: view.ty } };
  }
  function onNodeMouseDown(e: React.MouseEvent, n: WhiteboardNode): void {
    e.stopPropagation();
    if (connectMode) return;
    drag.current = { kind: 'node', id: n.id, startX: e.clientX, startY: e.clientY, orig: { x: n.x, y: n.y } };
  }
  function onResizeMouseDown(e: React.MouseEvent, n: WhiteboardNode): void {
    e.stopPropagation();
    if (connectMode) return;
    drag.current = { kind: 'resize', id: n.id, startX: e.clientX, startY: e.clientY, orig: { x: n.x, y: n.y }, origSize: { w: n.w, h: n.h } };
  }
  function setNodeColor(nid: string, color: string): void {
    // Apply the colour WITHOUT closing the popover — the custom <input type=color> fires onChange
    // while the native OS picker is still open, so closing here would unmount the input mid-pick.
    // Preset swatches close explicitly; outside-click (below) closes for everything else.
    setNodes((ns) => ns.map((x) => x.id === nid ? { ...x, color } : x));
  }
  // Close the colour popover on any outside mousedown. A position:fixed backdrop can't do this — the
  // popover lives inside the board's CSS transform, which becomes the containing block for fixed
  // descendants, so a fixed backdrop only covers the transformed board box, not the viewport.
  useEffect(() => {
    if (colorMenu === null) return;
    function onDocDown(e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('.ga98-wb-colormenu') && !t.closest('.ga98-wb-swatch')) setColorMenu(null);
    }
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [colorMenu]);
  // Close the Export menu on any outside mousedown.
  useEffect(() => {
    if (!exportMenu) return;
    function onDocDown(e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('.ga98-wb-export')) setExportMenu(false);
    }
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [exportMenu]);
  useEffect(() => {
    function onMove(e: MouseEvent): void {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (d.kind === 'pan') {
        setView((v) => ({ ...v, tx: d.orig.x + dx, ty: d.orig.y + dy }));
      } else if (d.kind === 'resize' && d.id && d.origSize) {
        const s = clampNodeSize(d.origSize.w + dx / view.scale, d.origSize.h + dy / view.scale);
        setNodes((ns) => ns.map((n) => n.id === d.id ? { ...n, w: s.w, h: s.h } : n));
      } else if (d.id) {
        setNodes((ns) => ns.map((n) => n.id === d.id ? { ...n, x: d.orig.x + dx / view.scale, y: d.orig.y + dy / view.scale } : n));
      }
    }
    function onUp(): void { drag.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [view.scale]);

  function onWheel(e: React.WheelEvent): void {
    const rect = containerRef.current?.getBoundingClientRect();
    const mx = e.clientX - (rect?.left ?? 0), my = e.clientY - (rect?.top ?? 0);
    const bx = (mx - view.tx) / view.scale, by = (my - view.ty) / view.scale;
    const next = Math.min(3, Math.max(0.2, view.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView({ scale: next, tx: mx - bx * next, ty: my - by * next });
  }

  function onNodeClick(n: WhiteboardNode): void {
    if (!connectMode) return;
    if (!connectFrom) { setConnectFrom(n.id); return; }
    if (connectFrom !== n.id) setEdges((es) => [...es, { id: id(), from: connectFrom, to: n.id }]);
    setConnectFrom(null); setConnectMode(false);
  }

  function removeNode(nid: string): void {
    setNodes((ns) => ns.filter((n) => n.id !== nid));
    setEdges((es) => es.filter((e) => e.from !== nid && e.to !== nid));
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const at = boardCoord(e.clientX, e.clientY);
    const payload = files.map((f) => ({ sourcePath: window.api.files.getPathForFile(f), originalName: f.name })).filter((p) => p.sourcePath);
    if (payload.length === 0) { toast.error('Could not resolve dropped file paths.'); return; }
    try {
      const imported = await window.api.files.importDropped(caseId, payload);
      setNodes((ns) => [
        ...ns,
        ...imported.map((a, i) => ({
          id: id(), type: isImage(a.originalName) ? 'image' as const : 'file' as const,
          x: at.x + i * 24, y: at.y + i * 24,
          w: isImage(a.originalName) ? 220 : 200, h: isImage(a.originalName) ? 180 : 64,
          fileName: a.fileName, text: a.originalName
        }))
      ]);
    } catch (err) { toast.error(`Import failed: ${(err as Error).message}`); }
  }

  // ----- export / import -----
  async function exportSnapshot(kind: 'pdf' | 'docx'): Promise<void> {
    setExportMenu(false);
    if (busy) return;
    setBusy(true);
    try {
      const png = await boardToPng(nodes, edges, caseId);
      const saved = kind === 'pdf'
        ? await window.api.whiteboard.exportPdf(caseId, { png, nodes, edges })
        : await window.api.whiteboard.exportDocx(caseId, { png, nodes, edges });
      if (saved) toast.success(`Exported ${saved}`);
    } catch (err) { toast.error(`Export failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }
  async function exportBoardFile(): Promise<void> {
    setExportMenu(false);
    if (busy) return;
    setBusy(true);
    try {
      const saved = await window.api.whiteboard.exportFile(caseId);
      if (saved) toast.success(`Saved ${saved}`);
    } catch (err) { toast.error(`Export failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }
  async function importBoardFile(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const b = await window.api.whiteboard.importFile(caseId);
      if (b) { setNodes(b.nodes); setEdges(b.edges); toast.success('Board imported.'); }
    } catch (err) { toast.error(`Import failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => addNode({ type: 'text', text: 'New note' })}>+ Text</button>
        <button onClick={async () => {
          const url = await promptDialog('Link URL:', 'https://', 'Add link');
          if (!url) return;
          const title = await promptDialog('Label (optional):', url, 'Add link');
          addNode({ type: 'link', url, text: title || url, w: 220, h: 60 });
        }}>+ Link</button>
        <button data-active={connectMode} onClick={() => { setConnectMode((m) => !m); setConnectFrom(null); }}>
          {connectMode ? (connectFrom ? 'Pick target…' : 'Pick source…') : 'Connect'}
        </button>
        <button onClick={() => setView({ tx: 40, ty: 40, scale: 1 })}>Reset view</button>
        <span className="ga98-wb-export" style={{ position: 'relative', display: 'inline-flex' }}>
          <button disabled={busy} onClick={() => setExportMenu((m) => !m)} title="Export this board">Export ▾</button>
          {exportMenu && (
            <div className="ga98-wb-exportmenu" onMouseDown={(e) => e.stopPropagation()}
              style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, display: 'flex', flexDirection: 'column', background: 'var(--ga98-grey)', border: '2px outset var(--ga98-shadow-light)', padding: 2, minWidth: 140 }}>
              <button onClick={() => void exportSnapshot('pdf')}>PDF (snapshot)</button>
              <button onClick={() => void exportSnapshot('docx')}>Word (.docx)</button>
              <button onClick={() => void exportBoardFile()}>Board file (.gboard)</button>
            </div>
          )}
        </span>
        <button disabled={busy} onClick={() => void importBoardFile()} title="Import a .gboard file into this case">Import board</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, opacity: 0.7 }}>{nodes.length} nodes · {Math.round(view.scale * 100)}% · drag bg to pan, wheel to zoom, drop files to add</span>
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--ga98-recessed-bg, #cfd8dc)', cursor: connectMode ? 'crosshair' : 'default' }}
        onMouseDown={onBgMouseDown}
        onWheel={onWheel}
        onDrop={(e) => void onDrop(e)}
        onDragOver={(e) => e.preventDefault()}
      >
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
          <svg style={{ position: 'absolute', overflow: 'visible', width: 1, height: 1 }}>
            {edges.map((e) => {
              const a = nodes.find((n) => n.id === e.from), b = nodes.find((n) => n.id === e.to);
              if (!a || !b) return null;
              const p1 = center(a), p2 = center(b);
              const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
              return (
                <g key={e.id}>
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#37474f" strokeWidth={2} />
                  <circle cx={mid.x} cy={mid.y} r={8} fill="#fff" stroke="#37474f" style={{ cursor: 'pointer' }}
                    onMouseDown={(ev) => { ev.stopPropagation(); setEdges((es) => es.filter((x) => x.id !== e.id)); }}>
                    <title>Delete connection</title>
                  </circle>
                  <text x={mid.x} y={mid.y + 3} fontSize={10} textAnchor="middle" pointerEvents="none">×</text>
                </g>
              );
            })}
          </svg>
          {nodes.map((n) => (
            <NodeView key={n.id} node={n} caseId={caseId} connecting={connectMode} isSource={connectFrom === n.id}
              onMouseDown={(e) => onNodeMouseDown(e, n)} onClick={() => onNodeClick(n)}
              onResizeMouseDown={(e) => onResizeMouseDown(e, n)}
              onDelete={() => removeNode(n.id)}
              colorMenuOpen={colorMenu === n.id}
              onToggleColorMenu={() => setColorMenu((c) => (c === n.id ? null : n.id))}
              onCloseColorMenu={() => setColorMenu(null)}
              onPickColor={(color) => setNodeColor(n.id, color)}
              onRename={async () => {
                const nm = await promptDialog('Name this item:', n.name ?? '', 'Rename');
                if (nm !== null) setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, name: nm } : x));
              }}
              onEditText={async () => {
                const t = await promptDialog('Edit text:', n.text ?? '', 'Edit node');
                if (t !== null) setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, text: t } : x));
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeView({ node, caseId, connecting, isSource, onMouseDown, onClick, onResizeMouseDown, onDelete, colorMenuOpen, onToggleColorMenu, onCloseColorMenu, onPickColor, onRename, onEditText }: {
  node: WhiteboardNode; caseId: string; connecting: boolean; isSource: boolean;
  onMouseDown: (e: React.MouseEvent) => void; onClick: () => void; onResizeMouseDown: (e: React.MouseEvent) => void; onDelete: () => void;
  colorMenuOpen: boolean; onToggleColorMenu: () => void; onCloseColorMenu: () => void; onPickColor: (color: string) => void;
  onRename: () => void; onEditText: () => void;
}): JSX.Element {
  const pal = resolveNodeColor(node.color);
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={onClick}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: node.w, height: node.h,
        background: pal.body, border: `2px solid ${isSource ? '#000080' : pal.head}`,
        boxShadow: '2px 2px 6px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column',
        cursor: connecting ? 'pointer' : 'move', overflow: 'visible', fontSize: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: pal.head, color: '#fff', fontSize: 10, padding: '1px 4px', position: 'relative' }}>
        <span
          className="ga98-wb-swatch"
          onMouseDown={(e) => { e.stopPropagation(); onToggleColorMenu(); }}
          title="Change tile colour"
          style={{ width: 11, height: 11, flexShrink: 0, borderRadius: 2, cursor: 'pointer', background: pal.head, border: '1px solid rgba(255,255,255,0.85)' }}
        />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
          title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); onRename(); }}>{headerLabel(node)}</span>
        <span style={{ cursor: 'pointer' }} onMouseDown={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</span>
        {colorMenuOpen && (
          <div className="ga98-wb-colormenu" onMouseDown={(e) => e.stopPropagation()}>
            {NODE_COLORS.map((c) => (
              <span key={c.key} title={c.key} onMouseDown={(e) => { e.stopPropagation(); onPickColor(c.key); onCloseColorMenu(); }}
                style={{ width: 16, height: 16, borderRadius: 2, cursor: 'pointer', background: c.head, border: '1px solid rgba(0,0,0,0.35)' }} />
            ))}
            <input type="color" title="Custom colour (stays open — click away when done)"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => onPickColor(e.target.value)}
              style={{ width: 16, height: 16, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: 4 }}>
        {node.type === 'text' && <div onDoubleClick={onEditText} style={{ whiteSpace: 'pre-wrap', cursor: 'text', height: '100%' }}>{node.text || '(double-click to edit)'}</div>}
        {node.type === 'link' && <a style={{ color: '#000080', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (node.url) void window.api.system.openExternal(node.url); }}>{node.text || node.url}</a>}
        {node.type === 'image' && node.fileName && <ImageNode caseId={caseId} fileName={node.fileName} />}
        {node.type === 'file' && (
          <div onDoubleClick={() => useWindows.getState().open({ module: 'doc-viewer', title: node.text ?? 'File', props: { caseId, fileName: node.fileName, originalName: node.text }, width: 900, height: 680 })}
            style={{ cursor: 'pointer' }} title="Double-click to view">
            📄 {node.text}
          </div>
        )}
      </div>
      <div className="ga98-wb-resize" onMouseDown={onResizeMouseDown} title="Drag to resize" />
    </div>
  );
}

function ImageNode({ caseId, fileName }: { caseId: string; fileName: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true; let made: string | null = null;
    void loadAttachmentBytes(caseId, fileName).then((bytes) => {
      if (!live) return;
      made = URL.createObjectURL(new Blob([bytes]));
      setUrl(made);
    }).catch(() => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [caseId, fileName]);
  const memoUrl = useMemo(() => url, [url]);
  return memoUrl
    ? <img src={memoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
    : <span style={{ opacity: 0.6 }}>loading…</span>;
}
