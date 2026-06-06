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
import type { ChatContactDTO, ChatMessageDTO } from '../../../preload/api';

type Status = 'online' | 'connecting' | 'offline';

export function ChatModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const netEnabled = settings?.chat?.networkEnabled ?? false;

  const [running, setRunning] = useState(false);
  const [onion, setOnion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<ChatContactDTO[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessageDTO[]>([]);
  const [draft, setDraft] = useState('');
  const [invite, setInvite] = useState('');
  const [acceptLink, setAcceptLink] = useState('');
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const refreshContacts = useCallback(() => {
    void window.api.chat.listContacts().then(setContacts).catch(() => {});
  }, []);
  const loadHistory = useCallback((cid: string) => {
    void window.api.chat.history(cid).then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    void window.api.chat.status().then((s) => { setRunning(s.enabled); setOnion(s.onion); if (s.enabled) refreshContacts(); });
    const offMsg = window.api.chat.onMessage(({ contactId }) => {
      refreshContacts();
      if (selectedRef.current === contactId) loadHistory(contactId);
    });
    const offStatus = window.api.chat.onContactStatus(({ contactId, status }) => {
      setStatuses((m) => ({ ...m, [contactId]: status as Status }));
    });
    const offDelivery = window.api.chat.onDelivery(({ contactId }) => {
      if (selectedRef.current === contactId) loadHistory(contactId);
    });
    const offTor = window.api.chat.onTorStatus(({ onion: o }) => setOnion(o));
    return () => { offMsg(); offStatus(); offDelivery(); offTor(); };
  }, [refreshContacts, loadHistory]);

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

  const open = useCallback((cid: string) => { setSelected(cid); loadHistory(cid); }, [loadHistory]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setDraft('');
    try {
      await window.api.chat.send(selected, text);
      loadHistory(selected);
    } catch (e) {
      toast.error(`Send failed: ${(e as Error).message}`);
    }
  }, [draft, selected, loadHistory]);

  const sel = contacts.find((c) => c.contactId === selected) ?? null;

  return (
    <div className="ga98-stack" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 8px', background: '#fff3b0', border: '2px solid #b8860b', color: '#5b4500', fontSize: 12 }}>
        ⚠ <b>EXPERIMENTAL — beta.</b> The encryption here is <b>not yet formally verified</b>. Use it to
        shake out bugs, <b>not</b> for real adversarial security. Runs over Tor; nothing leaves your
        machine except onion traffic to your contact.
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
            </div>
            <div style={{ borderTop: '1px solid #808080', overflowY: 'auto', flex: 1 }}>
              {contacts.length === 0 && <div style={{ padding: 6, fontSize: 11, opacity: 0.7 }}>No contacts yet — create an invite or accept one.</div>}
              {contacts.map((c) => (
                <div
                  key={c.contactId}
                  onClick={() => open(c.contactId)}
                  style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 12, background: c.contactId === selected ? 'navy' : undefined, color: c.contactId === selected ? '#fff' : undefined }}
                >
                  {statuses[c.contactId] === 'online' ? '🟢' : statuses[c.contactId] === 'connecting' ? '🟡' : '⚪'} {c.displayName}
                  {c.verified ? ' ✔' : ''}
                </div>
              ))}
            </div>
          </div>

          {/* right: conversation */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {!sel ? (
              <div style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>Select a contact.</div>
            ) : (
              <>
                <div style={{ padding: '4px 8px', borderBottom: '1px solid #808080', fontSize: 11 }}>
                  <b>{sel.displayName}</b> — safety number (compare out-of-band):
                  <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{sel.safetyNumber}</div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8, fontSize: 12 }}>
                  {history.map((m) => (
                    <div key={m.id} style={{ marginBottom: 4, textAlign: m.direction === 'out' ? 'right' : 'left' }}>
                      <span style={{ background: m.direction === 'out' ? '#d3e8ff' : '#eee', padding: '2px 6px', borderRadius: 3, display: 'inline-block', maxWidth: '80%', wordBreak: 'break-word' }}>
                        {m.text}
                      </span>
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
                  <button onClick={() => void send()} disabled={!draft.trim()}>Send</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
