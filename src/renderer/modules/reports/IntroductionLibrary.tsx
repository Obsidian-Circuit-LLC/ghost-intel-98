/** IntroductionLibrary — the reusable "introduction" library (name + body) a report's text blocks can
 *  right-click-insert from (see TextBlock's context menu). This overlay only manages the library
 *  itself (add/edit/delete) via window.api.reports.introductions.* — insertion happens inline in
 *  TextBlock, not here. An introduction is plain-text data, never trusted markup: `introductionInsertHtml`
 *  (rich-text.ts) HTML-escapes both fields before they ever reach a block's html. */
import { useCallback, useEffect, useState } from 'react';
import type { Descriptor } from '@shared/reports-types';

function uid(): string { return crypto.randomUUID(); }

export function IntroductionLibrary(props: { onClose: () => void }): JSX.Element {
  const [introductions, setIntroductions] = useState<Descriptor[]>([]);
  const [draft, setDraft] = useState<Descriptor | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setIntroductions(await window.api.reports.introductions.list());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function addIntroduction(): void { setDraft({ id: uid(), name: '', body: '' }); }
  function editIntroduction(d: Descriptor): void { setDraft({ ...d }); }

  async function saveDraft(): Promise<void> {
    if (!draft) return;
    await window.api.reports.introductions.save(draft);
    setDraft(null);
    await refresh();
  }

  async function removeIntroduction(id: string): Promise<void> {
    await window.api.reports.introductions.remove(id);
    if (draft?.id === id) setDraft(null);
    await refresh();
  }

  return (
    <div className="ga98-report-introlib" role="dialog" aria-label="Introduction library">
      <div className="ga98-report-introlib-head">
        <strong>Introductions</strong>
        <button onClick={addIntroduction}>Add introduction</button>
        <button aria-label="Close introduction library" onClick={props.onClose}>✕</button>
      </div>

      <ul className="ga98-report-introlib-list">
        {introductions.map((d) => (
          <li key={d.id}>
            <span className="ga98-report-introduction-name">{d.name || 'Unnamed'}</span>
            <span className="ga98-report-introduction-preview"> — {d.body.slice(0, 120)}</span>
            <button onClick={() => editIntroduction(d)}>Edit</button>
            <button aria-label="Delete introduction" onClick={() => { void removeIntroduction(d.id); }}>✕</button>
          </li>
        ))}
        {introductions.length === 0 ? <li className="ga98-report-introlib-empty">No introductions yet.</li> : null}
      </ul>

      {draft ? (
        <div className="ga98-report-introduction-editor">
          <label>
            <span>Name</span>
            <input
              aria-label="Introduction name"
              value={draft.name}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            />
          </label>
          <label>
            <span>Body</span>
            <textarea
              aria-label="Introduction body"
              value={draft.body}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
            />
          </label>
          <div className="ga98-report-introduction-editor-actions">
            <button onClick={() => { void saveDraft(); }}>Save introduction</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
