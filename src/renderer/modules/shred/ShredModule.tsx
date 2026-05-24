/**
 * Shred — soft-delete bucket. Restore items back, or purge them for good.
 */

import { useCallback, useEffect, useState } from 'react';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

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
    try {
      await window.api.shred.restore(id);
      await refresh();
      toast.success('Restored.');
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  }

  async function purge(id: string): Promise<void> {
    const ok = await confirmDialog('Purge this item forever? This cannot be undone.', 'Purge');
    if (!ok) return;
    try {
      await window.api.shred.purge(id);
      await refresh();
      toast.success('Purged.');
    } catch (err) {
      toast.error(`Purge failed: ${(err as Error).message}`);
    }
  }

  async function purgeAll(): Promise<void> {
    const ok = await confirmDialog('Empty Shred? Everything inside will be gone forever.', 'Empty Shred');
    if (!ok) return;
    try {
      await window.api.shred.purgeAll();
      await refresh();
      toast.success('Shred emptied.');
    } catch (err) {
      toast.error(`Empty failed: ${(err as Error).message}`);
    }
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
