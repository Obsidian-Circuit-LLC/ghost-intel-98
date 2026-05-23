/**
 * Shred — soft-delete bucket. Restore items back, or purge them for good.
 */

import { useCallback, useEffect, useState } from 'react';

interface Entry {
  id: string;
  kind: 'case' | 'attachment';
  label: string;
  deletedAt: string;
}

export function ShredModule(): JSX.Element {
  const [list, setList] = useState<Entry[]>([]);

  const refresh = useCallback(async () => {
    setList(await window.api.shred.list());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function restore(id: string): Promise<void> {
    await window.api.shred.restore(id);
    await refresh();
  }

  async function purge(id: string): Promise<void> {
    if (!confirm('Purge this item forever? This cannot be undone.')) return;
    await window.api.shred.purge(id);
    await refresh();
  }

  async function purgeAll(): Promise<void> {
    if (!confirm('Empty Shred? Everything inside will be gone forever.')) return;
    await window.api.shred.purgeAll();
    await refresh();
  }

  return (
    <div className="ga98-stack">
      <div className="ga98-toolbar" style={{ padding: 0 }}>
        <button onClick={() => void refresh()}>Refresh</button>
        <button onClick={() => void purgeAll()} disabled={list.length === 0}>Empty Shred</button>
      </div>
      <ul className="ga98-list">
        {list.length === 0 && <li style={{ color: '#666' }}>Shred is empty.</li>}
        {list.map((e) => (
          <li key={e.id}>
            <span style={{ width: 90, fontSize: 11, opacity: 0.7 }}>[{e.kind}]</span>
            <span style={{ flex: 1 }}>{e.label}</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{new Date(e.deletedAt).toLocaleString()}</span>
            <button onClick={() => void restore(e.id)}>Restore</button>
            <button onClick={() => void purge(e.id)}>Purge</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
