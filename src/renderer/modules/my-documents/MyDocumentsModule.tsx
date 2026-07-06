import { useEffect, useState, type DragEvent, type MouseEvent } from 'react';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import type { DocEntry } from '../../../shared/documents-types';
import { useDocuments, joinRel } from './useDocuments';
import { DocumentsContextMenu, type ContextTarget } from './DocumentsContextMenu';

export function MyDocumentsModule(): JSX.Element {
  const doc = useDocuments();
  const [vaultOn, setVaultOn] = useState(false);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const [dropHot, setDropHot] = useState(false);

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

  function onDrop(ev: DragEvent<HTMLDivElement>): void {
    ev.preventDefault();
    setDropHot(false);
    const files = Array.from(ev.dataTransfer.files)
      .map((f) => ({ sourcePath: window.api.files.getPathForFile(f), originalName: f.name }))
      .filter((p) => p.sourcePath);
    if (files.length) void doc.importFiles(files);
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
        <a onClick={() => { while (doc.dir !== '') doc.up(); }} style={{ cursor: 'pointer' }}>My Documents</a>
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
        {doc.entries.map((e) => (
          <div
            key={e.name}
            className="ga98-mydocs-entry"
            style={{ padding: '2px 4px', cursor: 'pointer', userSelect: 'none' }}
            onDoubleClick={() => (e.kind === 'folder' ? doc.enter(e.name) : doc.reveal(joinRel(doc.dir, e.name)))}
            onContextMenu={(ev) => openMenu(ev, e)}
          >
            {e.kind === 'folder' ? '📁' : '📄'} {e.name}
          </div>
        ))}
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
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
