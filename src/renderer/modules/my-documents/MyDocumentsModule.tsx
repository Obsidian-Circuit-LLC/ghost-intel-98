import { useEffect, useState, type DragEvent, type MouseEvent } from 'react';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import type { DocEntry } from '../../../shared/documents-types';
import { useDocuments, joinRel } from './useDocuments';
import { DocumentsContextMenu, type ContextTarget } from './DocumentsContextMenu';
import { fileGlyphNode } from './file-icons';

/** Shared drag payload MIME for in-app item drags (My Documents ↔ folders, and cross-module). */
const GA98_ITEM = 'application/x-ga98-item';

interface Ga98ItemPayload { src: string; relPath?: string; name: string; kind?: string; id?: string; }

/** Parses the `GA98_ITEM` payload off a drop's DataTransfer, or null if absent/malformed. */
function readItemPayload(dt: DataTransfer): Ga98ItemPayload | null {
  if (!dt.types.includes(GA98_ITEM)) return null;
  const raw = dt.getData(GA98_ITEM);
  if (!raw) return null;
  try { return JSON.parse(raw) as Ga98ItemPayload; }
  catch { return null; }
}

export function MyDocumentsModule(): JSX.Element {
  const doc = useDocuments();
  const [vaultOn, setVaultOn] = useState(false);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const [dropHot, setDropHot] = useState(false);
  const [hoverFolder, setHoverFolder] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.api.auth.status().then((s) => { if (alive) setVaultOn(s.enabled === true); });
    return () => { alive = false; };
  }, []);

  async function onNewFolder(): Promise<void> {
    const name = await promptDialog('Folder name:', '', 'New Folder');
    if (name) await doc.newFolder(name);
  }
  async function onRename(e: DocEntry): Promise<void> {
    const name = await promptDialog(`Rename "${e.name}" to:`, e.name, 'Rename');
    if (name && name !== e.name) await doc.rename(joinRel(doc.dir, e.name), name);
  }
  async function onDelete(e: DocEntry): Promise<void> {
    const ok = await confirmDialog(`Delete "${e.name}"? This cannot be undone.`, 'Delete');
    if (ok) await doc.remove(joinRel(doc.dir, e.name));
  }

  async function onDrop(ev: DragEvent<HTMLDivElement>): Promise<void> {
    ev.preventDefault();
    setDropHot(false);
    const payload = readItemPayload(ev.dataTransfer);
    if (payload) {
      // A cross-module Briefcase note dropped on the folder view (not on a specific folder tile):
      // pull its body and land it as a .txt note in the current folder. A `docs` payload here means
      // the user missed a folder tile — nothing to do (in-folder moves are handled by the tile's own onDrop).
      if (payload.src === 'briefcase' && payload.id) {
        try {
          const note = await window.api.briefcase.read(payload.id);
          if (note) await doc.writeTextNote(doc.dir, `${payload.name}.txt`, note.body);
        } catch { /* writeTextNote already surfaces write/refresh failures via doc.error */ }
      }
      return;
    }
    const files = Array.from(ev.dataTransfer.files)
      .map((f) => ({ sourcePath: window.api.files.getPathForFile(f), originalName: f.name }))
      .filter((p) => p.sourcePath);
    if (files.length) void doc.importFiles(files);
  }

  function onTileDragStart(ev: DragEvent<HTMLDivElement>, e: DocEntry): void {
    const payload: Ga98ItemPayload = { src: 'docs', relPath: joinRel(doc.dir, e.name), name: e.name, kind: e.kind };
    ev.dataTransfer.setData(GA98_ITEM, JSON.stringify(payload));
  }

  function onFolderDragOver(ev: DragEvent<HTMLDivElement>, e: DocEntry): void {
    ev.preventDefault();
    ev.stopPropagation();
    setHoverFolder(e.name);
  }

  function onFolderDrop(ev: DragEvent<HTMLDivElement>, e: DocEntry): void {
    ev.preventDefault();
    ev.stopPropagation();
    setHoverFolder(null);
    const payload = readItemPayload(ev.dataTransfer);
    if (!payload || payload.src !== 'docs' || !payload.relPath) return;
    const destDir = joinRel(doc.dir, e.name);
    if (payload.relPath === destDir) return; // dropped onto itself
    void doc.move(payload.relPath, destDir);
  }

  function openMenu(ev: MouseEvent, entry: DocEntry | null): void {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({ x: ev.clientX, y: ev.clientY, entry });
  }

  const crumbs = doc.dir === '' ? [] : doc.dir.split('/');

  return (
    <div className="ga98-mydocs" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onMouseDown={() => setMenu(null)}>
      <div className="ga98-toolbar" style={{ display: 'flex', gap: 4, padding: 4 }}>
        <button onClick={() => void onNewFolder()}>New Folder</button>
        <button onClick={doc.up} disabled={doc.dir === ''}>Up</button>
        <button onClick={() => doc.reveal()}>Reveal in Explorer</button>
      </div>
      <div className="ga98-breadcrumb" style={{ padding: '2px 6px' }}>
        <a onClick={doc.goRoot} style={{ cursor: 'pointer' }}>My Documents</a>
        {crumbs.map((c, i) => <span key={i}> › {c}</span>)}
      </div>
      {vaultOn && (
        <div className="ga98-mydocs-encnote" style={{ padding: '2px 6px', fontSize: '0.85em', opacity: 0.8 }}>
          Files are encrypted at rest — open them here, not in Explorer.
        </div>
      )}
      {doc.error && <div className="ga98-mydocs-error" style={{ padding: '2px 6px', color: '#a00' }}>{doc.error}</div>}
      <div
        className="ga98-mydocs-view"
        data-drophot={dropHot}
        style={{ flex: 1, overflow: 'auto', padding: 6, background: dropHot ? '#e8f0ff' : undefined }}
        onContextMenu={(e) => openMenu(e, null)}
        onDragOver={(e) => { e.preventDefault(); setDropHot(true); }}
        onDragLeave={() => setDropHot(false)}
        onDrop={onDrop}
      >
        {doc.entries.length === 0 && <div style={{ opacity: 0.6 }}>This folder is empty.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
          {doc.entries.map((e) => (
            <div
              key={e.name}
              className="ga98-mydocs-tile"
              style={{
                width: 88, textAlign: 'center', cursor: 'pointer', userSelect: 'none', padding: 4,
                background: hoverFolder === e.name ? '#e8f0ff' : undefined
              }}
              title={e.name}
              draggable
              onDragStart={(ev) => onTileDragStart(ev, e)}
              onDragOver={e.kind === 'folder' ? (ev) => onFolderDragOver(ev, e) : undefined}
              onDragLeave={e.kind === 'folder' ? () => setHoverFolder(null) : undefined}
              onDrop={e.kind === 'folder' ? (ev) => onFolderDrop(ev, e) : undefined}
              onDoubleClick={() => (e.kind === 'folder' ? doc.enter(e.name) : void doc.open(joinRel(doc.dir, e.name)))}
              onContextMenu={(ev) => openMenu(ev, e)}
            >
              <div style={{ width: 40, height: 40, margin: '0 auto', lineHeight: 0 }}>{fileGlyphNode(e)}</div>
              <div style={{ fontSize: 11, wordBreak: 'break-word' }}>{e.name}</div>
            </div>
          ))}
        </div>
      </div>
      {menu && (
        <DocumentsContextMenu
          target={menu}
          canPaste={doc.clipboard.current !== null}
          onNewFolder={() => void onNewFolder()}
          onRename={(e) => void onRename(e)}
          onDelete={(e) => void onDelete(e)}
          onCopy={(e) => { doc.clipboard.current = { op: 'copy', relPath: joinRel(doc.dir, e.name) }; }}
          onCut={(e) => { doc.clipboard.current = { op: 'cut', relPath: joinRel(doc.dir, e.name) }; }}
          onPaste={() => void doc.paste()}
          onOpen={(e) => void doc.open(joinRel(doc.dir, e.name))}
          onExport={(e) => void doc.exportFile(joinRel(doc.dir, e.name))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
