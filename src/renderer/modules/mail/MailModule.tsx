/**
 * Mail — IMAP/SMTP via main process. Accounts list, inbox view, compose pane.
 * Credentials never leave the main process; the renderer only sees envelope + body text.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MailAccount, MailMessage, MailMessageSummary } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { playMailAlert } from '../../audio/synth';

export function MailModule(): JSX.Element {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<MailMessageSummary[]>([]);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const settings = useSettings((s) => s.settings);

  const loadAccounts = useCallback(async () => {
    const list = await window.api.mail.listAccounts();
    setAccounts(list);
    if (!activeId && list.length > 0) setActiveId(list[0].id);
    if (list.length === 0) setShowSetup(true);
  }, [activeId]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const refreshInbox = useCallback(async () => {
    if (!activeId) return;
    setBusy('fetching inbox…');
    try {
      const list = await window.api.mail.fetchInbox(activeId, 30);
      const prevUnseen = inbox.filter((m) => m.unseen).length;
      setInbox(list);
      const nextUnseen = list.filter((m) => m.unseen).length;
      if (nextUnseen > prevUnseen && settings?.soundEnabled) playMailAlert();
    } catch (err) {
      alert(`IMAP error: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [activeId, inbox, settings?.soundEnabled]);

  async function openMessage(uid: number): Promise<void> {
    if (!activeId) return;
    setBusy('opening message…');
    try {
      const msg = await window.api.mail.fetchMessage(activeId, uid);
      setSelected(msg);
    } catch (err) {
      alert(`Could not load message: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => setShowCompose(true)} disabled={!activeId}>Compose</button>
        <button onClick={() => void refreshInbox()} disabled={!activeId}>Get mail</button>
        <select className="ga98-text" value={activeId ?? ''} onChange={(e) => { setActiveId(e.target.value || null); setInbox([]); setSelected(null); }}>
          <option value="">(no account)</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.user}</option>)}
        </select>
        <button onClick={() => setShowSetup(true)}>Accounts…</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11 }}>{busy ?? ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', flex: 1, overflow: 'hidden' }}>
        <div className="ga98-pane">
          <ul className="ga98-list">
            {inbox.length === 0 && <li style={{ color: '#666' }}>No messages — click "Get mail".</li>}
            {inbox.map((m) => (
              <li key={m.uid} data-selected={selected?.uid === m.uid} onClick={() => void openMessage(m.uid)}>
                <span style={{ width: 8 }}>{m.unseen ? '●' : ''}</span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: m.unseen ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.from}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.subject}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <>
              <div style={{ borderBottom: '1px solid #999', paddingBottom: 4, marginBottom: 4 }}>
                <div><b>From:</b> {selected.from}</div>
                <div><b>Subject:</b> {selected.subject}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{new Date(selected.date).toLocaleString()}</div>
              </div>
              <pre style={{ flex: 1, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'Courier New, monospace', fontSize: 12 }}>{selected.body}</pre>
            </>
          ) : <p style={{ color: '#666' }}>Select a message to preview.</p>}
        </div>
      </div>
      {showSetup && <AccountSetup accounts={accounts} onClose={() => { setShowSetup(false); void loadAccounts(); }} />}
      {showCompose && activeId && <Compose accountId={activeId} onClose={() => setShowCompose(false)} />}
    </div>
  );
}

function AccountSetup({ accounts, onClose }: { accounts: MailAccount[]; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState<MailAccount & { password: string }>({
    id: '',
    label: 'My Mail',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    user: '',
    passwordRef: '',
    password: ''
  });
  const [status, setStatus] = useState<string | null>(null);

  async function test(): Promise<void> {
    setStatus('Testing IMAP…');
    const r = await window.api.mail.testAccount(draft);
    setStatus(r.ok ? '✓ IMAP login OK' : `✗ ${r.error}`);
  }

  async function save(): Promise<void> {
    await window.api.mail.upsertAccount(draft);
    onClose();
  }

  return (
    <div style={overlayStyle}>
      <div className="window" style={{ width: 440 }}>
        <div className="title-bar"><div className="title-bar-text">Mail account</div></div>
        <div className="window-body ga98-stack">
          {accounts.length > 0 && (
            <fieldset>
              <legend>Existing</legend>
              <ul className="ga98-list">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <span style={{ flex: 1 }}>{a.label} — {a.user}</span>
                    <button onClick={async () => { await window.api.mail.deleteAccount(a.id); onClose(); }}>Delete</button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <fieldset>
            <legend>New / edit</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 60px 80px', gap: 4, alignItems: 'center' }}>
              <label>Label</label>
              <input className="ga98-text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              <span /><span />
              <label>User</label>
              <input className="ga98-text" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} />
              <span /><span />
              <label>Password</label>
              <input className="ga98-text" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              <span /><span />
              <label>IMAP host</label>
              <input className="ga98-text" value={draft.imapHost} onChange={(e) => setDraft({ ...draft, imapHost: e.target.value })} />
              <input className="ga98-text" type="number" value={draft.imapPort} onChange={(e) => setDraft({ ...draft, imapPort: Number(e.target.value) })} />
              <label><input type="checkbox" checked={draft.imapSecure} onChange={(e) => setDraft({ ...draft, imapSecure: e.target.checked })} />TLS</label>
              <label>SMTP host</label>
              <input className="ga98-text" value={draft.smtpHost} onChange={(e) => setDraft({ ...draft, smtpHost: e.target.value })} />
              <input className="ga98-text" type="number" value={draft.smtpPort} onChange={(e) => setDraft({ ...draft, smtpPort: Number(e.target.value) })} />
              <label><input type="checkbox" checked={draft.smtpSecure} onChange={(e) => setDraft({ ...draft, smtpSecure: e.target.checked })} />TLS</label>
            </div>
          </fieldset>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void test()}>Test IMAP</button>
            <button onClick={() => void save()} disabled={!draft.user || !draft.password}>Save</button>
            <button onClick={onClose}>Cancel</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11 }}>{status ?? ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Compose({ accountId, onClose }: { accountId: string; onClose: () => void }): JSX.Element {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function send(): Promise<void> {
    setSending(true);
    const r = await window.api.mail.send({ accountId, to, subject, body });
    setSending(false);
    if (r.ok) {
      alert('Sent.');
      onClose();
    } else {
      alert(`Send failed: ${r.error}`);
    }
  }

  return (
    <div style={overlayStyle}>
      <div className="window" style={{ width: 600 }}>
        <div className="title-bar"><div className="title-bar-text">Compose</div></div>
        <div className="window-body ga98-stack">
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 4 }}>
            <label>To:</label>
            <input className="ga98-text" value={to} onChange={(e) => setTo(e.target.value)} />
            <label>Subject:</label>
            <input className="ga98-text" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <textarea className="ga98-text" rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body…" />
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void send()} disabled={sending || !to.trim() || !subject.trim()}>{sending ? 'Sending…' : 'Send'}</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50
};
