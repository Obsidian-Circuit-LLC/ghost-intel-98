/**
 * Mail v2 — adds drafts (third left pane), outbound attachments via the
 * native file picker, and inbound attachment download via the save-file dialog.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MailAccount, MailMessage, MailMessageSummary } from '@shared/post-mvp-types';
import type { MailDraft } from '../../../preload/api';
import { useSettings } from '../../state/store';
import { playMailAlert } from '../../audio/synth';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';

type LeftView = 'inbox' | 'drafts';

export function MailModule(): JSX.Element {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [leftView, setLeftView] = useState<LeftView>('inbox');
  const [inbox, setInbox] = useState<MailMessageSummary[]>([]);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [compose, setCompose] = useState<MailDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const settings = useSettings((s) => s.settings);

  // autoOpenIfEmpty is honoured ONLY on first load. Reloads triggered by closing the
  // setup dialog must not re-derive showSetup from accounts.length, or an explicit
  // Cancel/close bounces straight back open when you have no account yet — which reads
  // as "Cancel doesn't cancel". Decouple the one-time auto-open from the reload.
  const loadAccounts = useCallback(async (autoOpenIfEmpty = false) => {
    const list = await window.api.mail.listAccounts();
    setAccounts(list);
    setActiveId((prev) => prev ?? list[0]?.id ?? null);
    if (autoOpenIfEmpty && list.length === 0) setShowSetup(true);
  }, []);
  useEffect(() => { void loadAccounts(true); }, [loadAccounts]);

  const refreshDrafts = useCallback(async () => {
    if (!activeId) { setDrafts([]); return; }
    setDrafts(await window.api.mail.listDrafts(activeId));
  }, [activeId]);
  useEffect(() => { void refreshDrafts(); }, [refreshDrafts]);

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
      toast.error(`IMAP error: ${(err as Error).message}`);
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
      toast.error(`Could not load message: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadAttachment(att: { filename: string; contentBase64?: string; size: number }): Promise<void> {
    if (!att.contentBase64) {
      toast.warn(`"${att.filename}" is ${Math.ceil(att.size / 1024 / 1024)} MB — too large to download in-app (>10 MB limit). Open the message in your webmail to retrieve it.`);
      return;
    }
    try {
      const saved = await window.api.mail.saveAttachment({ filename: att.filename, contentBase64: att.contentBase64 });
      if (saved) toast.success(`Saved ${saved}.`);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  }

  function openCompose(seed?: MailDraft): void {
    if (!activeId) return;
    setCompose(seed ?? {
      id: `dr-${crypto.randomUUID()}`,
      accountId: activeId,
      to: '',
      subject: '',
      body: '',
      attachments: [],
      savedAt: new Date().toISOString()
    });
  }

  async function deleteDraft(id: string): Promise<void> {
    const ok = await confirmDialog('Delete this draft?', 'Delete draft');
    if (!ok) return;
    await window.api.mail.deleteDraft(id);
    await refreshDrafts();
    toast.success('Draft deleted.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => openCompose()} disabled={!activeId} title="Ctrl/Cmd+N to compose">Compose</button>
        <button onClick={() => void refreshInbox()} disabled={!activeId}>Get mail</button>
        <select className="ga98-text" value={activeId ?? ''} onChange={(e) => { setActiveId(e.target.value || null); setInbox([]); setSelected(null); }}>
          <option value="">(no account)</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.user}</option>)}
        </select>
        <button onClick={() => setShowSetup(true)}>Accounts…</button>
        <span style={{ flex: 1 }} />
        <button data-active={leftView === 'inbox'} onClick={() => setLeftView('inbox')}>Inbox</button>
        <button data-active={leftView === 'drafts'} onClick={() => { setLeftView('drafts'); void refreshDrafts(); }}>
          Drafts ({drafts.length})
        </button>
        <span style={{ fontSize: 11 }}>{busy ?? ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', flex: 1, overflow: 'hidden' }}>
        <div className="ga98-pane">
          {leftView === 'inbox' ? (
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
          ) : (
            <ul className="ga98-list">
              {drafts.length === 0 && <li style={{ color: '#666' }}>No drafts.</li>}
              {drafts.map((d) => (
                <li key={d.id} onClick={() => openCompose(d)}>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.to || '(no recipient)'}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.subject || '(no subject)'} {d.attachments.length > 0 && `📎×${d.attachments.length}`}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); void deleteDraft(d.id); }}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <>
              <div style={{ borderBottom: '1px solid #999', paddingBottom: 4, marginBottom: 4 }}>
                <div><b>From:</b> {selected.from}</div>
                <div><b>Subject:</b> {selected.subject}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{new Date(selected.date).toLocaleString()}</div>
                {selected.attachments.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    <b>Attachments:</b>{' '}
                    {selected.attachments.map((a, i) => (
                      <button
                        key={i}
                        onClick={() => void downloadAttachment(a)}
                        style={{ marginRight: 4 }}
                        title={`${a.contentType} · ${Math.ceil(a.size / 1024)} KB`}
                      >
                        📎 {a.filename}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <pre style={{ flex: 1, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'Courier New, monospace', fontSize: 12 }}>
                {selected.body}
              </pre>
            </>
          ) : <p style={{ color: '#666' }}>Select a message to preview.</p>}
        </div>
      </div>
      {showSetup && <AccountSetup accounts={accounts} onClose={() => { setShowSetup(false); void loadAccounts(); }} />}
      {compose && <Compose draft={compose} onClose={(saved) => { setCompose(null); if (saved) void refreshDrafts(); }} />}
    </div>
  );
}

/** Known-good IMAP/SMTP settings for the common providers. SMTP port 587 → secure:false
 *  (STARTTLS, which the service now forces via requireTLS); 465 → secure:true (implicit TLS).
 *  Every one of these providers rejects your normal login password over IMAP/SMTP and
 *  requires an APP PASSWORD — see the note in the dialog. */
const MAIL_PRESETS: Record<string, Partial<MailAccount>> = {
  Gmail: { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true },
  'Outlook / Office 365': { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
  Yahoo: { imapHost: 'imap.mail.yahoo.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecure: true },
  iCloud: { imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false }
};

function AccountSetup({ accounts, onClose }: { accounts: MailAccount[]; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState<MailAccount & { password: string }>({
    id: '', label: 'My Mail',
    imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: true,
    user: '', passwordRef: '', password: ''
  });
  const [status, setStatus] = useState<string | null>(null);

  async function test(): Promise<void> {
    setStatus('Testing IMAP…');
    const r = await window.api.mail.testAccount(draft);
    setStatus(r.ok ? '✓ IMAP login OK' : `✗ ${r.error}`);
  }

  async function save(): Promise<void> {
    setStatus('Saving…');
    try {
      await window.api.mail.upsertAccount(draft);
      onClose();
    } catch (err) {
      setStatus(`✗ Save failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="ga98-dialog-veil">
      <div className="window" style={{ width: 440 }}>
        <div className="title-bar">
          <div className="title-bar-text">Mail account</div>
          {/* Always-available close — never trap the user in account setup. */}
          <div className="title-bar-controls ga98-titlebar-buttons">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
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
              <label>Provider</label>
              <select
                className="ga98-text"
                defaultValue=""
                onChange={(e) => { const p = MAIL_PRESETS[e.target.value]; if (p) setDraft({ ...draft, ...p }); }}
              >
                <option value="">Choose a preset…</option>
                {Object.keys(MAIL_PRESETS).map((name) => <option key={name} value={name}>{name}</option>)}
                <option value="">Custom (fill below)</option>
              </select>
              <span /><span />
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
            <p style={{ fontSize: 11, color: '#444', margin: '6px 2px 0', lineHeight: 1.4 }}>
              <b>Gmail, Outlook, Yahoo and iCloud reject your normal password.</b> Generate an
              <b> App Password</b> in that account's security settings (2FA must be on) and enable IMAP,
              then paste the app password above. SMTP on port 587 uses STARTTLS (leave TLS unchecked);
              port 465 uses implicit TLS (check TLS).
            </p>
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

function Compose({ draft: initial, onClose }: { draft: MailDraft; onClose: (savedAsDraft: boolean) => void }): JSX.Element {
  const [draft, setDraft] = useState<MailDraft>(initial);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // Esc always escapes Compose — there must never be a state (e.g. a send that's still
  // in-flight) that traps the user in this window with no way out.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function addAttachment(): Promise<void> {
    try {
      const paths = await window.api.files.pickOpen({ multi: true });
      if (!paths.length) return;
      const additions = paths.map((p) => ({
        name: p.split(/[\\/]/).pop() ?? p,
        path: p,
        size: 0
      }));
      setDraft((d) => ({ ...d, attachments: [...d.attachments, ...additions] }));
    } catch (err) {
      toast.error(`Pick failed: ${(err as Error).message}`);
    }
  }

  function removeAttachment(i: number): void {
    setDraft((d) => ({ ...d, attachments: d.attachments.filter((_, idx) => idx !== i) }));
  }

  async function saveDraft(): Promise<void> {
    setSavingDraft(true);
    try {
      await window.api.mail.upsertDraft({
        id: draft.id,
        accountId: draft.accountId,
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        attachments: draft.attachments
      });
      toast.success('Draft saved.');
      onClose(true);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSavingDraft(false);
    }
  }

  async function send(): Promise<void> {
    setSending(true);
    try {
      const r = await window.api.mail.send({
        accountId: draft.accountId,
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        attachments: draft.attachments.map((a) => ({ path: a.path, filename: a.name }))
      });
      if (r.ok) {
        try { await window.api.mail.deleteDraft(draft.id); } catch { /* draft may never have been persisted */ }
        toast.success('Sent.');
        onClose(true);
      } else {
        toast.error(`Send failed: ${r.error}`);
      }
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ga98-dialog-veil">
      <div className="window" style={{ width: 640 }}>
        <div className="title-bar">
          <div className="title-bar-text">Compose</div>
          {/* Always-available close — the Compose window must never trap the user. */}
          <div className="title-bar-controls ga98-titlebar-buttons">
            <button aria-label="Close" onClick={() => onClose(false)} />
          </div>
        </div>
        <div className="window-body ga98-stack">
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 4 }}>
            <label>To:</label>
            <input className="ga98-text" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            <label>Subject:</label>
            <input className="ga98-text" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <textarea className="ga98-text" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Message body…" />
          <fieldset>
            <legend>Attachments ({draft.attachments.length})</legend>
            <ul className="ga98-list">
              {draft.attachments.map((a, i) => (
                <li key={i}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.path}>📎 {a.name}</span>
                  <button onClick={() => removeAttachment(i)}>×</button>
                </li>
              ))}
            </ul>
            <button onClick={() => void addAttachment()}>Add file…</button>
          </fieldset>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void send()} disabled={sending || savingDraft || !draft.to.trim() || !draft.subject.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => void saveDraft()} disabled={savingDraft || sending}>{savingDraft ? 'Saving…' : 'Save draft'}</button>
            {/* Never disabled: a hung/slow send must not lock the user inside Compose. */}
            <button onClick={() => onClose(false)}>{sending ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
