/**
 * Briefcase — standalone text notes not tied to any case. A list of loose notes on the left,
 * a simple editor on the right. Notepad 98 also writes here when its selector is set to
 * "Briefcase". Persisted via the briefcase store (encrypted at rest when login is on); zero egress.
 */

import { useCallback, useEffect, useState, type DragEvent } from 'react';
import type { BriefcaseNoteSummary } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';
import briefcaseBanner from '../../assets/briefcase-banner.png';
import briefcaseBannerBlur from '../../assets/briefcase-banner-blur.jpg';
import { ModuleBanner } from '../../components/ModuleBanner';

function uid(): string { return crypto.randomUUID(); }
function fmtBytes(n: number): string { return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`; }

/** Shared drag payload MIME for in-app item drags (My Documents ↔ Briefcase, and in-folder). */
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

export function BriefcaseModule({ initialNoteId }: { initialNoteId?: string } = {}): JSX.Element {
  const [notes, setNotes] = useState<BriefcaseNoteSummary[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState('untitled');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => { setNotes(await window.api.briefcase.list()); }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const openNote = useCallback(async (noteId: string) => {
    try {
      const n = await window.api.briefcase.read(noteId);
      if (!n) return;
      setId(n.id); setName(n.name); setBody(n.body); setDirty(false);
    } catch (err) { toast.error(`Open failed: ${(err as Error).message}`); }
  }, []);

  useEffect(() => { if (initialNoteId) void openNote(initialNoteId); }, [initialNoteId, openNote]);

  function newNote(): void { setId(null); setName('untitled'); setBody(''); setDirty(false); }

  async function save(): Promise<void> {
    const nid = id ?? uid();
    try {
      const saved = await window.api.briefcase.save({ id: nid, name: name.trim() || 'untitled', body });
      setId(saved.id); setDirty(false);
      await refresh();
      toast.success('Saved to Briefcase.');
    } catch (err) { toast.error(`Save failed: ${(err as Error).message}`); }
  }

  async function del(noteId: string): Promise<void> {
    const ok = await confirmDialog('Delete this note from the Briefcase?', 'Delete note');
    if (!ok) return;
    try {
      await window.api.briefcase.delete(noteId);
      if (id === noteId) newNote();
      await refresh();
      toast.success('Deleted.');
    } catch (err) { toast.error(`Delete failed: ${(err as Error).message}`); }
  }

  function onNoteDragStart(ev: DragEvent<HTMLLIElement>, n: BriefcaseNoteSummary): void {
    const payload: Ga98ItemPayload = { src: 'briefcase', id: n.id, name: n.name };
    ev.dataTransfer.setData(GA98_ITEM, JSON.stringify(payload));
  }

  // Cross-module drop target: a My Documents text-file tile dragged onto the note list is read
  // (decrypted) via `documents.readText` and saved as a new Briefcase note. Binary files are
  // rejected by `readText` itself — surface that as a warn toast rather than a silent no-op.
  async function onListDrop(ev: DragEvent<HTMLUListElement>): Promise<void> {
    ev.preventDefault();
    const payload = readItemPayload(ev.dataTransfer);
    if (!payload || payload.src !== 'docs' || !payload.relPath) return;
    try {
      const body = await window.api.documents.readText(payload.relPath);
      await window.api.briefcase.save({ id: uid(), name: payload.name, body });
      await refresh();
      toast.success('Saved to Briefcase.');
    } catch (err) { toast.warn((err as Error).message); }
  }

  return (
    <div className="ga98-briefcase">
      <ModuleBanner variant="briefcase" src={briefcaseBanner} blurSrc={briefcaseBannerBlur} alt="Briefcase" />
      <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane" style={{ width: 200, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4 }}>
          <button onClick={newNote} title="Start a new note">New</button>
        </div>
        <ul
          className="ga98-list"
          style={{ flex: 1, overflow: 'auto', margin: 0 }}
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => void onListDrop(ev)}
        >
          {notes.length === 0 && <li style={{ color: 'var(--ga98-dim-soft)', fontSize: 11 }}>Empty. Click New, type, then Save.</li>}
          {notes.map((n) => (
            <li
              key={n.id}
              data-selected={n.id === id}
              title={`${fmtBytes(n.bytes)} · ${new Date(n.updatedAt).toLocaleString()}`}
              draggable
              onDragStart={(ev) => onNoteDragStart(ev, n)}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => void openNote(n.id)}>{n.name}</span>
              <button onClick={() => void del(n.id)} style={{ minWidth: 0, padding: '0 5px' }} title="Delete">×</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="ga98-toolbar">
          <input className="ga98-text" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="note name" style={{ flex: 1 }} />
          <button onClick={() => void save()}>{dirty ? 'Save *' : 'Save'}</button>
        </div>
        <textarea
          className="ga98-text"
          style={{ flex: 1, resize: 'none', fontFamily: 'Courier New, monospace', fontSize: 12 }}
          value={body}
          onChange={(e) => { setBody(e.target.value); setDirty(true); }}
          placeholder="A note that isn't tied to any case. Saved to your Briefcase."
        />
      </div>
      </div>
    </div>
  );
}
