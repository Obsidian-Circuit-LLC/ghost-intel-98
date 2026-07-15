/** DescriptorLibrary — the reusable "descriptor" library (name + body) a report's text blocks can
 *  right-click-insert from (see TextBlock's context menu). This overlay only manages the library
 *  itself (add/edit/delete) via window.api.reports.descriptors.* — insertion happens inline in
 *  TextBlock, not here. A descriptor is plain-text data, never trusted markup: `descriptorInsertHtml`
 *  (rich-text.ts) HTML-escapes both fields before they ever reach a block's html. */
import { useCallback, useEffect, useState } from 'react';
import type { Descriptor } from '@shared/reports-types';

function uid(): string { return crypto.randomUUID(); }

export function DescriptorLibrary(props: { onClose: () => void }): JSX.Element {
  const [descriptors, setDescriptors] = useState<Descriptor[]>([]);
  const [draft, setDraft] = useState<Descriptor | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setDescriptors(await window.api.reports.descriptors.list());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function addDescriptor(): void { setDraft({ id: uid(), name: '', body: '' }); }
  function editDescriptor(d: Descriptor): void { setDraft({ ...d }); }

  async function saveDraft(): Promise<void> {
    if (!draft) return;
    await window.api.reports.descriptors.save(draft);
    setDraft(null);
    await refresh();
  }

  async function removeDescriptor(id: string): Promise<void> {
    await window.api.reports.descriptors.remove(id);
    if (draft?.id === id) setDraft(null);
    await refresh();
  }

  return (
    <div className="ga98-report-descriptorlib" role="dialog" aria-label="Descriptor library">
      <div className="ga98-report-descriptorlib-head">
        <strong>Descriptors</strong>
        <button onClick={addDescriptor}>Add descriptor</button>
        <button aria-label="Close descriptor library" onClick={props.onClose}>✕</button>
      </div>

      <ul className="ga98-report-descriptorlib-list">
        {descriptors.map((d) => (
          <li key={d.id}>
            <span className="ga98-report-descriptor-name">{d.name || 'Unnamed'}</span>
            <span className="ga98-report-descriptor-preview"> — {d.body.slice(0, 120)}</span>
            <button onClick={() => editDescriptor(d)}>Edit</button>
            <button aria-label="Delete descriptor" onClick={() => { void removeDescriptor(d.id); }}>✕</button>
          </li>
        ))}
        {descriptors.length === 0 ? <li className="ga98-report-descriptorlib-empty">No descriptors yet.</li> : null}
      </ul>

      {draft ? (
        <div className="ga98-report-descriptor-editor">
          <label>
            <span>Name</span>
            <input
              aria-label="Descriptor name"
              value={draft.name}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            />
          </label>
          <label>
            <span>Body</span>
            <textarea
              aria-label="Descriptor body"
              value={draft.body}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
            />
          </label>
          <div className="ga98-report-descriptor-editor-actions">
            <button onClick={() => { void saveDraft(); }}>Save descriptor</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
