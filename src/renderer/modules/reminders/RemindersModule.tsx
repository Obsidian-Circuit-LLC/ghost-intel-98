/**
 * Global reminders list — independent of any case.
 * Highlighted entries pulse when surfaced by an incoming fire event.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '@shared/types';

interface Props {
  highlight?: string;
}

function newId(): string {
  return `rem-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function RemindersModule({ highlight }: Props): JSX.Element {
  const [list, setList] = useState<Reminder[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fireAt, setFireAt] = useState('');

  const refresh = useCallback(async () => {
    setList(await window.api.reminders.listGlobal());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(): Promise<void> {
    if (!title.trim() || !fireAt) return;
    const r: Reminder = {
      id: newId(),
      title: title.trim(),
      body: body.trim() || undefined,
      fireAt: new Date(fireAt).toISOString(),
      repeat: 'none',
      fired: false
    };
    await window.api.reminders.upsertGlobal(r);
    setTitle(''); setBody(''); setFireAt('');
    await refresh();
  }

  return (
    <div className="ga98-stack">
      <fieldset>
        <legend>New reminder</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 4 }}>
          <label>Title:</label>
          <input className="ga98-text" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Body:</label>
          <input className="ga98-text" value={body} onChange={(e) => setBody(e.target.value)} />
          <label>When:</label>
          <input className="ga98-text" type="datetime-local" value={fireAt} onChange={(e) => setFireAt(e.target.value)} />
        </div>
        <div style={{ marginTop: 6 }}>
          <button onClick={() => void add()} disabled={!title.trim() || !fireAt}>Add</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>All reminders</legend>
        <ul className="ga98-list">
          {list.length === 0 && <li style={{ color: '#666' }}>None.</li>}
          {list.map((r) => (
            <li key={r.id} style={r.id === highlight ? { background: '#ffff00' } : undefined}>
              <span style={{ flex: 1 }}>
                <b>{r.title}</b>{r.body ? ` — ${r.body}` : ''}
                <span style={{ opacity: 0.7 }}> · {new Date(r.fireAt).toLocaleString()}</span>
                {r.fired ? <span style={{ color: '#080' }}> · fired</span> : ''}
              </span>
              <button onClick={async () => { await window.api.reminders.deleteGlobal(r.id); await refresh(); }}>×</button>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
