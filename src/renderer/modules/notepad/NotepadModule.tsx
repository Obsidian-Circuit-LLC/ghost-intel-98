/**
 * Notepad 98 — plain text editor that can save notes into a case.
 * If launched without an initial caseId, the user picks a case to scope the note.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CaseSummary } from '@shared/types';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { shortcutBus, type ShortcutEventDetail } from '../../shell/Shortcuts';

interface Props {
  initialCaseId: string | null;
}

export function NotepadModule({ initialCaseId }: Props): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseId, setCaseId] = useState<string | null>(initialCaseId);
  const [notes, setNotes] = useState<{ name: string; updatedAt: string }[]>([]);
  const [noteName, setNoteName] = useState('untitled');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    void window.api.cases.list().then(setCases);
  }, []);

  const refreshNotes = useCallback(async () => {
    if (!caseId) {
      setNotes([]);
      return;
    }
    setNotes(await window.api.notes.list(caseId));
  }, [caseId]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  async function openNote(name: string): Promise<void> {
    if (!caseId) return;
    if (dirty) {
      const ok = await confirmDialog('Discard unsaved changes?', 'Open note');
      if (!ok) return;
    }
    try {
      const text = await window.api.notes.read(caseId, name);
      setBody(text);
      setNoteName(name);
      setDirty(false);
    } catch (err) {
      toast.error(`Could not open note: ${(err as Error).message}`);
    }
  }

  const save = useCallback(async (): Promise<void> => {
    if (!caseId) {
      toast.warn('Pick a case first.');
      return;
    }
    if (!noteName.trim()) {
      toast.warn('Note needs a name.');
      return;
    }
    try {
      await window.api.notes.write(caseId, noteName.trim(), body);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      await refreshNotes();
      toast.success(`Saved "${noteName.trim()}".`);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  }, [caseId, noteName, body, refreshNotes]);

  const newNote = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirmDialog('Discard unsaved changes?', 'New note');
      if (!ok) return;
    }
    setNoteName('untitled');
    setBody('');
    setDirty(false);
    setSavedAt(null);
  }, [dirty]);

  // Listen for global Ctrl-S / Ctrl-N when this module is focused.
  useEffect(() => {
    function onShortcut(e: Event): void {
      const d = (e as CustomEvent<ShortcutEventDetail>).detail;
      if (d.moduleKey !== 'notepad') return;
      if (d.action === 'save') void save();
      if (d.action === 'new') void newNote();
    }
    shortcutBus.addEventListener('shortcut', onShortcut);
    return () => shortcutBus.removeEventListener('shortcut', onShortcut);
  }, [save, newNote]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => void newNote()} title="Ctrl/Cmd+N">New</button>
        <button onClick={() => void save()} title="Ctrl/Cmd+S">Save</button>
        <select className="ga98-text" value={caseId ?? ''} onChange={(e) => setCaseId(e.target.value || null)}>
          <option value="">(no case)</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>{c.title}{c.reference ? ` [${c.reference}]` : ''}</option>
          ))}
        </select>
        <input
          className="ga98-text"
          value={noteName}
          onChange={(e) => { setNoteName(e.target.value); setDirty(true); }}
          placeholder="note-name"
          style={{ width: 200 }}
        />
        <select className="ga98-text" value="" onChange={(e) => { if (e.target.value) void openNote(e.target.value); }}>
          <option value="">Open existing…</option>
          {notes.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
        </select>
      </div>
      <div style={{ flex: 1, padding: 4 }}>
        <textarea
          className="ga98-text"
          value={body}
          onChange={(e) => { setBody(e.target.value); setDirty(true); }}
          placeholder="Type your note here…"
        />
      </div>
      <div className="ga98-statusbar">
        <span>{dirty ? 'Modified' : savedAt ? `Saved at ${savedAt}` : 'Idle'}</span>
        <span style={{ flex: 1 }} />
        <span>{body.length} chars · {body.split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}
