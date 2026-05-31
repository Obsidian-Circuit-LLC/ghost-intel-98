/**
 * Save-to-case dialog for a GeoINT event. Pick a case, a save form (record/link/note),
 * and optionally link entities from the cross-case registry. Calls geoint.saveToCase.
 */

import { useEffect, useState } from 'react';
import type { GeoItem } from '@shared/post-mvp-types';
import type { CaseSummary, EntityRecord } from '@shared/types';
import { toast } from '../../state/toasts';

type Form = 'record' | 'link' | 'note';

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60
};

export function SaveEventDialog({ item, onClose }: { item: GeoItem; onClose: () => void }): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [caseId, setCaseId] = useState('');
  const [form, setForm] = useState<Form>('record');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const hasLink = typeof item.link === 'string' && /^https?:\/\//i.test(item.link);

  useEffect(() => {
    void (async () => {
      setCases(await window.api.cases.list());
      setEntities(await window.api.entities.listAll());
    })();
  }, []);

  function toggle(id: string): void {
    setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function save(): Promise<void> {
    if (!caseId) return;
    setBusy(true);
    try {
      await window.api.geoint.saveToCase(caseId, item, { form, entityIds: [...picked] });
      toast.success('Event saved to case.');
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlayStyle}>
      <div className="window" style={{ width: 460 }}>
        <div className="title-bar"><div className="title-bar-text">Save event to case</div></div>
        <div className="window-body ga98-stack">
          <p style={{ margin: 0, fontSize: 11, opacity: 0.8 }}>{item.title}</p>

          <fieldset>
            <legend>Case</legend>
            <select className="ga98-text" value={caseId} onChange={(e) => setCaseId(e.target.value)} style={{ width: '100%' }}>
              <option value="">(choose a case)</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.reference ? `${c.reference} — ` : ''}{c.title}</option>)}
            </select>
          </fieldset>

          <fieldset>
            <legend>Save as</legend>
            <label style={{ display: 'block' }}><input type="radio" name="ga98-geo-form" checked={form === 'record'} onChange={() => setForm('record')} /> Saved event (keeps location)</label>
            <label style={{ display: 'block' }}>
              <input type="radio" name="ga98-geo-form" checked={form === 'link'} disabled={!hasLink} onChange={() => setForm('link')} /> Web link{!hasLink ? ' (no link on this event)' : ''}
            </label>
            <label style={{ display: 'block' }}><input type="radio" name="ga98-geo-form" checked={form === 'note'} onChange={() => setForm('note')} /> Note</label>
          </fieldset>

          {entities.length > 0 && (
            <fieldset>
              <legend>Link entities (optional)</legend>
              <div style={{ maxHeight: 120, overflow: 'auto' }}>
                {entities.map((e) => (
                  <label key={e.id} style={{ display: 'block', fontSize: 11 }}>
                    <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} /> {e.type}: {e.value}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {item.place && <p style={{ fontSize: 11, color: '#555', margin: 0 }}>A location entity for &ldquo;{item.place}&rdquo; will be linked automatically.</p>}

          <div className="field-row" style={{ gap: 4 }}>
            <button onClick={() => void save()} disabled={!caseId || busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
