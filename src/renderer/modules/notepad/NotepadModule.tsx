/**
 * Notepad 98 — plain text editor. Saves notes into a case when one is selected, OR into the
 * Briefcase (standalone notes) when "Briefcase" is picked in the selector. With "(no case)"
 * there's nowhere to save — pick a case or Briefcase first.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CaseSummary } from '@shared/types';
import type { BriefcaseNoteSummary } from '@shared/post-mvp-types';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { shortcutBus, type ShortcutEventDetail } from '../../shell/Shortcuts';

interface Props {
  initialCaseId: string | null;
}

/** Sentinel target for the Briefcase (vs a real case id or '' for no destination). */
const BRIEFCASE = '__briefcase__';

export function NotepadModule({ initialCaseId }: Props): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  // `target` holds a case id, '' (no destination), or the BRIEFCASE sentinel.
  const [target, setTarget] = useState<string | null>(initialCaseId);
  const [caseNotes, setCaseNotes] = useState<{ name: string; updatedAt: string }[]>([]);
  const [briefNotes, setBriefNotes] = useState<BriefcaseNoteSummary[]>([]);
  const [briefId, setBriefId] = useState<string | null>(null); // id of the open briefcase note
  const [noteName, setNoteName] = useState('untitled');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isBriefcase = target === BRIEFCASE;

  useEffect(() => {
    void window.api.cases.list().then(setCases);
  }, []);

  const refreshNotes = useCallback(async () => {
    if (isBriefcase) { setBriefNotes(await window.api.briefcase.list()); setCaseNotes([]); return; }
    if (!target) { setCaseNotes([]); setBriefNotes([]); return; }
    setCaseNotes(await window.api.notes.list(target)); setBriefNotes([]);
  }, [target, isBriefcase]);

  useEffect(() => {
    void refreshNotes();
  }, [refreshNotes]);

  async function openExisting(value: string): Promise<void> {
    if (dirty) {
      const ok = await confirmDialog('Discard unsaved changes?', 'Open note');
      if (!ok) return;
    }
    try {
      if (isBriefcase) {
        const n = await window.api.briefcase.read(value);
        if (!n) return;
        setBody(n.body); setNoteName(n.name); setBriefId(n.id);
      } else {
        if (!target) return;
        const text = await window.api.notes.read(target, value);
        setBody(text); setNoteName(value);
      }
      setDirty(false);
    } catch (err) {
      toast.error(`Could not open note: ${(err as Error).message}`);
    }
  }

  const save = useCallback(async (): Promise<void> => {
    if (!target) {
      toast.warn('Pick a case or the Briefcase first.');
      return;
    }
    if (!noteName.trim()) {
      toast.warn('Note needs a name.');
      return;
    }
    try {
      if (isBriefcase) {
        const nid = briefId ?? crypto.randomUUID();
        const saved = await window.api.briefcase.save({ id: nid, name: noteName.trim(), body });
        setBriefId(saved.id);
      } else {
        await window.api.notes.write(target, noteName.trim(), body);
      }
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      await refreshNotes();
      toast.success(`Saved "${noteName.trim()}"${isBriefcase ? ' to Briefcase' : ''}.`);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  }, [target, isBriefcase, briefId, noteName, body, refreshNotes]);

  const newNote = useCallback(async (): Promise<void> => {
    if (dirty) {
      const ok = await confirmDialog('Discard unsaved changes?', 'New note');
      if (!ok) return;
    }
    setNoteName('untitled');
    setBody('');
    setBriefId(null);
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
        <select
          className="ga98-text"
          value={target ?? ''}
          onChange={(e) => { setTarget(e.target.value || null); setBriefId(null); }}
        >
          <option value="">(no case)</option>
          <option value={BRIEFCASE}>💼 Briefcase</option>
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
        <select className="ga98-text" value="" onChange={(e) => { if (e.target.value) void openExisting(e.target.value); }}>
          <option value="">Open existing…</option>
          {isBriefcase
            ? briefNotes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)
            : caseNotes.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
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
        <span>{dirty ? 'Modified' : savedAt ? `Saved at ${savedAt}` : 'Idle'}{isBriefcase ? ' · Briefcase' : ''}</span>
        <span style={{ flex: 1 }} />
        <span>{body.length} chars · {body.split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}
