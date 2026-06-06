/**
 * ChatSharePicker — a small modal that lists chat contacts (and, when allowed, groups) so the user
 * can pick a target to share a case artifact to. Used by the Phase 4 "Share to chat" actions in the
 * case module. File/attachment shares are 1:1-only (allowGroups=false); entity-text shares may target
 * a group too. Loads the lists lazily; if chat isn't enabled it says so rather than failing silently.
 */
import { useEffect, useState } from 'react';
import type { ChatContactDTO, ChatGroupDTO } from '../../preload/api';

export interface ShareTarget {
  kind: 'contact' | 'group';
  id: string;
  name: string;
}

export function ChatSharePicker({
  title,
  allowGroups,
  onPick,
  onClose
}: {
  title: string;
  allowGroups: boolean;
  onPick: (target: ShareTarget) => void;
  onClose: () => void;
}): JSX.Element {
  const [contacts, setContacts] = useState<ChatContactDTO[]>([]);
  const [groups, setGroups] = useState<ChatGroupDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await window.api.chat.status();
        if (!s.enabled) {
          if (live) { setError('Chat is not enabled. Open the Chat app and enable it first.'); setLoading(false); }
          return;
        }
        const [cs, gs] = await Promise.all([
          window.api.chat.listContacts(),
          allowGroups ? window.api.chat.listGroups() : Promise.resolve([] as ChatGroupDTO[])
        ]);
        if (live) { setContacts(cs); setGroups(gs); setLoading(false); }
      } catch (e) {
        if (live) { setError((e as Error).message); setLoading(false); }
      }
    })();
    return () => { live = false; };
  }, [allowGroups]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const empty = !loading && !error && contacts.length === 0 && groups.length === 0;

  return (
    <div className="ga98-dialog-veil" onMouseDown={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="window ga98-dialog-window" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls"><button aria-label="Close" onClick={onClose} /></div>
        </div>
        <div className="window-body" style={{ padding: 10, minWidth: 240 }}>
          {loading && <p style={{ margin: 0, fontSize: 12 }}>Loading…</p>}
          {error && <p style={{ margin: 0, fontSize: 12, color: '#a00' }}>{error}</p>}
          {empty && <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>No contacts to share with yet.</p>}
          {!loading && !error && (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {contacts.map((c) => (
                <div
                  key={c.contactId}
                  onClick={() => onPick({ kind: 'contact', id: c.contactId, name: c.displayName })}
                  style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 12 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#000080'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = ''; }}
                >
                  👤 {c.displayName}{c.verified ? ' ✔' : ''}
                </div>
              ))}
              {allowGroups && groups.length > 0 && (
                <div style={{ padding: '4px 6px', fontSize: 10, opacity: 0.6, borderTop: '1px solid #c0c0c0', marginTop: 4 }}>GROUPS</div>
              )}
              {allowGroups && groups.map((g) => (
                <div
                  key={g.groupId}
                  onClick={() => onPick({ kind: 'group', id: g.groupId, name: g.name })}
                  style={{ padding: '4px 6px', cursor: 'pointer', fontSize: 12 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#000080'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = ''; }}
                >
                  👥 {g.name}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
