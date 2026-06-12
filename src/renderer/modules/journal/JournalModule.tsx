/**
 * Journal Jots — a PIN-gated personal journal. A list of entries on the left, an editor on the
 * right with a date header. Entries are consolidated INSIDE the Journal app (the journal store);
 * they are never written to a case or the Briefcase. Persisted encrypted-at-rest when login is on.
 *
 * The 4-digit PIN is a rate-limited convenience gate on top of already-vault-encrypted storage —
 * NOT the data's encryption key (see src/main/storage/journal.ts). On mount we ask the main process
 * whether a PIN exists: if not, we force a "set a PIN" screen; if so, we show the lock screen and
 * only reveal the journal after verifyPin succeeds. Zero egress.
 */

import { useCallback, useEffect, useState } from 'react';
import type { JournalEntrySummary } from '@shared/types';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';

function uid(): string { return crypto.randomUUID(); }
function fmtBytes(n: number): string { return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`; }
function isFourDigits(s: string): boolean { return /^[0-9]{4}$/.test(s); }

type Gate = 'loading' | 'set-pin' | 'locked' | 'open';

export function JournalModule(): JSX.Element {
  const [gate, setGate] = useState<Gate>('loading');

  // PIN-screen state.
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');

  // Journal state (only meaningful once unlocked).
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState('Untitled');
  const [body, setBody] = useState('');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void window.api.journal.hasPin().then((has) => setGate(has ? 'locked' : 'set-pin'));
  }, []);

  const refresh = useCallback(async () => { setEntries(await window.api.journal.list()); }, []);
  useEffect(() => { if (gate === 'open') void refresh(); }, [gate, refresh]);

  // ---- PIN flows -------------------------------------------------------------------------------

  async function submitSetPin(): Promise<void> {
    setPinError('');
    if (!isFourDigits(pin)) { setPinError('PIN must be exactly 4 digits.'); return; }
    if (pin !== pinConfirm) { setPinError('The two PINs do not match.'); return; }
    try {
      await window.api.journal.setPin(pin);
      setPin(''); setPinConfirm('');
      setGate('open');
      toast.success('Journal PIN set.');
    } catch (err) { setPinError((err as Error).message); }
  }

  async function submitUnlock(): Promise<void> {
    setPinError('');
    if (!isFourDigits(pin)) { setPinError('PIN must be exactly 4 digits.'); return; }
    try {
      const ok = await window.api.journal.verifyPin(pin);
      if (!ok) { setPinError('Incorrect PIN — or too many attempts; wait and try again.'); setPin(''); return; }
      setPin('');
      setGate('open');
    } catch (err) { setPinError((err as Error).message); }
  }

  // ---- entry flows -----------------------------------------------------------------------------

  const openEntry = useCallback(async (entryId: string) => {
    try {
      const e = await window.api.journal.read(entryId);
      if (!e) return;
      setId(e.id); setTitle(e.title); setBody(e.body); setCreatedAt(e.createdAt); setDirty(false);
    } catch (err) { toast.error(`Open failed: ${(err as Error).message}`); }
  }, []);

  function newEntry(): void {
    setId(null); setTitle('Untitled'); setBody(''); setCreatedAt(null); setDirty(false);
  }

  async function save(): Promise<void> {
    const eid = id ?? uid();
    try {
      const saved = await window.api.journal.save({ id: eid, title: title.trim() || 'Untitled', body });
      setId(saved.id); setCreatedAt(saved.createdAt); setDirty(false);
      await refresh();
      toast.success('Entry saved.');
    } catch (err) { toast.error(`Save failed: ${(err as Error).message}`); }
  }

  async function del(entryId: string): Promise<void> {
    const ok = await confirmDialog('Delete this journal entry?', 'Delete entry');
    if (!ok) return;
    try {
      await window.api.journal.delete(entryId);
      if (id === entryId) newEntry();
      await refresh();
      toast.success('Deleted.');
    } catch (err) { toast.error(`Delete failed: ${(err as Error).message}`); }
  }

  // ---- render ----------------------------------------------------------------------------------

  if (gate === 'loading') {
    return <div className="ga98-pane" style={{ padding: 12, color: '#666' }}>Opening your journal…</div>;
  }

  if (gate === 'set-pin' || gate === 'locked') {
    const setting = gate === 'set-pin';
    const submit = setting ? submitSetPin : submitUnlock;
    return (
      <div className="ga98-pane" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 260 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            {setting ? 'Set a 4-digit journal PIN' : 'Enter your journal PIN'}
          </div>
          <div style={{ fontSize: 11, color: '#444', marginBottom: 10 }}>
            The PIN locks this journal from casual access. Your entries are encrypted at rest by the
            app vault — the PIN is a convenience gate, not the encryption key.
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input
              className="ga98-text"
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="4-digit PIN"
              style={{ width: '100%', marginBottom: 6 }}
            />
            {setting && (
              <input
                className="ga98-text"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="confirm PIN"
                style={{ width: '100%', marginBottom: 6 }}
              />
            )}
            {pinError && <div style={{ color: '#a00', fontSize: 11, marginBottom: 6 }}>{pinError}</div>}
            <button type="submit" style={{ width: '100%' }}>{setting ? 'Set PIN & Open' : 'Unlock'}</button>
          </form>
        </div>
      </div>
    );
  }

  // gate === 'open'
  const headerDate = createdAt ? new Date(createdAt).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }) : new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane" style={{ width: 200, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4 }}>
          <button onClick={newEntry} title="Start a new entry">New</button>
        </div>
        <ul className="ga98-list" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
          {entries.length === 0 && <li style={{ color: '#666', fontSize: 11 }}>Empty. Click New, write, then Save.</li>}
          {entries.map((e) => (
            <li key={e.id} data-selected={e.id === id} title={`${fmtBytes(e.bytes)} · ${new Date(e.updatedAt).toLocaleString()}`}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => void openEntry(e.id)}>{e.title}</span>
              <button onClick={() => void del(e.id)} style={{ minWidth: 0, padding: '0 5px' }} title="Delete">×</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="ga98-toolbar">
          <input className="ga98-text" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="entry title" style={{ flex: 1 }} />
          <button onClick={() => void save()}>{dirty ? 'Save *' : 'Save'}</button>
          {id && <button onClick={() => void del(id)} title="Delete this entry">Delete</button>}
        </div>
        <div style={{ padding: '4px 6px', fontSize: 11, color: '#333', borderBottom: '1px solid #808080', fontStyle: 'italic' }}>
          {headerDate}
        </div>
        <textarea
          className="ga98-text"
          style={{ flex: 1, resize: 'none', fontFamily: 'Courier New, monospace', fontSize: 12 }}
          value={body}
          onChange={(e) => { setBody(e.target.value); setDirty(true); }}
          placeholder="Dear journal…"
        />
      </div>
    </div>
  );
}
