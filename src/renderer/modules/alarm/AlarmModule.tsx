/**
 * Alarm — simplest variant of a reminder, fires at one moment, plays sound + desktop notif.
 * Stored as a global reminder under the hood; the UI is a quick-set form.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '@shared/types';

function newId(): string {
  return `alm-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function AlarmModule(): JSX.Element {
  const [list, setList] = useState<Reminder[]>([]);
  const [label, setLabel] = useState('Wake up');
  const [when, setWhen] = useState('');

  const refresh = useCallback(async () => {
    const globals = await window.api.reminders.listGlobal();
    setList(globals.filter((r) => r.id.startsWith('alm-')));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(): Promise<void> {
    if (!when) return;
    const r: Reminder = {
      id: newId(),
      title: label,
      fireAt: new Date(when).toISOString(),
      repeat: 'none',
      fired: false
    };
    await window.api.reminders.upsertGlobal(r);
    setWhen('');
    await refresh();
  }

  return (
    <div className="ga98-stack">
      <fieldset>
        <legend>Set alarm</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 4 }}>
          <label>Label:</label>
          <input className="ga98-text" value={label} onChange={(e) => setLabel(e.target.value)} />
          <label>When:</label>
          <input className="ga98-text" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div style={{ marginTop: 6 }}>
          <button disabled={!when} onClick={() => void add()}>Set</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Active alarms</legend>
        <ul className="ga98-list">
          {list.length === 0 && <li style={{ color: '#666' }}>No alarms.</li>}
          {list.map((r) => (
            <li key={r.id}>
              <span style={{ flex: 1 }}>
                <b>{r.title}</b> <span style={{ opacity: 0.7 }}>· {new Date(r.fireAt).toLocaleString()}</span>
                {r.fired ? <span style={{ color: '#080' }}> · rang</span> : ''}
              </span>
              <button onClick={async () => { await window.api.reminders.deleteGlobal(r.id); await refresh(); }}>×</button>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
