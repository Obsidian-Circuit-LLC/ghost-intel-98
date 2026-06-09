/**
 * Chat (beta) — EXPERIMENTAL P2P chat over Tor onion services.
 *
 * The handshake crypto is pending formal verification; this UI shows a loud banner and the feature
 * is opt-in. Inbound text is rendered as TEXT (React escapes by default — never HTML) per the
 * threat model. All transport/crypto lives in the main process; this is a thin client over
 * window.api.chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';
import type { ChatContactDTO, ChatMessageDTO, ChatGroupDTO } from '../../../preload/api';

type Status = 'online' | 'connecting' | 'offline' | 'needs-reinvite';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const netEnabled = settings?.chat?.networkEnabled ?? false;

  const [running, setRunning] = useState(false);
  const [onion, setOnion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<ChatContactDTO[]>([]);
  const [groups, setGroups] = useState<ChatGroupDTO[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<'contact' | 'group'>('contact');
  const [history, setHistory] = useState<ChatMessageDTO[]>([]);
  const [draft, setDraft] = useState('');
  const [invite, setInvite] = useState('');
  const [acceptLink, setAcceptLink] = useState('');
  // new-group form
  const [groupForm, setGroupForm] = useState<{ name: string; members: Set<string> } | null>(null);
  const selectedRef = useRef<string | null>(null);
  const selectedKindRef = useRef<'contact' | 'group'>('contact');
  useEffect(() => { selectedRef.current = selected; selectedKindRef.current = selectedKind; }, [selected, selectedKind]);

  // First-run instructions. The "don't show again" flag is a non-sensitive UI preference, so it lives
  // in localStorage (renderer-only, no IPC) — same pattern as the Markets intro.
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('ga98.chat.introSeen') !== '1') setShowHelp(true); } catch { /* storage blocked */ }
  }, []);
  function dismissHelp(forever: boolean): void {
    if (forever) { try { localStorage.setItem('ga98.chat.introSeen', '1'); } catch { /* storage blocked */ } }
    setShowHelp(false);
  }

  const markVerified = useCallback(async (cid: string, sn: string): Promise<void> => {
    const ok = await confirmDialog(
      `Only mark this contact verified AFTER you have compared the safety number out-of-band (call / in person) and it MATCHED on both ends:\n\n${sn}\n\nMatching numbers mean there is no machine-in-the-middle. Mark as verified?`,
      'Verify contact'
    );
    if (!ok) return;
    try {
      await window.api.chat.setVerified(cid, true);
      void window.api.chat.listContacts().then(setContacts).catch(() => {});
      toast.success('Contact marked verified.');
    } catch (err) {
      toast.error(`Could not set verified: ${(err as Error).message}`);
    }
  }, []);

  const refreshContacts = useCallback(() => {
    void window.api.chat.listContacts().then(setContacts).catch(() => {});
  }, []);
  const refreshGroups = useCallback(() => {
    void window.api.chat.listGroups().then(setGroups).catch(() => {});
  }, []);
  const loadHistory = useCallback((cid: string) => {
    void window.api.chat.history(cid).then(setHistory).catch(() => {});
  }, []);
  const loadGroupHistory = useCallback((gid: string) => {
    void window.api.chat.groupHistory(gid).then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    void window.api.chat.status().then((s) => { setRunning(s.enabled); setOnion(s.onion); if (s.enabled) { refreshContacts(); refreshGroups(); } });
    const onContactConv = (contactId: string): void => {
      if (selectedKindRef.current === 'contact' && selectedRef.current === contactId) loadHistory(contactId);
    };
    const offMsg = window.api.chat.onMessage(({ contactId }) => { refreshContacts(); onContactConv(contactId); });
    const offStatus = window.api.chat.onContactStatus(({ contactId, status }) => {
      setStatuses((m) => ({ ...m, [contactId]: status as Status }));
    });
    const offDelivery = window.api.chat.onDelivery(({ contactId }) => onContactConv(contactId));
    const offFile = window.api.chat.onFileStatus(({ contactId }) => onContactConv(contactId));
    const offGroupMsg = window.api.chat.onGroupMessage(({ groupId }) => {
      if (selectedKindRef.current === 'group' && selectedRef.current === groupId) loadGroupHistory(groupId);
    });
    const offGroupInvite = window.api.chat.onGroupInvite(() => refreshGroups());
    const offTor = window.api.chat.onTorStatus(({ onion: o }) => setOnion(o));
    return () => { offMsg(); offStatus(); offDelivery(); offFile(); offGroupMsg(); offGroupInvite(); offTor(); };
  }, [refreshContacts, refreshGroups, loadHistory, loadGroupHistory]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      if (!netEnabled) await patch({ chat: { networkEnabled: true } });
      const r = await window.api.chat.enable();
      setRunning(true);
      setOnion(r.onion);
      refreshContacts();
    } catch (e) {
      toast.error(`Chat could not start: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [netEnabled, patch, refreshContacts]);

  const makeInvite = useCallback(async () => {
    try {
      const link = await window.api.chat.createInvite();
      setInvite(link);
    } catch (e) {
      toast.error(`Invite failed: ${(e as Error).message}`);
    }
  }, []);

  const accept = useCallback(async () => {
    const link = acceptLink.trim();
    if (!link) return;
    setBusy(true);
    try {
      const cid = await window.api.chat.acceptInvite(link);
      setAcceptLink('');
      refreshContacts();
      setSelected(cid);
      loadHistory(cid);
    } catch (e) {
      toast.error(`Accept failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [acceptLink, refreshContacts, loadHistory]);

  const open = useCallback((cid: string) => { setSelected(cid); setSelectedKind('contact'); loadHistory(cid); }, [loadHistory]);
  const openGroup = useCallback((gid: string) => { setSelected(gid); setSelectedKind('group'); loadGroupHistory(gid); }, [loadGroupHistory]);

  const createGroupNow = useCallback(async () => {
    if (!groupForm) return;
    const name = groupForm.name.trim();
    const members = [...groupForm.members];
    if (!name || members.length === 0) return;
    setBusy(true);
    try {
      const gid = await window.api.chat.createGroup(name, members);
      setGroupForm(null);
      refreshGroups();
      openGroup(gid);
    } catch (e) {
      toast.error(`Create group failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [groupForm, refreshGroups, openGroup]);

  const attach = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const id = await window.api.chat.sendFile(selected);
      if (id) loadHistory(selected); // null = user cancelled the picker
    } catch (e) {
      toast.error(`Send file failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [selected, loadHistory]);

  const saveFile = useCallback(async (transferId: string) => {
    if (!selected) return;
    try {
      const path = await window.api.chat.saveFile(selected, transferId);
      if (path) toast.info(`Saved ${path}`);
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }, [selected]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setDraft('');
    try {
      if (selectedKind === 'group') {
        await window.api.chat.sendGroup(selected, text);
        loadGroupHistory(selected);
      } else {
        await window.api.chat.send(selected, text);
        loadHistory(selected);
      }
    } catch (e) {
      toast.error(`Send failed: ${(e as Error).message}`);
    }
  }, [draft, selected, selectedKind, loadHistory, loadGroupHistory]);

  const sel = selectedKind === 'contact' ? (contacts.find((c) => c.contactId === selected) ?? null) : null;
  const selGroup = selectedKind === 'group' ? (groups.find((g) => g.groupId === selected) ?? null) : null;
  const nameFor = useCallback((cid?: string): string => {
    if (!cid) return 'unknown';
    return contacts.find((c) => c.contactId === cid)?.displayName ?? `${cid.slice(0, 8)}…`;
  }, [contacts]);

  return (
    <div className="ga98-stack" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', background: '#fff3b0', border: '2px solid #b8860b', color: '#5b4500', fontSize: 12 }}>
        <div style={{ flex: 1 }}>
          ⚠ <b>EXPERIMENTAL — beta.</b> The encryption here is <b>not yet formally verified</b>. Use it to
          shake out bugs, <b>not</b> for real adversarial security. Runs over Tor; nothing leaves your
          machine except onion traffic to your contact.
        </div>
        <button onClick={() => setShowHelp(true)} title="How to use chat" style={{ minWidth: 28, flexShrink: 0 }}>?</button>
      </div>

      {!running ? (
        <div style={{ padding: 12 }}>
          <p style={{ fontSize: 12 }}>
            Chat connects you peer-to-peer over a Tor onion service — no server, no account. Enabling
            starts Tor (this is network egress; off by default).
          </p>
          <button onClick={() => void enable()} disabled={busy}>{busy ? 'Starting Tor…' : 'Enable chat'}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* left: identity + contacts */}
          <div style={{ width: 240, borderRight: '1px solid #808080', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 6, fontSize: 11 }}>
              <div><b>Your address</b></div>
              <div style={{ wordBreak: 'break-all', fontFamily: 'monospace', opacity: onion ? 1 : 0.6 }}>{onion ?? 'publishing onion…'}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                <button onClick={() => void makeInvite()}>Create invite</button>
              </div>
              {invite && (
                <div style={{ marginTop: 4 }}>
                  <textarea readOnly className="ga98-text" style={{ width: '100%', height: 48, fontSize: 10 }} value={invite} />
                  <button onClick={() => { void navigator.clipboard.writeText(invite); toast.info('Invite copied'); }}>Copy link</button>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <div><b>Accept invite</b></div>
                <textarea
                  className="ga98-text"
                  style={{ width: '100%', height: 40, fontSize: 10 }}
                  placeholder="paste dcs98chat://invite/…"
                  value={acceptLink}
                  onChange={(e) => setAcceptLink(e.target.value)}
                />
                <button onClick={() => void accept()} disabled={busy || !acceptLink.trim()}>Connect</button>
              </div>
              <div style={{ marginTop: 8 }}>
                {!groupForm ? (
                  <button onClick={() => setGroupForm({ name: '', members: new Set() })} disabled={contacts.length === 0} title={contacts.length === 0 ? 'Add a contact first' : 'Create a group'}>New group…</button>
                ) : (
                  <div style={{ border: '1px solid #808080', padding: 4 }}>
                    <div><b>New group</b></div>
                    <input
                      className="ga98-text"
                      style={{ width: '100%', fontSize: 11 }}
                      placeholder="group name"
                      value={groupForm.name}
                      onChange={(e) => setGroupForm((f) => (f ? { ...f, name: e.target.value } : f))}
                    />
                    <div style={{ maxHeight: 90, overflowY: 'auto', margin: '4px 0' }}>
                      {contacts.map((c) => (
                        <label key={c.contactId} style={{ display: 'block', fontSize: 11 }}>
                          <input
                            type="checkbox"
                            checked={groupForm.members.has(c.contactId)}
                            onChange={(e) => setGroupForm((f) => {
                              if (!f) return f;
                              const members = new Set(f.members);
                              if (e.target.checked) members.add(c.contactId); else members.delete(c.contactId);
                              return { ...f, members };
                            })}
                          /> {c.displayName}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => void createGroupNow()} disabled={busy || !groupForm.name.trim() || groupForm.members.size === 0}>Create</button>
                      <button onClick={() => setGroupForm(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{ borderTop: '1px solid #808080', overflowY: 'auto', flex: 1 }}>
              {contacts.length === 0 && <div style={{ padding: 6, fontSize: 11, opacity: 0.7 }}>No contacts yet — create an invite or accept one.</div>}
              {contacts.map((c) => {
                const active = selectedKind === 'contact' && c.contactId === selected;
                return (
                  <div
                    key={c.contactId}
                    onClick={() => open(c.contactId)}
                    style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 12, background: active ? 'navy' : undefined, color: active ? '#fff' : undefined }}
                  >
                    {statuses[c.contactId] === 'online' ? '🟢' : statuses[c.contactId] === 'connecting' ? '🟡' : statuses[c.contactId] === 'needs-reinvite' ? <span title="Link expired — request a fresh invite out-of-band">⚠</span> : '⚪'} {c.displayName}
                    {c.verified ? ' ✔' : ''}
                  </div>
                );
              })}
              {groups.length > 0 && (
                <div style={{ padding: '4px 6px', fontSize: 10, opacity: 0.6, borderTop: '1px solid #c0c0c0', marginTop: 4 }}>GROUPS</div>
              )}
              {groups.map((g) => {
                const active = selectedKind === 'group' && g.groupId === selected;
                return (
                  <div
                    key={g.groupId}
                    onClick={() => openGroup(g.groupId)}
                    style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 12, background: active ? 'navy' : undefined, color: active ? '#fff' : undefined }}
                  >
                    👥 {g.name} <span style={{ fontSize: 10, opacity: 0.7 }}>({g.memberIds.length + 1})</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* right: conversation */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {!sel && !selGroup ? (
              <div style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>Select a contact or group.</div>
            ) : (
              <>
                {sel && (
                  <div style={{ padding: '4px 8px', borderBottom: '1px solid #808080', fontSize: 11 }}>
                    <b>{sel.displayName}</b> {sel.verified
                      ? <span style={{ color: '#0a7d28' }}>✔ verified</span>
                      : <span style={{ color: '#a00' }}>⚠ UNVERIFIED</span>}
                    {!sel.verified && (
                      <div style={{ marginTop: 3, padding: '4px 6px', background: '#ffecec', border: '1px solid #d33', color: '#700', fontSize: 10 }}>
                        This contact is <b>pinned but not verified</b> (TOFU). Until you compare the safety
                        number out-of-band, a machine-in-the-middle on first contact cannot be ruled out.
                        Compare the number below by phone/in person, then{' '}
                        <button style={{ fontSize: 10 }} onClick={() => void markVerified(sel.contactId, sel.safetyNumber)}>Mark as verified</button>
                      </div>
                    )}
                    <div style={{ marginTop: 2 }}>safety number (compare out-of-band):</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{sel.safetyNumber}</div>
                    {statuses[sel.contactId] === 'needs-reinvite' && (
                      <div style={{ marginTop: 3, padding: '4px 6px', background: '#fff8e0', border: '1px solid #c8a000', color: '#5a4000', fontSize: 10 }}>
                        ⚠ <b>Link expired — reconnect failed terminally.</b> Request a fresh invite from this contact out-of-band, then accept it below.
                      </div>
                    )}
                  </div>
                )}
                {selGroup && (
                  <div style={{ padding: '4px 8px', borderBottom: '1px solid #808080', fontSize: 11 }}>
                    <b>👥 {selGroup.name}</b> — {selGroup.memberIds.length + 1} members
                    <div style={{ fontSize: 10, opacity: 0.7 }}>
                      {selGroup.memberIds.map(nameFor).join(', ') || 'no other members'}
                      {selGroup.memberIds.some((id) => statuses[id] !== 'online') && ' · some members offline (messages reach connected members only)'}
                    </div>
                  </div>
                )}
                <div style={{ flex: 1, overflowY: 'auto', padding: 8, fontSize: 12 }}>
                  {history.map((m) => (
                    <div key={m.id} style={{ marginBottom: 4, textAlign: m.direction === 'out' ? 'right' : 'left' }}>
                      {selGroup && m.direction === 'in' && (
                        <div style={{ fontSize: 9, opacity: 0.6 }}>{nameFor(m.sender)}</div>
                      )}
                      {m.kind === 'file' && m.file ? (
                        <span style={{ background: m.direction === 'out' ? '#d3e8ff' : '#eee', padding: '4px 8px', borderRadius: 3, display: 'inline-block', maxWidth: '80%', textAlign: 'left' }}>
                          <div>📎 <b>{m.file.name}</b> <span style={{ opacity: 0.6, fontSize: 10 }}>({formatBytes(m.file.size)})</span></div>
                          <div style={{ fontSize: 10, opacity: 0.7 }}>
                            {m.file.status === 'transferring' ? 'transferring…' : m.file.status === 'failed' ? '⚠ transfer failed' : 'received'}
                          </div>
                          {m.direction === 'in' && m.file.status === 'complete' && (
                            <button style={{ marginTop: 2, fontSize: 11 }} onClick={() => void saveFile(m.file!.transferId)}>Save…</button>
                          )}
                        </span>
                      ) : (
                        <span style={{ background: m.direction === 'out' ? '#d3e8ff' : '#eee', padding: '2px 6px', borderRadius: 3, display: 'inline-block', maxWidth: '80%', wordBreak: 'break-word' }}>
                          {m.text}
                        </span>
                      )}
                      {m.direction === 'out' && (
                        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 4 }}>
                          {m.state === 'delivered' ? '✓✓' : m.state === 'sent' ? '✓' : '🕗'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4, padding: 6, borderTop: '1px solid #808080' }}>
                  <input
                    className="ga98-text"
                    style={{ flex: 1 }}
                    value={draft}
                    placeholder="Type a message…"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
                  />
                  {sel && <button onClick={() => void attach()} disabled={busy} title="Send a file">📎</button>}
                  <button onClick={() => void send()} disabled={!draft.trim()}>Send</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showHelp && (
        <div className="ga98-dialog-veil">
          <div className="window" style={{ width: 480, maxHeight: '88%', display: 'flex', flexDirection: 'column' }}>
            <div className="title-bar">
              <div className="title-bar-text">How to use Chat</div>
              <div className="title-bar-controls ga98-titlebar-buttons">
                <button aria-label="Close" onClick={() => dismissHelp(false)} />
              </div>
            </div>
            <div className="window-body ga98-stack" style={{ overflow: 'auto' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ fontSize: 34, lineHeight: 1 }}>💬</div>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                  <p style={{ marginTop: 0 }}><b>Chat</b> is a peer-to-peer, end-to-end-encrypted messenger that runs over Tor — no server, no account, no phone number. You and your contact connect directly through onion addresses.</p>
                </div>
              </div>
              <fieldset>
                <legend>Getting started</legend>
                <ol style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12, lineHeight: 1.6 }}>
                  <li><b>Enable chat</b> — starts Tor and publishes your onion address (this is network egress; off by default).</li>
                  <li><b>Share an invite</b> — click <b>Create invite</b>, then <b>Copy link</b>, and send it to your contact over a channel you trust.</li>
                  <li><b>Accept an invite</b> — paste a link a contact sent you into <b>Accept invite</b>; they appear in your contacts.</li>
                  <li><b>Verify the safety number</b> — compare it out-of-band (call / in person). Matching numbers mean no machine-in-the-middle; a later change is a loud warning.</li>
                  <li><b>Message &amp; send files</b> — pick a contact and type; the 📎 button sends a file (hash-verified, held in an encrypted quarantine until you save it).</li>
                  <li><b>Groups</b> — create a group and pick members; messages fan out over your existing 1:1 sessions.</li>
                </ol>
              </fieldset>
              <fieldset>
                <legend>Good to know</legend>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12, lineHeight: 1.6 }}>
                  <li>Both people must have chat <b>enabled and open</b> to connect — there is no offline server holding messages.</li>
                  <li>History is encrypted at rest and sealed when you lock the vault.</li>
                  <li>⚠ The handshake crypto is <b>experimental / not yet formally verified</b> — for dogfooding, not real adversarial security yet.</li>
                </ul>
              </fieldset>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={() => dismissHelp(true)}>Don&rsquo;t show this again</button>
                <button onClick={() => dismissHelp(false)} style={{ fontWeight: 'bold' }}>Got it</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
