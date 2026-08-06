/**
 * X Listening Station — analyst notes panel (Task X6).
 *
 * One note per finding, pinned by `findingId`, persisted to the encrypted `notes`
 * artifact store MAIN-side. This renderer never touches the network and never sees a
 * credential; it drives the sender-validated `window.api.xListening.saveNote/readNotes`
 * surface only. Nothing here imports bgconn/Tor/socmint/telegram — the import-graph
 * sentinel must stay green.
 *
 * Ported from the quarantine analyst-notes editor (`src/main.tsx:214-330`), re-shaped to
 * one note per finding and — critically — with the compose box as a real `<textarea>`.
 * The quarantine used `prompt()`; in Electron's renderer `window.prompt()` returns null
 * (no dialog), so a prompt-gated editor is a silent no-op (see the operator memory note
 * "Electron window.prompt no-op"). The ONLY dialog used here is `confirm()`, and only to
 * guard the destructive overwrite of an existing note.
 */

import { useCallback, useEffect, useState } from 'react';

export interface NotesPanelProps {
  /** The case whose notes store this panel reads/writes. */
  caseId: string;
  /** The finding the note is pinned to (one note per finding). */
  findingId: string;
  /** Human label for the finding, shown in the overwrite confirmation. */
  findingLabel?: string;
}

export function NotesPanel({ caseId, findingId, findingLabel }: NotesPanelProps): JSX.Element {
  const [draft, setDraft] = useState('');
  /** The note currently persisted for this finding, or null if none yet. */
  const [savedText, setSavedText] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the existing note for this finding on mount / finding change. readNotes returns
  // ALL case notes; we select this finding's single note (if any).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { notes } = await window.api.xListening.readNotes(caseId);
        if (!active) return;
        const mine = notes.find((n) => n.findingId === findingId) ?? null;
        setSavedText(mine?.text ?? null);
        setSavedAt(mine?.savedAt ?? null);
        setDraft(mine?.text ?? '');
      } catch (err) {
        if (active) console.warn('[XListening] readNotes:', err);
      }
    })();
    return () => { active = false; };
  }, [caseId, findingId]);

  const handleSave = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      setError('Note text is required.');
      return;
    }
    // Overwriting an existing note is destructive — confirm() (NOT prompt()) gates it.
    if (savedText !== null && text !== savedText) {
      const label = findingLabel ? ` for ${findingLabel}` : '';
      const ok = window.confirm(`Replace the existing analyst note${label}? This cannot be undone.`);
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const { notes } = await window.api.xListening.saveNote({ caseId, findingId, text });
      const mine = notes.find((n) => n.findingId === findingId) ?? null;
      setSavedText(mine?.text ?? text);
      setSavedAt(mine?.savedAt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the note.');
    } finally {
      setBusy(false);
    }
  }, [draft, savedText, findingLabel, caseId, findingId]);

  const dirty = draft.trim() !== (savedText ?? '');

  return (
    <section className="xls-notes-panel" aria-label="Analyst notes">
      <header className="xls-notes-head">
        <strong>Analyst note</strong>
        {savedAt && <small className="xls-notes-saved">Saved {savedAt}</small>}
      </header>
      <textarea
        className="xls-notes-input"
        value={draft}
        maxLength={20000}
        placeholder="Attach an analyst note to this finding…"
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />
      {error && <p className="xls-notes-error" role="alert">{error}</p>}
      <div className="xls-notes-actions">
        <button
          type="button"
          className="xls-btn xls-btn-primary"
          onClick={() => void handleSave()}
          disabled={busy || !dirty || !draft.trim()}
        >
          {busy ? 'Saving…' : savedText === null ? 'Save note' : 'Update note'}
        </button>
      </div>
    </section>
  );
}
