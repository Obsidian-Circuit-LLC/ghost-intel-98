/**
 * Notepad 98 — plain text editor that can save notes into a case.
 * If launched without an initial caseId, the user picks a case to scope the note.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CaseSummary } from '@shared/types';

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
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const text = await window.api.notes.read(caseId, name);
    setBody(text);
    setNoteName(name);
    setDirty(false);
  }

  async function save(): Promise<void> {
    if (!caseId) {
      alert('Pick a case first.');
      return;
    }
    if (!noteName.trim()) {
      alert('Note needs a name.');
      return;
    }
    await window.api.notes.write(caseId, noteName.trim(), body);
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString());
    await refreshNotes();
  }

  function newNote(): void {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setNoteName('untitled');
    setBody('');
    setDirty(false);
    setSavedAt(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={newNote}>New</button>
        <button onClick={() => void save()}>Save</button>
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
